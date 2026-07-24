// 학생 퀴즈 플레이 화면
(function () {
  const session = JSON.parse(localStorage.getItem('bq_student') || 'null');
  if (!session) { location.href = './'; return; }

  BQ.buildWorld();
  const $ = (id) => document.getElementById(id);
  const views = ['view-lobby', 'view-intro', 'view-question', 'view-result'];
  function show(view) {
    views.forEach((v) => $(v).classList.toggle('hidden', v !== view));
  }

  let me = null;
  let quiz = null;          // 현재 진행 중인 퀴즈 (정답 미포함)
  let myAnswers = {};       // {questionIndex: {choiceIndex, correct, points, answerIndex, explanation}}
  let currentQ = 0;
  let questionShownAt = 0;
  let timerHandle = null;
  let board = { rankings: [], classTotal: 0 };

  BQ.drawAvatar($('me-avatar'), session.avatar, 40);
  $('me-name').textContent = session.name;

  // ---------- 접속 QR (튕겼을 때 재접속) ----------
  $('btn-qr').addEventListener('click', () => {
    const url = new URL('./?code=' + encodeURIComponent(session.code || ''), location.href).href;
    $('qr-code').textContent = session.code || '------';
    BQ.makeQR($('qr-canvas'), url, { scale: 6 });
    $('qr-overlay').classList.remove('hidden');
    BQ.sound('click');
  });
  $('qr-close').addEventListener('click', () => $('qr-overlay').classList.add('hidden'));

  // ---------- 상단 상태 ----------
  function renderTop() {
    if (!me) return;
    $('me-points').textContent = BQ.fmt(me.points);
    $('streak').textContent = '🔥' + (me.streak || 0);
    const p = BQ.levelProgress(me.points);
    $('xp-fill').style.width = p.pct + '%';
    $('xp-lbl').textContent = 'Lv.' + p.lv;
  }

  function renderBoard(el, limit) {
    const rows = board.rankings.slice(0, limit || 10);
    el.innerHTML = rows.map((r) => `
      <div class="lb-row r${r.rank} ${r.id === session.studentId ? 'me' : ''}">
        <span class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
        <img src="${BQ.avatarDataURL(r.avatar, 32)}" width="32" height="32" style="border:2px solid var(--ink)" alt="" />
        <span class="nm">${BQ.esc(r.name)}</span>
        <span class="pts">${BQ.fmt(r.points)}P</span>
      </div>`).join('') || '<div class="muted">아직 아무도 없어요</div>';
  }

  function renderClassXp(fillId, lblId) {
    const total = board.classTotal || 0;
    const goal = Math.max(1000, Math.ceil((total + 1) / 5000) * 5000);
    $(fillId).style.width = Math.min(100, (total / goal) * 100) + '%';
    $(lblId).textContent = `학급 포인트 ${BQ.fmt(total)} / ${BQ.fmt(goal)}`;
  }

  function renderLobby() {
    renderBoard($('lobby-board'));
    renderClassXp('class-xp-fill', 'class-xp-lbl');
  }

  // ---------- 퀴즈 진행 ----------
  function firstUnanswered() {
    if (!quiz) return 0;
    for (let i = 0; i < quiz.questions.length; i++) {
      if (!myAnswers[i]) return i;
    }
    return quiz.questions.length;
  }

  function startQuizFlow() {
    const next = firstUnanswered();
    if (next >= quiz.questions.length) return showResult();
    currentQ = next;
    showQuestion();
  }

  function showQuestion() {
    show('view-question');
    const q = quiz.questions[currentQ];
    $('q-no').textContent = `${currentQ + 1} / ${quiz.questions.length}`;
    $('q-text').textContent = q.prompt;

    const hearts = $('q-hearts');
    hearts.innerHTML = quiz.questions.map((_, i) => {
      const a = myAnswers[i];
      const cls = a ? (a.correct ? 'ok' : 'bad') : i === currentQ ? 'now' : '';
      return `<div class="h ${cls}"></div>`;
    }).join('');

    const grid = $('q-choices');
    grid.className = 'choice-grid' + (q.type === 'ox' ? ' ox' : '');
    grid.innerHTML = '';
    const keys = q.type === 'ox' ? ['O', 'X'] : ['A', 'B', 'C', 'D'];
    q.choices.forEach((choice, ci) => {
      const btn = document.createElement('button');
      btn.className = `choice c${ci}`;
      btn.innerHTML = `<span class="key">${keys[ci]}</span>${BQ.esc(choice)}`;
      btn.addEventListener('click', () => submitAnswer(ci, btn));
      grid.appendChild(btn);
    });

    questionShownAt = Date.now();
    startTimer();
  }

  function startTimer() {
    stopTimer();
    const limitMs = (quiz.timeLimitSec || 20) * 1000;
    const bar = $('timer-fill');
    $('timerbar').classList.remove('hurry');
    $('timer-msg').textContent = '⚡ 빨리 맞히면 보너스 포인트!';
    timerHandle = setInterval(() => {
      const remain = Math.max(0, limitMs - (Date.now() - questionShownAt));
      bar.style.width = (remain / limitMs) * 100 + '%';
      if (remain < limitMs * 0.3) $('timerbar').classList.add('hurry');
      if (remain <= 0) {
        stopTimer();
        bar.style.width = '0%';
        $('timer-msg').textContent = '⏰ 보너스 시간 종료! 그래도 정답을 골라 보세요.';
      }
    }, 150);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  async function submitAnswer(choiceIndex, btnEl) {
    if (myAnswers[currentQ]) return;
    stopTimer();
    document.querySelectorAll('#q-choices .choice').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch('api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classId: session.classId,
          studentId: session.studentId,
          secret: session.secret,
          quizId: quiz.id,
          questionIndex: currentQ,
          choiceIndex,
          timeMs: Date.now() - questionShownAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '제출에 실패했습니다.');
      myAnswers[currentQ] = { choiceIndex, ...data };
      me.points = data.totalPoints;
      me.streak = data.streak;
      renderTop();

      // 정답 공개 연출
      const btns = document.querySelectorAll('#q-choices .choice');
      btns.forEach((b, i) => {
        if (i === data.answerIndex) b.classList.add('reveal-correct');
        else if (i === choiceIndex) b.classList.add('picked-wrong');
        else b.classList.add('reveal-wrong');
      });
      const rect = btnEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      if (data.correct) {
        BQ.sound('correct');
        BQ.blockBurst(cx, cy, ['#80e61d', '#ffcf3f', '#6fbf44', '#fff']);
        BQ.floatText(cx - 40, cy - 30, `+${data.points}P`);
      } else {
        BQ.sound('wrong');
        BQ.blockBurst(cx, cy, ['#5a5a5a', '#3a3a3a', '#e2504c'], 14);
      }
      setTimeout(() => showFeedback(data), 700);
    } catch (err) {
      alert(err.message);
      document.querySelectorAll('#q-choices .choice').forEach((b) => (b.disabled = false));
      startTimer();
    }
  }

  function showFeedback(data) {
    const panel = $('fb-panel');
    panel.classList.toggle('good', data.correct);
    panel.classList.toggle('bad', !data.correct);
    $('fb-emoji').textContent = data.correct ? ['💎', '⛏️', '🌟', '🧱'][Math.floor(Math.random() * 4)] : '💥';
    $('fb-title').textContent = data.correct
      ? (data.streak >= 3 ? `${data.streak}연속 정답! 콤보!` : '정답! 블록 획득!')
      : '아쉬워요! 크리퍼가 나타났다!';
    $('fb-points').textContent = data.correct ? `+${data.points} 포인트` : '+0 포인트';
    $('fb-explain').textContent = data.explanation || '';
    $('btn-next').textContent = currentQ + 1 >= quiz.questions.length ? '결과 보기 🏁' : '다음 ▶';
    $('fb-overlay').classList.remove('hidden');
  }

  $('btn-next').addEventListener('click', () => {
    $('fb-overlay').classList.add('hidden');
    BQ.sound('click');
    startQuizFlow();
  });

  function showResult() {
    stopTimer();
    show('view-result');
    const answers = Object.values(myAnswers);
    const myScore = answers.reduce((t, a) => t + (a.points || 0), 0);
    const correctCount = answers.filter((a) => a.correct).length;
    $('result-score').textContent = BQ.fmt(myScore);
    const myRank = board.rankings.find((r) => r.id === session.studentId);
    $('result-detail').textContent =
      `${quiz.questions.length}문제 중 ${correctCount}개 정답` + (myRank ? ` · 현재 ${myRank.rank}위` : '');
    renderPodium();
    renderBoard($('result-board'), 10);
    renderClassXp('result-class-fill', 'result-class-lbl');
    BQ.sound('levelup');
    BQ.blockBurst(innerWidth / 2, innerHeight / 3, ['#ffcf3f', '#80e61d', '#ffffff', '#6ea0f2'], 60);
  }

  function renderPodium() {
    const top3 = board.rankings.slice(0, 3);
    const order = [1, 0, 2]; // 2등-1등-3등 배치
    $('result-podium').innerHTML = order
      .filter((i) => top3[i])
      .map((i) => {
        const r = top3[i];
        return `<div class="col">
          <img src="${BQ.avatarDataURL(r.avatar, 48)}" width="48" height="48" style="border:3px solid var(--ink)" alt="" />
          <div class="pillar p${r.rank}">${r.rank}</div>
          <div class="nm">${BQ.esc(r.name)}<br/><b>${BQ.fmt(r.points)}P</b></div>
        </div>`;
      }).join('');
  }

  $('btn-back-lobby').addEventListener('click', () => { show('view-lobby'); renderLobby(); });
  $('btn-start').addEventListener('click', () => { BQ.sound('start'); startQuizFlow(); });

  // ---------- 서버 연결 ----------
  function adoptQuiz(q, answers) {
    quiz = q;
    myAnswers = answers || {};
  }

  async function loadState() {
    const qs = new URLSearchParams({ classId: session.classId, studentId: session.studentId, secret: session.secret || '' });
    const res = await fetch(`api/student/state?${qs}`);
    const data = await res.json();
    if (!res.ok) { localStorage.removeItem('bq_student'); location.href = './'; return; }
    me = data.student;
    board = data.leaderboard;
    $('class-name').textContent = data.className;
    renderTop();
    if (data.activeQuiz) {
      adoptQuiz(data.activeQuiz, data.myAnswers);
      if (firstUnanswered() >= quiz.questions.length) showResult();
      else showIntro();
    } else {
      show('view-lobby');
      renderLobby();
    }
  }

  function showIntro() {
    show('view-intro');
    $('intro-title').textContent = quiz.title;
    $('intro-summary').textContent = quiz.summary || '';
    $('intro-objectives').innerHTML = (quiz.objectives || []).map((o) => `<li>${BQ.esc(o)}</li>`).join('');
    $('intro-count').textContent = `총 ${quiz.questions.length}문제 · 문제당 보너스 시간 ${quiz.timeLimitSec || 20}초`;
    const done = firstUnanswered();
    $('btn-start').textContent = done > 0 ? `⚔️ 이어서 풀기 (${done + 1}번부터)` : '⚔️ 모험 시작!';
  }

  const socket = io();
  socket.on('connect', () => {
    socket.emit('join', {
      classId: session.classId, role: 'student',
      studentId: session.studentId, secret: session.secret, mode: 'classic',
    });
  });
  socket.on('quiz:launched', ({ quiz: q }) => {
    adoptQuiz(q, {});
    BQ.sound('start');
    showIntro();
  });
  socket.on('quiz:closed', ({ quizId }) => {
    if (quiz && quiz.id === quizId) {
      $('fb-overlay').classList.add('hidden');
      showResult();
      quiz = null;
    }
  });
  socket.on('leaderboard:update', (data) => {
    board = data;
    if (!$('view-lobby').classList.contains('hidden')) renderLobby();
    if (!$('view-result').classList.contains('hidden')) {
      renderPodium();
      renderBoard($('result-board'), 10);
      renderClassXp('result-class-fill', 'result-class-lbl');
    }
    const mine = board.rankings.find((r) => r.id === session.studentId);
    if (mine && me) { me.points = mine.points; renderTop(); }
  });

  loadState();
})();
