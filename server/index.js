// BlockQuest — 게이미피케이션 에듀테크 플랫폼 서버
// 학생: 코드/QR로 접속해 퀴즈 게임 → 포인트/랭킹
// 교사: 자료 업로드 → AI 퀴즈 생성 → 실시간 현황 + 학급 인사이트
const path = require('path');
const http = require('http');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { db, save, randomId, newClassCode, findClassByCode, getClass } = require('./store');
const { extractFromFile, extractFromUrl, extractFromText } = require('./extract');
const { generateQuiz } = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 3000;
// defParamCharset: busboy가 한글 파일명을 latin-1로 잘못 해석하지 않도록 UTF-8 지정
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, defParamCharset: 'utf8' });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// three.js 로컬 서빙 (학교망에서 CDN 의존 없이 3D 월드 구동)
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));

// 배포 환경(Render 등) 헬스체크용
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- 공통 헬퍼 ----------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireTeacher(req) {
  const cls = getClass(req.params.id);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const key = req.headers['x-teacher-key'];
  if (!key || key !== cls.teacherKey) throw httpError(403, '교사 인증에 실패했습니다.');
  return cls;
}

// 학생에게 보낼 때는 정답/해설을 제거한다
function publicQuiz(quiz) {
  if (!quiz) return null;
  return {
    id: quiz.id,
    title: quiz.title,
    summary: quiz.summary,
    objectives: quiz.objectives,
    status: quiz.status,
    timeLimitSec: quiz.timeLimitSec,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      choices: q.choices,
      difficulty: q.difficulty,
    })),
  };
}

