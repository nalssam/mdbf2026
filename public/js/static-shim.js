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

  // ---------- 데모 상태 (localStorage) ----------
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem('bq_demo_state')) || { student: null, answers: {} };
    } catch { return { student: null, answers: {} }; }
  }
  function saveState(s) { localStorage.setItem('bq_demo_state', JSON.stringify(s)); }

  function publicQuiz() {
    return {
      id: DEMO_QUIZ.id, title: DEMO_QUIZ.title, summary: DEMO_QUIZ.summary,
      objectives: DEMO_QUIZ.objectives, status: 'live', timeLimitSec: DEMO_QUIZ.timeLimitSec,
      questions: DEMO_QUIZ.questions.map((q) => ({ type: q.type, prompt: q.prompt, choices: q.choices, difficulty: q.difficulty })),
    };
  }
  function myAnswersPayload(s) {
    const out = {};
    for (const [qi, a] of Object.entries(s.answers)) {
      const q = DEMO_QUIZ.questions[qi];
      out[qi] = { choiceIndex: a.choiceIndex, correct: a.correct, points: a.points, answerIndex: q.answerIndex, explanation: q.explanation };
    }
    return out;
  }
  function leaderboard(s) {
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

    if (route === 'join') {
      if (!s.student || s.student.name !== body.name) {
        s.student = {
          id: 'demo-me', secret: 'demo', name: String(body.name || '체험학생').slice(0, 16),
          avatar: body.avatar || 'steve',
          points: 0, correct: 0, answered: 0, streak: 0, bestStreak: 0, online: true,
        };
        s.answers = {};
      } else {
        s.student.avatar = body.avatar || s.student.avatar;
      }
      saveState(s);
      return json({
        classId: 'demo-class', className: '체험 학급 (온라인 데모)', teacherName: 'BlockQuest',
        student: s.student, activeQuiz: publicQuiz(), myAnswers: myAnswersPayload(s), leaderboard: leaderboard(s),
      });
    }

    if (route === 'student/state') {
      if (!s.student) return json({ error: '데모 세션이 없습니다. 다시 입장해 주세요.' }, 404);
      return json({
        className: '체험 학급 (온라인 데모)', student: s.student,
        activeQuiz: publicQuiz(), myAnswers: myAnswersPayload(s), leaderboard: leaderboard(s),
      });
    }

    if (route === 'answer') {
      if (!s.student) return json({ error: '데모 세션이 없습니다.' }, 404);
      const qi = Number(body.questionIndex);
      const q = DEMO_QUIZ.questions[qi];
      if (!q) return json({ error: '문항 번호가 올바르지 않습니다.' }, 400);
      if (s.answers[qi]) return json({ error: '이미 답한 문항입니다.' }, 409);
      const ci = Number(body.choiceIndex);
      const correct = ci === q.answerIndex;
      const t = Math.min(Math.max(Number(body.timeMs) || 0, 0), 600000);
      let points = 0;
      if (correct) {
        const limitMs = DEMO_QUIZ.timeLimitSec * 1000;
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
      return json({
        correct, points, answerIndex: q.answerIndex, explanation: q.explanation,
        streak: s.student.streak, totalPoints: s.student.points,
        completed: Object.keys(s.answers).length >= DEMO_QUIZ.questions.length,
      });
    }

    if (route === 'leaderboard') return json(leaderboard(s));

    return json({ error: '🌐 체험판에서는 교사(관리자) 기능을 사용할 수 없습니다. 전체 기능은 서버 실행이 필요해요 — GitHub 저장소의 README를 참고하세요!' }, 400);
  };

  // ---------- socket.io 대체 (멀티플레이 없음) ----------
  const fakeSocket = {
    connected: false,
    on() { return this; },
    once() { return this; },
    off() { return this; },
    emit() { return this; },
    close() {},
  };
  window.io = function () { return fakeSocket; };
})();
