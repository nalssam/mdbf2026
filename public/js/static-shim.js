// 정적 호스팅(GitHub Pages·Vercel) 체험판 심(shim)
// 서버가 없는 환경에서 api/* fetch와 socket.io를 클라이언트 데모로 대체한다.
// Node 서버에서 실행 중일 때는 아무 것도 하지 않는다.
(function () {
  if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('bq_demo', '1');
  const isStatic =
    /\.github\.io$/.test(location.hostname) ||
    /\.vercel\.app$/.test(location.hostname) ||
    location.protocol === 'file:' ||
    sessionStorage.getItem('bq_demo') === '1';
  window.BQ_DEMO = isStatic;
  if (!isStatic) return;

  // ---------- 데모 퀴즈 (광합성) ----------
  const DEMO_QUIZ = {
    id: 'demo-quiz-photosynthesis',
    title: '광합성 데모 퀴즈',
    summary: '식물이 빛으로 양분을 만드는 광합성의 원리를 확인해 봅시다.',
    objectives: [
      '광합성의 재료와 생성물을 말할 수 있다.',
      '광합성이 일어나는 장소를 설명할 수 있다.',
      '광합성에 영향을 주는 환경 요인을 이해할 수 있다.',
    ],
    status: 'live',
    timeLimitSec: 20,
    questions: [
      { type: 'mcq', prompt: '식물이 빛 에너지를 이용해 이산화탄소와 물로 양분을 만드는 과정은?', choices: ['호흡', '광합성', '증산 작용', '소화'], answerIndex: 1, explanation: '광합성은 빛 에너지로 이산화탄소와 물을 이용해 포도당과 산소를 만드는 과정입니다.', objectiveIndex: 0, difficulty: 'easy' },
      { type: 'mcq', prompt: '광합성이 주로 일어나는 세포 속 기관은?', choices: ['미토콘드리아', '핵', '엽록체', '세포벽'], answerIndex: 2, explanation: '광합성은 초록색 색소인 엽록소가 들어 있는 엽록체에서 일어납니다.', objectiveIndex: 1, difficulty: 'medium' },
      { type: 'mcq', prompt: '광합성 결과 만들어져 공기 중으로 나오는 기체는?', choices: ['이산화탄소', '질소', '수소', '산소'], answerIndex: 3, explanation: '광합성으로 포도당과 함께 산소가 만들어져 기공으로 방출됩니다.', objectiveIndex: 0, difficulty: 'easy' },
      { type: 'mcq', prompt: '광합성에 필요한 물은 어디에서 흡수되나요?', choices: ['뿌리', '꽃', '열매', '기공'], answerIndex: 0, explanation: '물은 뿌리에서 흡수되어 물관을 타고 잎까지 이동합니다.', objectiveIndex: 2, difficulty: 'medium' },
      { type: 'ox', prompt: '식물의 호흡은 빛이 있는 낮에만 일어난다. (O/X)', choices: ['O', 'X'], answerIndex: 1, explanation: '호흡은 낮과 밤 관계없이 항상 일어납니다. 낮에만 일어나는 것은 광합성입니다.', objectiveIndex: 2, difficulty: 'medium' },
      { type: 'ox', prompt: '빛의 세기가 강할수록 광합성은 대체로 활발해진다. (O/X)', choices: ['O', 'X'], answerIndex: 0, explanation: '일정 범위에서는 빛이 강할수록 광합성이 활발하게 일어납니다.', objectiveIndex: 2, difficulty: 'easy' },
    ],
  };

  const BOTS = [
    { id: 'bot1', name: '엔더드래곤', avatar: 'ender', points: 860, correct: 6, answered: 7, bestStreak: 5, online: true },
    { id: 'bot2', name: '크리퍼헌터', avatar: 'creeper', points: 640, correct: 5, answered: 7, bestStreak: 3, online: true },
    { id: 'bot3', name: '분홍돼지', avatar: 'pig', points: 420, correct: 4, answered: 6, bestStreak: 2, online: false },
    { id: 'bot4', name: '뼈다귀궁수', avatar: 'skeleton', points: 250, correct: 2, answered: 5, bestStreak: 1, online: true },
  ];

  // ---------- 인벤토리/복습 보상 (서버 계약과 동일 값) ----------
  const DECOR_TYPES = ['sand', 'snow', 'ice', 'glass', 'gold', 'tramp', 'fan'];
  // 코스메틱(모자/펫) — 보유 목록에는 'hat:키'/'pet:키' 형식으로 저장
  const COSMETIC_POOL = [
    'hat:cap', 'hat:crown', 'hat:wizard', 'hat:leaf',
    'pet:chick', 'pet:slime', 'pet:ghost', 'pet:star',
  ];
  const PRACTICE_DAILY_LIMIT = 3; // 문항당 하루 복습 보상 횟수 제한 (서버와 동일)

  // ---------- 실시간(동시접속) 계층 ----------
  // Supabase Realtime이 설정돼 있으면, 같은 학급 코드로 접속한 학생들이 한 월드에 함께 있게 된다.
  // 연결이 안 되면(설정 없음/네트워크 차단) 아무 피어 없는 "혼자 데모"로 자연 degrade 된다.
  function rtAvailable() {
    return !!(window.BQ_NET && window.BQ_NET.supabaseUrl && window.BQNet && window.supabase);
  }
  // 학생 페이지(world/play)에서 io()가 호출될 때 한 번 생성되는 실시간 연결
  let studentNet = null;
  function studentSession() {
    try { return JSON.parse(localStorage.getItem('bq_student') || 'null'); } catch { return null; }
  }
  function getStudentNet() {
    if (studentNet) return studentNet;
    if (!rtAvailable()) return null;
    const sess = studentSession();
    if (!sess || !sess.code || !sess.studentId) return null;
    try {
      studentNet = window.BQNet.connect({
        url: window.BQ_NET.supabaseUrl, key: window.BQ_NET.supabaseKey,
        code: sess.code, isTeacher: false,
        self: { studentId: sess.studentId, name: sess.name, avatar: sess.avatar },
        onStatus: (st) => { window.dispatchEvent(new CustomEvent('bq-net-status', { detail: st })); },
      });
      window.__bqStudentNet = studentNet;
    } catch (e) { studentNet = null; }
    return studentNet;
  }
  // 교사 페이지에서 사용할 실시간 연결 생성기 (teacher.js가 직접 호출)
  window.bqConnectRealtime = function (code, self, isTeacher) {
    if (!rtAvailable()) return null;
    try {
      return window.BQNet.connect({
        url: window.BQ_NET.supabaseUrl, key: window.BQ_NET.supabaseKey,
        code, isTeacher: !!isTeacher, self,
      });
    } catch (e) { return null; }
  };

  function randId(prefix) { return prefix + Math.random().toString(36).slice(2, 10); }

  // ---------- 데모 상태 (localStorage) ----------
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem('bq_demo_state')) || { student: null, answers: {} };
    } catch { return { student: null, answers: {} }; }
  }
  function saveState(s) { localStorage.setItem('bq_demo_state', JSON.stringify(s)); }

  // 현재 활성 퀴즈(정답 포함) — 교사가 실시간으로 시작한 퀴즈가 있으면 그것을, 없으면 데모 퀴즈를 쓴다
  function activeFullQuiz() {
    const net = studentNet;
    const pushed = net && net.getQuiz && net.getQuiz();
    if (pushed && Array.isArray(pushed.questions) && pushed.questions.length) return pushed;
    return DEMO_QUIZ;
  }

  // 기존 저장 상태에 인벤토리가 없으면 게으르게 초기화한다 (서버 ensureInventory와 동일 형태)
  function ensureInventory(s) {
    if (!s.inventory || typeof s.inventory !== 'object') {
      s.inventory = { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null };
    }
    const inv = s.inventory;
    if (typeof inv.coins !== 'number') inv.coins = 0;
    if (!inv.decors || typeof inv.decors !== 'object') inv.decors = {};
    if (!Array.isArray(inv.cosmetics)) inv.cosmetics = [];
    if (inv.hat === undefined) inv.hat = null;
    if (inv.pet === undefined) inv.pet = null;
    return inv;
  }

  // 복습 보상 횟수 제한용 — 로컬 날짜 문자열
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // 복습 정답 보상 롤: 코인 +3 (55%) / 장식 블록 +2 (30%) / 코스메틱 1종 (15%, 미보유 우선) — 서버와 동일 확률
  function rollPracticeReward(inv) {
    const r = Math.random();
    if (r < 0.55) {
      inv.coins += 3;
      return { kind: 'coins', type: null, qty: 3 };
    }
    if (r < 0.85) {
      const type = DECOR_TYPES[Math.floor(Math.random() * DECOR_TYPES.length)];
      inv.decors[type] = (inv.decors[type] || 0) + 2;
      return { kind: 'decor', type, qty: 2 };
    }
    const unowned = COSMETIC_POOL.filter((c) => !inv.cosmetics.includes(c));
    if (!unowned.length) {
      // 코스메틱을 전부 모았다면 코인으로 대체
      inv.coins += 5;
      return { kind: 'coins', type: null, qty: 5 };
    }
    const type = unowned[Math.floor(Math.random() * unowned.length)];
    inv.cosmetics.push(type);
    return { kind: 'cosmetic', type, qty: 1 };
  }

  function publicQuiz(quiz) {
    const q = quiz || activeFullQuiz();
    return {
      id: q.id, title: q.title, summary: q.summary,
      objectives: q.objectives, status: 'live', timeLimitSec: q.timeLimitSec || 20,
      questions: q.questions.map((qq) => ({ type: qq.type, prompt: qq.prompt, choices: qq.choices, difficulty: qq.difficulty })),
    };
  }
  // 활성 퀴즈가 바뀌면(교사가 새 퀴즈 시작) 답안 기록을 초기화한다
  function syncAnswerQuiz(s) {
    const q = activeFullQuiz();
    if (s.answersQuizId !== q.id) { s.answers = {}; s.answersQuizId = q.id; }
    return q;
  }
  function myAnswersPayload(s) {
    const q = activeFullQuiz();
    const out = {};
    for (const [qi, a] of Object.entries(s.answers)) {
      const qq = q.questions[qi];
      if (!qq) continue;
      out[qi] = { choiceIndex: a.choiceIndex, correct: a.correct, points: a.points, answerIndex: qq.answerIndex, explanation: qq.explanation };
    }
    return out;
  }
  function leaderboard(s) {
    // 실시간 연결이 있고 다른 참가자가 보이면 → 프레즌스 기반 실제 랭킹(봇 제외)
    const net = studentNet;
    if (net && net.getLeaderboard) {
      const lb = net.getLeaderboard();
      if (lb.studentCount >= 1) {
        // 내 최신 점수를 즉시 반영(프레즌스 갱신은 약간 지연될 수 있음)
        if (s.student) {
          const mine = lb.rankings.find((r) => r.id === s.student.id);
          if (mine) { mine.points = s.student.points; mine.correct = s.student.correct; mine.answered = s.student.answered; }
          else lb.rankings.push({ id: s.student.id, name: s.student.name, avatar: s.student.avatar, points: s.student.points, correct: s.student.correct, answered: s.student.answered, bestStreak: s.student.bestStreak, online: true });
          lb.rankings.sort((a, b) => b.points - a.points);
          lb.rankings.forEach((r, i) => { r.rank = i + 1; });
          lb.classTotal = lb.rankings.reduce((t, r) => t + r.points, 0);
          lb.studentCount = lb.rankings.length;
        }
        return lb;
      }
    }
    // 혼자(연결 전/실패) — 기존 데모: 봇 + 나
    const rows = [...BOTS];
    if (s.student) {
      rows.push({
        id: s.student.id, name: s.student.name, avatar: s.student.avatar,
        points: s.student.points, correct: s.student.correct, answered: s.student.answered,
        bestStreak: s.student.bestStreak, online: true,
      });
    }
    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { rankings: rows, classTotal: rows.reduce((t, r) => t + r.points, 0), studentCount: rows.length };
  }
  function json(data, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
  }

  // ---------- api/* 가로채기 ----------
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    const u = String(url);
    const m = u.match(/(?:^|\/)api\/([^?]+)(\?.*)?$/);
    if (!m) return realFetch(url, opts);
    const route = m[1];
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const s = loadState();

    // 교사(정적 모드): 로컬 학급 생성 — 코드/QR을 발급해 학생들이 같은 실시간 방에 모이게 한다
    if (route === 'teacher/classes' && opts && opts.method === 'POST') {
      const code = randId('').toUpperCase().slice(0, 6);
      return json({
        classId: 'cls-' + code, code, teacherKey: 'tk-' + code,
        name: String(body.className || '우리 반').slice(0, 30), teacherName: String(body.teacherName || '').slice(0, 20),
      });
    }

    if (route === 'join') {
      const sameName = s.student && s.student.name === body.name;
      if (!s.student || !sameName) {
        s.student = {
          id: randId('stu-'), secret: 'demo', name: String(body.name || '체험학생').slice(0, 16),
          avatar: body.avatar || 'steve',
          points: 0, correct: 0, answered: 0, streak: 0, bestStreak: 0, online: true,
        };
        s.answers = {};
        s.answersQuizId = null;
        // 새 체험 학생 — 인벤토리/복습 기록도 새로 시작한다
        s.inventory = { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null };
        s.practice = {};
      } else {
        s.student.avatar = body.avatar || s.student.avatar;
      }
      s.room = String(body.code || 'DEMO01').toUpperCase();
      ensureInventory(s);
      saveState(s);
      return json({
        classId: s.room, className: '우리 반 (실시간)', teacherName: 'BlockQuest',
        student: s.student, activeQuiz: publicQuiz(), myAnswers: myAnswersPayload(s), leaderboard: leaderboard(s),
        mapKey: 'classic', inventory: s.inventory,
      });
    }

    if (route === 'student/state') {
      if (!s.student) return json({ error: '데모 세션이 없습니다. 다시 입장해 주세요.' }, 404);
      getStudentNet(); // 상태 조회 시점에 실시간 연결을 보장(랭킹/퀴즈 공유)
      const inv = ensureInventory(s);
      syncAnswerQuiz(s);
      saveState(s);
      return json({
        className: '우리 반 (실시간)', student: s.student,
        activeQuiz: publicQuiz(), myAnswers: myAnswersPayload(s), leaderboard: leaderboard(s),
        mapKey: 'classic', inventory: inv,
      });
    }

    if (route === 'answer') {
      if (!s.student) return json({ error: '데모 세션이 없습니다.' }, 404);
      const quiz = syncAnswerQuiz(s);
      const qi = Number(body.questionIndex);
      const q = quiz.questions[qi];
      if (!q) return json({ error: '문항 번호가 올바르지 않습니다.' }, 400);
      if (s.answers[qi]) return json({ error: '이미 답한 문항입니다.' }, 409);
      const ci = Number(body.choiceIndex);
      const correct = ci === q.answerIndex;
      const t = Math.min(Math.max(Number(body.timeMs) || 0, 0), 600000);
      let points = 0;
      if (correct) {
        const limitMs = (quiz.timeLimitSec || 20) * 1000;
        s.student.streak += 1;
        points = 100 + Math.max(0, Math.round(50 * (1 - Math.min(t, limitMs) / limitMs))) + Math.min(s.student.streak, 5) * 10;
        s.student.correct += 1;
        s.student.bestStreak = Math.max(s.student.bestStreak, s.student.streak);
      } else {
        s.student.streak = 0;
      }
      s.student.answered += 1;
      s.student.points += points;
      s.answers[qi] = { choiceIndex: ci, correct, points };
      saveState(s);
      // 내 점수를 실시간 랭킹(프레즌스)에 반영
      if (studentNet && studentNet.setMyStats) {
        studentNet.setMyStats({ points: s.student.points, correct: s.student.correct, answered: s.student.answered, streak: s.student.streak, bestStreak: s.student.bestStreak });
      }
      return json({
        correct, points, answerIndex: q.answerIndex, explanation: q.explanation,
        streak: s.student.streak, totalPoints: s.student.points,
        completed: Object.keys(s.answers).length >= quiz.questions.length,
      });
    }

    // 복습 풀이 — 포인트 없이 보상만 (정식으로 제출한 문항만 허용, 응답 형식은 서버와 동일)
    if (route === 'practice-answer') {
      if (!s.student) return json({ error: '데모 세션이 없습니다.' }, 404);
      const quiz = activeFullQuiz();
      if (body.quizId !== quiz.id) return json({ error: '퀴즈를 찾을 수 없습니다.' }, 404);
      const qi = Number(body.questionIndex);
      const q = quiz.questions[qi];
      if (!q) return json({ error: '문항 번호가 올바르지 않습니다.' }, 400);
      const ci = Number(body.choiceIndex);
      if (!(ci >= 0 && ci < q.choices.length)) return json({ error: '보기 번호가 올바르지 않습니다.' }, 400);
      // 정식 퀘스트로 제출한 문항만 복습할 수 있다
      if (!s.answers[qi]) return json({ error: '먼저 퀘스트로 풀어야 해요' }, 409);

      const correct = ci === q.answerIndex;
      const inv = ensureInventory(s);
      let reward = null;
      if (correct) {
        // 문항당 하루 3회까지만 보상 — 초과 시 reward:null로 정오답만 알려준다
        if (!s.practice || typeof s.practice !== 'object') s.practice = {};
        const pk = `${quiz.id}:${qi}`;
        const day = todayStr();
        let rec = s.practice[pk];
        if (!rec || rec.day !== day) {
          rec = { count: 0, day };
          s.practice[pk] = rec;
        }
        if (rec.count < PRACTICE_DAILY_LIMIT) {
          rec.count += 1;
          reward = rollPracticeReward(inv);
        }
      }
      saveState(s);
      return json({ correct, answerIndex: q.answerIndex, explanation: q.explanation, reward, inventory: inv });
    }

    if (route === 'leaderboard') return json(leaderboard(s));

    return json({ error: '🌐 체험판에서는 교사(관리자) 기능을 사용할 수 없습니다. 전체 기능은 서버 실행이 필요해요 — GitHub 저장소의 README를 참고하세요!' }, 400);
  };

  // ---------- socket.io 대체 ----------
  // 실시간(Supabase)이 가능하면 진짜 멀티플레이 소켓을, 아니면 무동작 스텁을 돌려준다.
  const fakeSocket = {
    connected: false,
    on() { return this; },
    once() { return this; },
    off() { return this; },
    emit() { return this; },
    close() {},
  };
  window.io = function () {
    const net = getStudentNet();
    return net && net.socket ? net.socket : fakeSocket;
  };

  // 교사 페이지(정적 모드)가 학생들에게 시작할 수 있는 기본 퀴즈
  window.BQ_DEMO_QUIZ = DEMO_QUIZ;
})();