function leaderboard(cls) {
  const rankings = Object.values(cls.students)
    .map((s) => ({
      id: s.id, name: s.name, avatar: s.avatar,
      points: s.points, correct: s.correct, answered: s.answered,
      bestStreak: s.bestStreak, online: s.online,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ko'));
  rankings.forEach((r, i) => { r.rank = i + 1; });
  const classTotal = rankings.reduce((sum, r) => sum + r.points, 0);
  return { rankings, classTotal, studentCount: rankings.length };
}

function broadcastLeaderboard(cls) {
  io.to(`c:${cls.id}`).emit('leaderboard:update', leaderboard(cls));
}

function getSubmission(cls, quizId, studentId) {
  cls.submissions[quizId] ||= {};
  cls.submissions[quizId][studentId] ||= { answers: {}, score: 0, startedAt: Date.now(), completedAt: null };
  return cls.submissions[quizId][studentId];
}

// ---------- 맵/인벤토리 공통 ----------

// 교사가 선택할 수 있는 맵(테마) 키 — 클라이언트 engine.js MAP_DEFS와 동일
const MAP_KEYS = ['classic', 'desert', 'snow', 'volcano', 'sky', 'ocean'];
// 복습 보상으로 얻는 장식 블록 종류 — 설치 시 학생 재고에서 차감된다
const DECOR_TYPES = ['sand', 'snow', 'ice', 'glass', 'gold', 'tramp', 'fan'];
const DECOR_SET = new Set(DECOR_TYPES);
// 코스메틱(모자/펫) — 보유 목록에는 'hat:키'/'pet:키' 형식으로 저장
const HAT_KEYS = new Set(['cap', 'crown', 'wizard', 'leaf']);
const PET_KEYS = new Set(['chick', 'slime', 'ghost', 'star']);
const COSMETIC_POOL = [
  'hat:cap', 'hat:crown', 'hat:wizard', 'hat:leaf',
  'pet:chick', 'pet:slime', 'pet:ghost', 'pet:star',
];
const PRACTICE_DAILY_LIMIT = 3; // 문항당 하루 복습 보상 횟수 제한

// 기존 학생 데이터에 인벤토리가 없으면 게으르게 초기화한다
function ensureInventory(student) {
  if (!student.inventory || typeof student.inventory !== 'object') {
    student.inventory = { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null };
  }
  const inv = student.inventory;
  if (typeof inv.coins !== 'number') inv.coins = 0;
  if (!inv.decors || typeof inv.decors !== 'object') inv.decors = {};
  if (!Array.isArray(inv.cosmetics)) inv.cosmetics = [];
  if (inv.hat === undefined) inv.hat = null;
  if (inv.pet === undefined) inv.pet = null;
  return inv;
}

// 복습 보상 횟수 제한용 — 서버 로컬 날짜 문자열
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 복습 정답 보상 롤: 코인 +3 (55%) / 장식 블록 +2 (30%) / 코스메틱 1종 (15%, 미보유 우선)
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

// ---------- 교사(관리자) API ----------

app.post('/api/teacher/classes', (req, res) => {
  const { className, teacherName, mapKey } = req.body || {};
  if (!className || !String(className).trim()) throw httpError(400, '학급 이름을 입력해 주세요.');
  const id = randomId('cls');
  const cls = {
    id,
    code: newClassCode(),
    name: String(className).trim().slice(0, 40),
    teacherName: String(teacherName || '선생님').trim().slice(0, 30),
    teacherKey: randomId('tk'),
    // 맵(테마)은 목록에 있는 키만 허용 — 없거나 잘못되면 기본 'classic'
    mapKey: MAP_KEYS.includes(mapKey) ? mapKey : 'classic',
    createdAt: Date.now(),
    students: {},
    quizzes: {},
    activeQuizId: null,
    submissions: {},
  };
  db.classes[id] = cls;
  save();
  res.json({ classId: id, code: cls.code, name: cls.name, teacherName: cls.teacherName, teacherKey: cls.teacherKey, mapKey: cls.mapKey });
});

app.get('/api/teacher/classes/:id', (req, res) => {
  const cls = requireTeacher(req);
  res.json({
    id: cls.id, code: cls.code, name: cls.name, teacherName: cls.teacherName,
    mapKey: cls.mapKey || 'classic',
    activeQuizId: cls.activeQuizId,
    students: Object.values(cls.students).map(publicStudent),
    quizzes: Object.values(cls.quizzes).sort((a, b) => b.createdAt - a.createdAt),
    leaderboard: leaderboard(cls),
  });
});

// 맵(테마) 변경 — 지형 변경분을 초기화하고 접속 중인 학급 전체에 알린다
app.put('/api/teacher/classes/:id/map', (req, res) => {
  const cls = requireTeacher(req);
  const { mapKey } = req.body || {};
  if (!MAP_KEYS.includes(mapKey)) throw httpError(400, '맵 종류가 올바르지 않습니다.');
  cls.mapKey = mapKey;
  // 이전 맵 기준의 블록 변경분은 새 맵과 맞지 않으므로 초기화
  const world = worlds.get(cls.id);
  if (world) {
    world.diffs = {};
    world.diffCount = 0;
  }
  save();
  io.to(`c:${cls.id}`).emit('world:map', { mapKey });
  res.json({ mapKey });
});

// 자료 업로드/URL/붙여넣기 → 텍스트 추출
app.post('/api/teacher/classes/:id/material', upload.single('file'), async (req, res) => {
  requireTeacher(req);
  let result;
  if (req.file) {
    result = await extractFromFile(req.file.buffer, req.file.originalname);
  } else if (req.body && req.body.url) {
    result = await extractFromUrl(req.body.url);
  } else if (req.body && req.body.text) {
    result = extractFromText(req.body.text, req.body.title);
  } else {
    throw httpError(400, '파일, URL 또는 텍스트 중 하나를 보내 주세요.');
  }
  res.json({
    title: result.title,
    kind: result.kind,
    chars: result.text.length,
    preview: result.text.slice(0, 600),
    sourceText: result.text,
  });
});

// AI 퀴즈 생성 (학습목표 + 문항 자동 셋팅)
app.post('/api/teacher/classes/:id/quizzes', async (req, res) => {
  const cls = requireTeacher(req);
  const { sourceText, sourceTitle, sourceKind, numQuestions } = req.body || {};
  if (!sourceText || String(sourceText).trim().length < 30) {
    throw httpError(400, '퀴즈를 생성할 자료 텍스트가 필요합니다.');
  }
  const { quiz, engine } = await generateQuiz({
    sourceText: String(sourceText),
    title: sourceTitle,
    numQuestions,
  });
  const id = randomId('qz');
  const record = {
    id,
    ...quiz,
    status: 'draft',
    engine,
    sourceTitle: sourceTitle || '',
    sourceKind: sourceKind || 'text',
    timeLimitSec: 20,
    createdAt: Date.now(),
    launchedAt: null,
  };
  cls.quizzes[id] = record;
  save();
  res.json({ quiz: record, engine });
});

// 퀴즈 편집 (문항/목표 수정)
app.put('/api/teacher/classes/:id/quizzes/:qid', (req, res) => {
  const cls = requireTeacher(req);
  const quiz = cls.quizzes[req.params.qid];
  if (!quiz) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  const { title, objectives, questions, timeLimitSec } = req.body || {};
  if (title) quiz.title = String(title).trim().slice(0, 80);
  if (Array.isArray(objectives)) quiz.objectives = objectives.map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
  if (Array.isArray(questions) && questions.length) {
    quiz.questions = questions
      .filter((q) => q && q.prompt && Array.isArray(q.choices) && q.choices.length >= 2)
      .map((q) => ({
        type: q.choices.length === 2 ? 'ox' : 'mcq',
        prompt: String(q.prompt).trim(),
        choices: q.choices.map((c) => String(c)).slice(0, 4),
        answerIndex: Math.min(Math.max(Number(q.answerIndex) || 0, 0), q.choices.length - 1),
        explanation: String(q.explanation || '').trim(),
        objectiveIndex: Math.min(Math.max(Number(q.objectiveIndex) || 0, 0), (quiz.objectives.length || 1) - 1),
        difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
      }));
  }
  if (timeLimitSec) quiz.timeLimitSec = Math.min(Math.max(Number(timeLimitSec), 10), 120);
  save();
  res.json({ quiz });
});

app.delete('/api/teacher/classes/:id/quizzes/:qid', (req, res) => {
  const cls = requireTeacher(req);
  if (!cls.quizzes[req.params.qid]) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  if (cls.activeQuizId === req.params.qid) cls.activeQuizId = null;
  delete cls.quizzes[req.params.qid];
  delete cls.submissions[req.params.qid];
  save();
  res.json({ ok: true });
});

// 퀴즈 시작 → 학생들에게 실시간 알림
app.post('/api/teacher/classes/:id/quizzes/:qid/launch', (req, res) => {
  const cls = requireTeacher(req);
  const quiz = cls.quizzes[req.params.qid];
  if (!quiz) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  if (cls.activeQuizId && cls.activeQuizId !== quiz.id) {
    const prev = cls.quizzes[cls.activeQuizId];
    if (prev) prev.status = 'closed';
  }
  quiz.status = 'live';
  quiz.launchedAt = Date.now();
  cls.activeQuizId = quiz.id;
  save();
  io.to(`c:${cls.id}`).emit('quiz:launched', { quiz: publicQuiz(quiz) });
  res.json({ quiz });
});

app.post('/api/teacher/classes/:id/quizzes/:qid/close', (req, res) => {
  const cls = requireTeacher(req);
  const quiz = cls.quizzes[req.params.qid];
  if (!quiz) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  quiz.status = 'closed';
  if (cls.activeQuizId === quiz.id) cls.activeQuizId = null;
  save();
  io.to(`c:${cls.id}`).emit('quiz:closed', { quizId: quiz.id });
  res.json({ quiz });
});

// 실시간 풀이 현황 (학생 × 문항 매트릭스)
app.get('/api/teacher/classes/:id/live', (req, res) => {
  const cls = requireTeacher(req);
  const quizId = req.query.quizId || cls.activeQuizId;
  const quiz = quizId ? cls.quizzes[quizId] : null;
  if (!quiz) return res.json({ quiz: null, students: [] });
  const subs = cls.submissions[quiz.id] || {};
  const students = Object.values(cls.students).map((s) => {
    const sub = subs[s.id];
    return {
      id: s.id, name: s.name, avatar: s.avatar, online: s.online, points: s.points,
      score: sub ? sub.score : 0,
      completedAt: sub ? sub.completedAt : null,
      answers: quiz.questions.map((_, qi) => {
        const a = sub && sub.answers[qi];
        return a ? { correct: a.correct, timeMs: a.timeMs, choiceIndex: a.choiceIndex } : null;
      }),
    };
  });
  res.json({
    quiz: { id: quiz.id, title: quiz.title, status: quiz.status, questionCount: quiz.questions.length },
    students,
  });
});

// 학급 인사이트 (시각화용 집계)
app.get('/api/teacher/classes/:id/insights', (req, res) => {
  const cls = requireTeacher(req);
  const quizzes = Object.values(cls.quizzes);
  const quizId = req.query.quizId
    || cls.activeQuizId
    || quizzes.filter((q) => q.status === 'closed').sort((a, b) => (b.launchedAt || 0) - (a.launchedAt || 0))[0]?.id;
  const quiz = quizId ? cls.quizzes[quizId] : null;
  if (!quiz) return res.json({ quiz: null });

  const subs = cls.submissions[quiz.id] || {};
  const studentList = Object.values(cls.students);
  const nQ = quiz.questions.length;

  const perQuestion = quiz.questions.map((q, qi) => {
    let correct = 0, answered = 0, timeSum = 0;
    const wrongChoiceCounts = q.choices.map(() => 0);
    for (const sub of Object.values(subs)) {
      const a = sub.answers[qi];
      if (!a) continue;
      answered++;
      timeSum += a.timeMs || 0;
      if (a.correct) correct++;
      else wrongChoiceCounts[a.choiceIndex] = (wrongChoiceCounts[a.choiceIndex] || 0) + 1;
    }
    let commonWrong = null;
    const maxWrong = Math.max(...wrongChoiceCounts);
    if (maxWrong > 0) commonWrong = { choiceIndex: wrongChoiceCounts.indexOf(maxWrong), count: maxWrong };
    return {
      index: qi,
      prompt: q.prompt,
      type: q.type,
      difficulty: q.difficulty,
      objectiveIndex: q.objectiveIndex,
      answered,
      correct,
      correctRate: answered ? correct / answered : null,
      avgTimeMs: answered ? Math.round(timeSum / answered) : null,
      commonWrong,
      choices: q.choices,
      answerIndex: q.answerIndex,
    };
  });

  const perObjective = quiz.objectives.map((obj, oi) => {
    let correct = 0, answered = 0;
    for (const pq of perQuestion) {
      if (pq.objectiveIndex !== oi) continue;
      correct += pq.correct;
      answered += pq.answered;
    }
    return { objective: obj, correct, answered, correctRate: answered ? correct / answered : null };
  });

  const perStudent = studentList.map((s) => {
    const sub = subs[s.id];
    const answered = sub ? Object.keys(sub.answers).length : 0;
    const correct = sub ? Object.values(sub.answers).filter((a) => a.correct).length : 0;
    const timeSum = sub ? Object.values(sub.answers).reduce((t, a) => t + (a.timeMs || 0), 0) : 0;
    const accuracy = answered ? correct / answered : null;
    let mastery = 'none';
    if (answered > 0) mastery = accuracy >= 0.8 ? 'high' : accuracy >= 0.5 ? 'mid' : 'low';
    return {
      id: s.id, name: s.name, avatar: s.avatar, points: s.points,
      score: sub ? sub.score : 0,
      answered, correct, accuracy,
      avgTimeMs: answered ? Math.round(timeSum / answered) : null,
      completed: Boolean(sub && sub.completedAt),
      mastery,
    };
  });

  const participated = perStudent.filter((s) => s.answered > 0);
  const totalAnswered = perQuestion.reduce((t, q) => t + q.answered, 0);
  const totalCorrect = perQuestion.reduce((t, q) => t + q.correct, 0);
  const avgAccuracy = totalAnswered ? totalCorrect / totalAnswered : null;

  const masteryCounts = { high: 0, mid: 0, low: 0, none: 0 };
  for (const s of perStudent) masteryCounts[s.mastery]++;

  // 자동 인사이트 문장 (규칙 기반)
  const notes = [];
  if (avgAccuracy != null) notes.push(`학급 평균 정답률은 ${Math.round(avgAccuracy * 100)}%입니다.`);
  const answeredQs = perQuestion.filter((q) => q.answered > 0);
  if (answeredQs.length) {
    const hardest = [...answeredQs].sort((a, b) => a.correctRate - b.correctRate)[0];
    if (hardest.correctRate < 0.6) {
      let line = `${hardest.index + 1}번 문항의 정답률이 ${Math.round(hardest.correctRate * 100)}%로 가장 낮습니다. 관련 개념의 재지도가 필요합니다.`;
      if (hardest.commonWrong) {
        line += ` (가장 많이 고른 오답: "${hardest.choices[hardest.commonWrong.choiceIndex]}")`;
      }
      notes.push(line);
    }
    const easiest = [...answeredQs].sort((a, b) => b.correctRate - a.correctRate)[0];
    if (easiest.correctRate >= 0.9) notes.push(`${easiest.index + 1}번 문항은 정답률 ${Math.round(easiest.correctRate * 100)}%로 대부분의 학생이 이해했습니다.`);
  }
  const weakObjective = perObjective.filter((o) => o.correctRate != null).sort((a, b) => a.correctRate - b.correctRate)[0];
  if (weakObjective && weakObjective.correctRate < 0.6) {
    notes.push(`학습목표 "${weakObjective.objective}" 도달률이 ${Math.round(weakObjective.correctRate * 100)}%로 낮아 보충 지도가 필요합니다.`);
  }
  if (masteryCounts.low > 0) {
    const names = perStudent.filter((s) => s.mastery === 'low').map((s) => s.name).slice(0, 5).join(', ');
    notes.push(`도움이 필요한 학생: ${names}${masteryCounts.low > 5 ? ` 외 ${masteryCounts.low - 5}명` : ''} — 개별 피드백을 권장합니다.`);
  }
  if (participated.length && studentList.length > participated.length) {
    notes.push(`아직 ${studentList.length - participated.length}명이 퀴즈에 참여하지 않았습니다.`);
  }

  res.json({
    quiz: { id: quiz.id, title: quiz.title, status: quiz.status, questionCount: nQ, objectives: quiz.objectives },
    quizzes: quizzes.map((q) => ({ id: q.id, title: q.title, status: q.status, createdAt: q.createdAt })),
    participation: {
      joined: studentList.length,
      participated: participated.length,
      completed: perStudent.filter((s) => s.completed).length,
    },
    avgAccuracy,
    totalAnswered,
    perQuestion,
    perObjective,
    perStudent: perStudent.sort((a, b) => b.score - a.score),
    masteryCounts,
    notes,
  });
});

// ---------- 학생 API ----------

// 학생 응답에서 개인 비밀키(secret)를 제거한다 — secret은 본인에게만 전달
// 꾸미기(모자/펫)는 다른 화면에서도 보여야 하므로 최상위로 노출한다
function publicStudent(s) {
  if (!s) return s;
  const { secret, ...rest } = s;
  const inv = s.inventory || {};
  return { ...rest, hat: inv.hat || null, pet: inv.pet || null };
}

app.post('/api/join', (req, res) => {
  const { code, name, avatar, studentId, secret } = req.body || {};
  const cls = findClassByCode(code);
  if (!cls) throw httpError(404, '해당 코드의 학급이 없습니다. 코드를 다시 확인해 주세요.');
  const trimmed = String(name || '').trim().slice(0, 16);
  if (!trimmed) throw httpError(400, '닉네임을 입력해 주세요.');

  // 재접속: 같은 studentId+secret이면 기존 기록을 이어가고,
  // secret이 없으면 같은 닉네임의 "오프라인" 학생만 이어받을 수 있다 (접속 중 계정 탈취 방지)
  let student = (studentId && cls.students[studentId]) || null;
  if (student && student.secret && secret !== student.secret) student = null;
  if (!student) {
    const byName = Object.values(cls.students).find((s) => s.name === trimmed) || null;
    if (byName && (!byName.secret || secret === byName.secret || !byName.online)) student = byName;
    else if (byName && byName.online) throw httpError(409, '이미 접속 중인 닉네임입니다. 다른 닉네임을 사용해 주세요.');
  }
  if (!student) {
    student = {
      id: randomId('st'),
      secret: randomId('sec'),
      name: trimmed,
      avatar: String(avatar || 'steve').slice(0, 20),
      points: 0, correct: 0, answered: 0,
      streak: 0, bestStreak: 0, defense: 0,
      inventory: { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null },
      joinedAt: Date.now(), online: false,
    };
    cls.students[student.id] = student;
    io.to(`t:${cls.id}`).emit('student:joined', { student: publicStudent(student) });
  } else {
    if (!student.secret) student.secret = randomId('sec'); // 기존 데이터 마이그레이션
    student.name = trimmed;
    if (avatar) student.avatar = String(avatar).slice(0, 20);
  }
  const inventory = ensureInventory(student); // 기존 학생 데이터 마이그레이션 포함
  save();
  broadcastLeaderboard(cls);
  const activeQuiz = cls.activeQuizId ? cls.quizzes[cls.activeQuizId] : null;
  res.json({
    classId: cls.id,
    className: cls.name,
    teacherName: cls.teacherName,
    mapKey: cls.mapKey || 'classic',
    student,
    inventory,
    activeQuiz: publicQuiz(activeQuiz),
    myAnswers: activeQuiz ? answersFor(cls, activeQuiz.id, student.id) : null,
    leaderboard: leaderboard(cls),
  });
});

function answersFor(cls, quizId, studentId) {
  const sub = cls.submissions[quizId] && cls.submissions[quizId][studentId];
  if (!sub) return {};
  const out = {};
  const quiz = cls.quizzes[quizId];
  for (const [qi, a] of Object.entries(sub.answers)) {
    out[qi] = {
      choiceIndex: a.choiceIndex,
      correct: a.correct,
      points: a.points,
      answerIndex: quiz.questions[qi] ? quiz.questions[qi].answerIndex : null,
      explanation: quiz.questions[qi] ? quiz.questions[qi].explanation : '',
    };
  }
  return out;
}

app.get('/api/student/state', (req, res) => {
  const cls = getClass(req.query.classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const student = cls.students[req.query.studentId];
  if (!student) throw httpError(404, '학생 정보를 찾을 수 없습니다. 다시 접속해 주세요.');
  if (student.secret && req.query.secret !== student.secret) throw httpError(404, '학생 인증에 실패했습니다. 다시 접속해 주세요.');
  const activeQuiz = cls.activeQuizId ? cls.quizzes[cls.activeQuizId] : null;
  res.json({
    className: cls.name,
    mapKey: cls.mapKey || 'classic',
    student,
    inventory: ensureInventory(student),
    activeQuiz: publicQuiz(activeQuiz),
    myAnswers: activeQuiz ? answersFor(cls, activeQuiz.id, student.id) : null,
    leaderboard: leaderboard(cls),
  });
});

// 답안 제출 → 서버에서 채점 + 포인트 계산
app.post('/api/answer', (req, res) => {
  const { classId, studentId, secret, quizId, questionIndex, choiceIndex, timeMs } = req.body || {};
  const cls = getClass(classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const student = cls.students[studentId];
  if (!student) throw httpError(404, '학생 정보를 찾을 수 없습니다.');
  if (student.secret && secret !== student.secret) throw httpError(403, '학생 인증에 실패했습니다. 다시 접속해 주세요.');
  const quiz = cls.quizzes[quizId];
  if (!quiz) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  if (quiz.status !== 'live') throw httpError(409, '이미 종료된 퀴즈입니다.');
  const qi = Number(questionIndex);
  const question = quiz.questions[qi];
  if (!question) throw httpError(400, '문항 번호가 올바르지 않습니다.');
  const ci = Number(choiceIndex);
  if (!(ci >= 0 && ci < question.choices.length)) throw httpError(400, '보기 번호가 올바르지 않습니다.');

  const sub = getSubmission(cls, quiz.id, student.id);
  if (sub.answers[qi]) throw httpError(409, '이미 답한 문항입니다.');

  const correct = ci === question.answerIndex;
  const t = Math.min(Math.max(Number(timeMs) || 0, 0), 10 * 60 * 1000);
  let points = 0;
  if (correct) {
    const limitMs = (quiz.timeLimitSec || 20) * 1000;
    const speedBonus = Math.max(0, Math.round(50 * (1 - Math.min(t, limitMs) / limitMs)));
    student.streak += 1;
    const streakBonus = Math.min(student.streak, 5) * 10;
    points = 100 + speedBonus + streakBonus;
    student.correct += 1;
    student.bestStreak = Math.max(student.bestStreak, student.streak);
    student.defense = Math.min(24, (student.defense || 0) + 2); // 정답 → 방어력 +2 (최대 24)
  } else {
    student.streak = 0;
  }
  student.answered += 1;
  student.points += points;
  sub.answers[qi] = { choiceIndex: ci, correct, timeMs: t, points, at: Date.now() };
  sub.score += points;
  const answeredCount = Object.keys(sub.answers).length;
  if (answeredCount >= quiz.questions.length) sub.completedAt = Date.now();
  save();

  io.to(`t:${cls.id}`).emit('progress:update', {
    quizId: quiz.id,
    studentId: student.id,
    name: student.name,
    avatar: student.avatar,
    questionIndex: qi,
    correct,
    timeMs: t,
    points,
    score: sub.score,
    answeredCount,
    completed: Boolean(sub.completedAt),
  });
  broadcastLeaderboard(cls);

  res.json({
    correct,
    points,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    streak: student.streak,
    totalPoints: student.points,
    defense: student.defense || 0,
    completed: Boolean(sub.completedAt),
  });
});

// 좀비 처치 포인트 — 클라이언트가 보고하되 서버가 검증·상한을 둔다(어뷰징 방지)
const KILL_POINTS = { 1: 120, 2: 70, 3: 40, 4: 22, 5: 10 };
app.post('/api/kill', (req, res) => {
  const { classId, studentId, secret, level } = req.body || {};
  const cls = getClass(classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const student = cls.students[studentId];
  if (!student) throw httpError(404, '학생 정보를 찾을 수 없습니다.');
  if (student.secret && secret !== student.secret) throw httpError(403, '학생 인증에 실패했습니다.');
  const lv = Number(level);
  const base = KILL_POINTS[lv];
  if (!base) throw httpError(400, '좀비 수준이 올바르지 않습니다.');
  // 분당 처치 상한 (조작된 클라이언트의 점수 폭주 방지)
  const now = Date.now();
  if (!student.killWindow || now - student.killWindow.start > 60000) student.killWindow = { start: now, count: 0 };
  student.killWindow.count += 1;
  let points = 0;
  if (student.killWindow.count <= 60) { // 분당 60마리까지만 점수 인정
    points = base;
    student.points += points;
    save();
    broadcastLeaderboard(cls);
  }
  res.json({ points, totalPoints: student.points });
});

// 복습 풀이 → 포인트 없이 보상만 지급 (정식 제출한 문항만 허용)
app.post('/api/practice-answer', (req, res) => {
  const { classId, studentId, secret, quizId, questionIndex, choiceIndex } = req.body || {};
  const cls = getClass(classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const student = cls.students[studentId];
  if (!student) throw httpError(404, '학생 정보를 찾을 수 없습니다.');
  if (student.secret && secret !== student.secret) throw httpError(403, '학생 인증에 실패했습니다. 다시 접속해 주세요.');
  const quiz = cls.quizzes[quizId];
  if (!quiz) throw httpError(404, '퀴즈를 찾을 수 없습니다.');
  const qi = Number(questionIndex);
  const question = quiz.questions[qi];
  if (!question) throw httpError(400, '문항 번호가 올바르지 않습니다.');
  const ci = Number(choiceIndex);
  if (!(ci >= 0 && ci < question.choices.length)) throw httpError(400, '보기 번호가 올바르지 않습니다.');

  // 정식 퀘스트로 제출한 문항만 복습할 수 있다
  const sub = cls.submissions[quizId] && cls.submissions[quizId][studentId];
  if (!sub || !sub.answers[qi]) throw httpError(409, '먼저 퀘스트로 풀어야 해요');

  const correct = ci === question.answerIndex;
  const inventory = ensureInventory(student);
  let reward = null;
  if (correct) {
    student.defense = Math.min(24, (student.defense || 0) + 1); // 복습 정답 → 방어력 +1
    // 문항당 하루 3회까지만 보상 — 초과 시 reward:null로 정오답만 알려준다
    student.practice ||= {};
    const pk = `${quizId}:${qi}`;
    const day = todayStr();
    let rec = student.practice[pk];
    if (!rec || rec.day !== day) {
      rec = { count: 0, day };
      student.practice[pk] = rec;
    }
    if (rec.count < PRACTICE_DAILY_LIMIT) {
      rec.count += 1;
      reward = rollPracticeReward(inventory);
    }
  }
  save();
  res.json({
    correct,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    reward,
    inventory,
    defense: student.defense || 0,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const cls = getClass(req.query.classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  res.json(leaderboard(cls));
});

// 접속용 QR 코드 (PNG)
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) throw httpError(400, 'text 파라미터가 필요합니다.');
  const png = await QRCode.toBuffer(text, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
  res.type('png').send(png);
});

// ---------- 에러 핸들러 ----------

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[server]', err);
  res.status(status).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

// ---------- Socket.IO 실시간 ----------

// 3D 월드 상태(블록 변경분)는 학급별 메모리로만 유지한다 — 서버 재시작 시 지형 리셋.
const worlds = new Map(); // classId → { diffs, diffCount, players: Map<studentId, {id,name,avatar,hat,pet}> }
const MAX_WORLD_DIFFS = 20000;
const PLACEABLE_TYPES = new Set(['plank', 'brick', 'wood', 'leaf', 'crate', 'sand', 'snow', 'ice', 'glass', 'gold', 'tramp', 'fan']);
const WORLD_R = 72; // 클라이언트 엔진과 동일한 아레나 반경

// 학생별 동시 접속 소켓 수 (탭 2개/재접속 겹침에서 유령 퇴장 방지) — 전체/월드 모드 별도 집계
const sockCounts = new Map(); // `${classId}:${studentId}` → { t: 전체, w: 월드 }

function getWorld(classId) {
  if (!worlds.has(classId)) worlds.set(classId, { diffs: {}, diffCount: 0, players: new Map() });
  return worlds.get(classId);
}

function validKey(key) {
  return typeof key === 'string' && key.length <= 20 && /^-?\d+,-?\d+,-?\d+$/.test(key);
}

// 바닥/외곽 벽은 어떤 경로로도 파괴 불가 (조작된 클라이언트 방어)
function isProtectedCell(key) {
  const [x, y, z] = key.split(',').map(Number);
  if (y <= 0) return true;
  if (y <= 2 && (Math.abs(x) >= WORLD_R || Math.abs(z) >= WORLD_R)) return true;
  return false;
}

function setDiff(world, key, value) {
  if (!(key in world.diffs)) {
    if (world.diffCount >= MAX_WORLD_DIFFS) return false;
    world.diffCount += 1;
  }
  world.diffs[key] = value;
  return true;
}

// 초당 이벤트 상한 (플러딩 방어) — 초과분은 조용히 버린다
const RATE_LIMITS = { 'p:move': 20, 'p:shoot': 6, 'w:break': 15, 'w:place': 15, 'w:bomb': 3, 'p:style': 2, 'p:emote': 2, join: 5 };
function allowRate(socket, evt) {
  const now = Math.floor(Date.now() / 1000);
  let rl = socket.data && socket.data.rl;
  if (!rl || rl.sec !== now) {
    rl = { sec: now, counts: {} };
    socket.data = socket.data || {};
    socket.data.rl = rl;
  }
  rl.counts[evt] = (rl.counts[evt] || 0) + 1;
  return rl.counts[evt] <= (RATE_LIMITS[evt] || 10);
}

// 핸들러에서 예외가 나도 서버가 죽지 않도록 감싼다
function safeOn(socket, evt, handler) {
  socket.on(evt, (payload) => {
    try {
      if (!allowRate(socket, evt)) return;
      handler(payload && typeof payload === 'object' ? payload : {});
    } catch (err) {
      console.error(`[socket:${evt}]`, err.message);
    }
  });
}

io.on('connection', (socket) => {
  safeOn(socket, 'join', ({ classId, role, studentId, teacherKey, secret, mode }) => {
    const cls = getClass(classId);
    if (!cls) return;
    if (role === 'teacher') {
      if (teacherKey !== cls.teacherKey) return; // 검증 실패 시 어떤 룸에도 넣지 않는다
      socket.join(`c:${classId}`);
      socket.join(`t:${classId}`);
      socket.data = { ...socket.data, classId, role: 'teacher' };
      return;
    }
    if (role !== 'student') return;
    const student = cls.students[studentId];
    if (!student) return;
    if (student.secret && secret !== student.secret) return;

    socket.join(`c:${classId}`);
    const isWorld = mode === 'world';
    socket.data = { ...socket.data, classId, role: 'student', studentId, world: isWorld };
    const countKey = `${classId}:${studentId}`;
    const counts = sockCounts.get(countKey) || { t: 0, w: 0 };
    counts.t += 1;
    if (isWorld) counts.w += 1;
    sockCounts.set(countKey, counts);
    student.online = true;
    io.to(`t:${classId}`).emit('student:presence', { studentId, online: true });
    save();

    // 3D 월드 페이지만 월드 룸/플레이어 목록에 참여한다 (클래식 페이지의 유령 아바타 방지)
    if (isWorld) {
      socket.join(`w:${classId}`);
      const world = getWorld(classId);
      const already = world.players.has(studentId);
      const inv = ensureInventory(student);
      world.players.set(studentId, { id: studentId, name: student.name, avatar: student.avatar, hat: inv.hat, pet: inv.pet });
      socket.emit('world:state', {
        diffs: world.diffs,
        players: [...world.players.values()].filter((p) => p.id !== studentId),
      });
      if (!already) {
        socket.to(`w:${classId}`).emit('p:join', { id: studentId, name: student.name, avatar: student.avatar, hat: inv.hat, pet: inv.pet });
      }
    }
  });

  // 플레이어 이동 (volatile — 손실 허용, 10Hz 스로틀은 클라이언트 담당)
  safeOn(socket, 'p:move', (pos) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world) return;
    socket.volatile.to(`w:${classId}`).emit('p:move', {
      id: studentId,
      x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0,
      yaw: Number(pos.yaw) || 0, anim: pos.anim === 'walk' ? 'walk' : 'idle',
    });
  });

  // 블록 파괴/설치/폭탄 — 변경분을 저장해 늦게 입장한 학생도 같은 지형을 본다
  safeOn(socket, 'w:break', ({ key }) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world || !validKey(key) || isProtectedCell(key)) return;
    if (!setDiff(getWorld(classId), key, { removed: true })) return;
    socket.to(`w:${classId}`).emit('w:break', { key, by: studentId });
  });

  safeOn(socket, 'w:place', ({ key, type }) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world || !validKey(key) || !PLACEABLE_TYPES.has(type)) return;
    // 장식 블록은 복습 보상으로 얻은 재고에서 차감 — 재고가 없으면 거부 (plank 등 기본 블록은 무제한)
    const isDecor = DECOR_SET.has(type);
    let inv = null;
    if (isDecor) {
      const cls = getClass(classId);
      const student = cls && cls.students[studentId];
      inv = student ? ensureInventory(student) : null;
      if (!inv || !(inv.decors[type] > 0)) {
        socket.emit('w:reject', { key });
        return;
      }
    }
    if (!setDiff(getWorld(classId), key, { type })) {
      socket.emit('w:reject', { key }); // 설치 한도 초과 — 클라이언트가 로컬 블록을 되돌린다
      return;
    }
    if (isDecor) {
      inv.decors[type] -= 1; // 설치가 확정된 뒤에만 차감한다
      save();
    }
    socket.to(`w:${classId}`).emit('w:place', { key, type, by: studentId });
  });

  safeOn(socket, 'w:bomb', ({ x, y, z, keys }) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world || !Array.isArray(keys)) return;
    const w = getWorld(classId);
    const destroyed = [];
    for (const key of keys.slice(0, 200)) {
      if (!validKey(key) || isProtectedCell(key)) continue;
      if (setDiff(w, key, { removed: true })) destroyed.push(key);
    }
    socket.to(`w:${classId}`).emit('w:bomb', {
      x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, keys: destroyed, by: studentId,
    });
  });

  // 스타일(모자/펫) 장착 — 보유한 코스메틱만 허용, null은 해제
  safeOn(socket, 'p:style', ({ hat, pet }) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world) return;
    const cls = getClass(classId);
    const student = cls && cls.students[studentId];
    if (!student) return;
    const inv = ensureInventory(student);
    const h = hat == null ? null : String(hat);
    const p = pet == null ? null : String(pet);
    if (h !== null && !(HAT_KEYS.has(h) && inv.cosmetics.includes(`hat:${h}`))) return;
    if (p !== null && !(PET_KEYS.has(p) && inv.cosmetics.includes(`pet:${p}`))) return;
    inv.hat = h;
    inv.pet = p;
    save();
    // 월드 플레이어 목록에도 반영해 늦게 입장한 학생도 같은 모습을 본다
    const w = worlds.get(classId);
    const entry = w && w.players.get(studentId);
    if (entry) {
      entry.hat = h;
      entry.pet = p;
    }
    socket.to(`w:${classId}`).emit('p:style', { id: studentId, hat: h, pet: p });
  });

  // 이모지 표시 — 문자열 8바이트 이하(grapheme 2자 내외)만 전달
  safeOn(socket, 'p:emote', ({ e }) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world) return;
    if (typeof e !== 'string' || !e.length || Buffer.byteLength(e, 'utf8') > 8) return;
    socket.to(`w:${classId}`).emit('p:emote', { id: studentId, e });
  });

  // 발사체(총) — 시각 효과 공유용
  safeOn(socket, 'p:shoot', (shot) => {
    const { classId, role, studentId, world } = socket.data || {};
    if (role !== 'student' || !world) return;
    socket.volatile.to(`w:${classId}`).emit('p:shoot', {
      id: studentId,
      x: Number(shot.x) || 0, y: Number(shot.y) || 0, z: Number(shot.z) || 0,
      dx: Number(shot.dx) || 0, dy: Number(shot.dy) || 0, dz: Number(shot.dz) || 0,
    });
  });

  socket.on('disconnect', () => {
    try {
      const { classId, role, studentId, world } = socket.data || {};
      if (role !== 'student' || !classId) return;
      const countKey = `${classId}:${studentId}`;
      const counts = sockCounts.get(countKey) || { t: 1, w: world ? 1 : 0 };
      counts.t = Math.max(0, counts.t - 1);
      if (world) counts.w = Math.max(0, counts.w - 1);

      // 마지막 "월드" 소켓이 끊기면 다른 플레이어 화면에서 아바타 제거
      if (world && counts.w === 0) {
        const w = worlds.get(classId);
        if (w) w.players.delete(studentId);
        socket.to(`w:${classId}`).emit('p:leave', { id: studentId });
      }
      // 마지막 소켓이 끊기면 오프라인 처리
      if (counts.t === 0) {
        sockCounts.delete(countKey);
        const cls = getClass(classId);
        if (cls && cls.students[studentId]) {
          cls.students[studentId].online = false;
          io.to(`t:${classId}`).emit('student:presence', { studentId, online: false });
          save();
        }
      } else {
        sockCounts.set(countKey, counts);
      }
    } catch (err) {
      console.error('[socket:disconnect]', err.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`BlockQuest 서버 실행 중: http://localhost:${PORT}`);
  console.log(`AI 퀴즈 엔진: ${process.env.ANTHROPIC_API_KEY ? 'Claude API (' + (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8') + ')' : '규칙 기반 폴백 (ANTHROPIC_API_KEY 설정 시 Claude 사용)'}`);
});
