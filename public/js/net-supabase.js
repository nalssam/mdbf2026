// BlockQuest 실시간 멀티플레이 어댑터 (Supabase Realtime 기반)
// 서버(Socket.IO)가 없는 정적 호스팅에서도 같은 학급 코드로 접속한 학생들이
// 하나의 월드에 함께 있도록 한다. Socket.IO 클라이언트와 같은 인터페이스(on/emit/connected)를
// 제공하므로 게임 코드는 거의 그대로 동작한다.
//
// - 프레즌스(presence): 접속자 명단 = 실시간 랭킹(각자의 점수/이름/아바타/치장)
// - 브로드캐스트(broadcast): 이동/블록/폭탄/발사/이모지/치장 등 월드 액션 공유
// - 늦게 들어온 학생은 기존 참가자에게 월드 지형(diff)과 진행 중 퀴즈를 요청해 맞춘다
//
// 연결 실패 시에는 아무 피어도 없는 "혼자 플레이" 상태로 자연 degrade 된다(화면이 깨지지 않음).
(function () {
  const CHAN_PREFIX = 'bq:';

  function makeEmitter() {
    const map = new Map();
    return {
      on(evt, cb) { (map.get(evt) || map.set(evt, []).get(evt)).push(cb); },
      off(evt, cb) { const a = map.get(evt); if (a) { const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); } },
      once(evt, cb) { const w = (...a) => { this.off(evt, w); cb(...a); }; this.on(evt, w); },
      emit(evt, ...args) { const a = map.get(evt); if (a) for (const cb of a.slice()) { try { cb(...args); } catch (e) { console.error('[net]', evt, e); } } },
    };
  }

  // Supabase 채널을 주입 가능하게(테스트용 목 채널도 받도록) 설계
  function connect(opts) {
    const { url, key, code, self, isTeacher, onStatus, channelFactory } = opts;
    const app = makeEmitter();          // 게임 코드가 구독하는 소켓형 이벤트 버스
    const myId = self.studentId;
    let status = 'connecting';
    let subscribed = false;

    // 로컬 월드 diff 누적 (늦게 온 참가자 동기화용)
    const worldDiffs = {};
    function foldDiff(key, d) {
      if (d && d.removed) worldDiffs[key] = { removed: true };
      else if (d && d.type) worldDiffs[key] = { type: d.type };
    }

    let currentQuiz = null;   // 전체 퀴즈(정답 포함) — 로컬 채점용
    let quizClosedId = null;

    // 내 프레즌스 상태(랭킹/치장에 반영)
    const myState = {
      id: myId, name: self.name, avatar: self.avatar, role: isTeacher ? 'teacher' : 'student',
      points: 0, correct: 0, answered: 0, streak: 0, bestStreak: 0, hat: null, pet: null, t: 0,
    };

    // Supabase 클라이언트/채널
    let sb = null, channel = null;
    let prevMembers = new Map(); // id → member (p:join/p:leave 판정용)

    function membersFromPresence() {
      const out = new Map();
      if (!channel || !channel.presenceState) return out;
      const st = channel.presenceState();
      for (const k of Object.keys(st)) {
        const metas = st[k];
        const m = metas && metas[metas.length - 1];
        if (m && m.id) out.set(m.id, m);
      }
      return out;
    }

    function leaderboard() {
      const members = membersFromPresence();
      const rows = [];
      for (const m of members.values()) {
        if (m.role === 'teacher') continue;
        rows.push({
          id: m.id, name: m.name, avatar: m.avatar, points: m.points || 0,
          correct: m.correct || 0, answered: m.answered || 0, bestStreak: m.bestStreak || 0, online: true,
        });
      }
      rows.sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name), 'ko'));
      rows.forEach((r, i) => { r.rank = i + 1; });
      return { rankings: rows, classTotal: rows.reduce((t, r) => t + r.points, 0), studentCount: rows.length };
    }

    function handlePresenceSync() {
      const members = membersFromPresence();
      // 랭킹 갱신
      app.emit('leaderboard:update', leaderboard());
      // 월드 아바타 입퇴장 (나 제외)
      for (const [id, m] of members) {
        if (id === myId) continue;
        if (!prevMembers.has(id)) {
          app.emit('p:join', { id, name: m.name, avatar: m.avatar });
          if (m.hat || m.pet) app.emit('p:style', { id, hat: m.hat, pet: m.pet });
        }
      }
      for (const id of prevMembers.keys()) {
        if (!members.has(id) && id !== myId) app.emit('p:leave', { id });
      }
      prevMembers = members;
    }

    // ---- 브로드캐스트 유틸 ----
    function bsend(event, payload) {
      if (!channel || !subscribed) return;
      try { channel.send({ type: 'broadcast', event, payload }); } catch (e) { /* 연결 끊김 무시 */ }
    }

    // 늦게 온 참가자에게 지형/퀴즈를 응답할지: 현재 프레즌스에서 가장 작은 id 한 명만 응답
    function amPrimaryResponder() {
      const ids = [...membersFromPresence().keys()].filter((id) => id !== undefined);
      if (!ids.length) return true;
      ids.sort();
      return ids[0] === myId;
    }

    // 브로드캐스트 수신 → 게임 이벤트로 재방출 (+ 월드 diff 누적)
    function onBroadcast(event, payload) {
      if (!payload) return;
      if (payload.id === myId && event !== 'sync:req') return; // 내 액션 반향 무시
      switch (event) {
        case 'p:move': app.emit('p:move', payload); break;
        case 'p:shoot': app.emit('p:shoot', payload); break;
        case 'p:emote': app.emit('p:emote', payload); break;
        case 'p:style': app.emit('p:style', payload); break;
        case 'w:break': foldDiff(payload.key, { removed: true }); app.emit('w:break', payload); break;
        case 'w:place': foldDiff(payload.key, { type: payload.type }); app.emit('w:place', payload); break;
        case 'w:bomb':
          for (const k of payload.keys || []) foldDiff(k, { removed: true });
          app.emit('w:bomb', payload); break;
        case 'quiz:launched':
          if (payload.quiz) { currentQuiz = payload.quiz; quizClosedId = null; app.emit('quiz:launched', { quiz: payload.quiz }); }
          break;
        case 'quiz:closed':
          quizClosedId = payload.quizId; app.emit('quiz:closed', { quizId: payload.quizId }); break;
        case 'sync:req':
          // 새 참가자 요청 — 대표 응답자만 지형/퀴즈를 개별 전송
          if (payload.id !== myId && amPrimaryResponder()) {
            if (Object.keys(worldDiffs).length) bsend('world:sync', { to: payload.id, diffs: worldDiffs });
          }
          // 진행 중 퀴즈는 교사가 보관 — 교사면 재전송
          if (isTeacher && currentQuiz && payload.id !== myId) bsend('quiz:launched', { quiz: currentQuiz });
          break;
        case 'world:sync':
          if (payload.to === myId) {
            for (const [k, d] of Object.entries(payload.diffs || {})) foldDiff(k, d);
            app.emit('world:state', { diffs: payload.diffs || {}, players: [] });
          }
          break;
      }
    }

    // ---- 소켓형 인터페이스 (게임 코드가 사용) ----
    const socket = {
      get connected() { return subscribed; },
      on: (evt, cb) => app.on(evt, cb),
      off: (evt, cb) => app.off(evt, cb),
      once: (evt, cb) => app.once(evt, cb),
      emit(evt, payload) {
        payload = payload || {};
        if (evt === 'join') {
          // 게임이 월드 입장을 알림 → 프레즌스 시작 + 지형/퀴즈 요청
          myState.name = payload.name || myState.name;
          startPresence();
          return socket;
        }
        // 월드 액션 브로드캐스트 (내 id 포함) + 내 diff 누적
        const out = Object.assign({ id: myId }, payload);
        if (evt === 'w:break') foldDiff(payload.key, { removed: true });
        else if (evt === 'w:place') foldDiff(payload.key, { type: payload.type });
        else if (evt === 'w:bomb') for (const k of payload.keys || []) foldDiff(k, { removed: true });
        else if (evt === 'p:style') { myState.hat = payload.hat || null; myState.pet = payload.pet || null; trackSoon(); }
        bsend(evt, out);
        return socket;
      },
      close() { try { if (sb) sb.removeAllChannels(); } catch (e) { /* noop */ } subscribed = false; },
    };

    // 프레즌스 track 디바운스 (점수 갱신 폭주 방지)
    let trackTimer = null;
    function trackSoon() {
      if (!subscribed || !channel) return;
      if (trackTimer) return;
      trackTimer = setTimeout(() => { trackTimer = null; try { channel.track(Object.assign({}, myState)); } catch (e) { /* noop */ } }, 250);
    }

    let presenceStarted = false;
    function startPresence() {
      if (presenceStarted || !channel || !subscribed) { pendingPresence = true; return; }
      presenceStarted = true;
      channel.track(Object.assign({}, myState));
      // 늦게 온 참가자: 지형/퀴즈 요청 후 잠시 뒤 현재 명단으로 world:state 방출
      bsend('sync:req', { id: myId });
      setTimeout(() => {
        const players = [];
        for (const [id, m] of membersFromPresence()) if (id !== myId) players.push({ id, name: m.name, avatar: m.avatar });
        app.emit('world:state', { diffs: worldDiffs, players });
        handlePresenceSync();
      }, 700);
    }
    let pendingPresence = false;

    // ---- 실제 Supabase 연결 ----
    function setStatus(s) { status = s; if (onStatus) onStatus(s); }

    try {
      const factory = channelFactory || defaultChannelFactory;
      const built = factory({ url, key, code });
      sb = built.sb; channel = built.channel;

      channel.on('presence', { event: 'sync' }, handlePresenceSync);
      const EVENTS = ['p:move', 'p:shoot', 'p:emote', 'p:style', 'w:break', 'w:place', 'w:bomb', 'quiz:launched', 'quiz:closed', 'sync:req', 'world:sync'];
      for (const ev of EVENTS) channel.on('broadcast', { event: ev }, (m) => onBroadcast(ev, m.payload));

      const failTimer = setTimeout(() => { if (!subscribed) { setStatus('failed'); app.emit('connect_error', new Error('realtime timeout')); } }, 9000);
      channel.subscribe((st, err) => {
        if (st === 'SUBSCRIBED') {
          clearTimeout(failTimer);
          subscribed = true;
          setStatus('connected');
          app.emit('connect');
          if (pendingPresence) { pendingPresence = false; startPresence(); }
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          if (!subscribed) { setStatus('failed'); app.emit('connect_error', err || new Error(st)); }
        }
      });
    } catch (e) {
      setStatus('failed');
      console.error('[net] connect 실패:', e && e.message);
    }

    // 게임/심에서 쓰는 부가 API
    return {
      socket,
      getLeaderboard: leaderboard,
      getQuiz: () => currentQuiz,
      getClosedQuizId: () => quizClosedId,
      setMyStats(s) { Object.assign(myState, s); trackSoon(); },
      pushQuiz(quiz) { currentQuiz = quiz; quizClosedId = null; myState.t = Date.now(); trackSoon(); bsend('quiz:launched', { quiz }); app.emit('quiz:launched', { quiz }); },
      closeQuiz(quizId) { quizClosedId = quizId; bsend('quiz:closed', { quizId }); },
      status: () => status,
      _internal: { onBroadcast, membersFromPresence, leaderboard, foldDiff, worldDiffs, app, socket, startPresence, setSubscribed(v) { subscribed = v; } },
    };
  }

  function defaultChannelFactory({ url, key, code }) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('supabase-js 미로드');
    const sb = window.supabase.createClient(url, key, { realtime: { params: { eventsPerSecond: 24 } } });
    const channel = sb.channel(CHAN_PREFIX + String(code).toUpperCase(), {
      config: { presence: { key: String(code).toUpperCase() + ':' + Math.random().toString(36).slice(2, 8) }, broadcast: { self: false } },
    });
    return { sb, channel };
  }

  window.BQNet = { connect, makeEmitter };
})();
