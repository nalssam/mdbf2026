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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// ---------- 교사(관리자) API ----------

app.post('/api/teacher/classes', (req, res) => {
  const { className, teacherName } = req.body || {};
  if (!className || !String(className).trim()) throw httpError(400, '학급 이름을 입력해 주세요.');
  const id = randomId('cls');
  const cls = {
    id,
    code: newClassCode(),
    name: String(className).trim().slice(0, 40),
    teacherName: String(teacherName || '선생님').trim().slice(0, 30),
    teacherKey: randomId('tk'),
    createdAt: Date.now(),
    students: {},
    quizzes: {},
    activeQuizId: null,
    submissions: {},
  };
  db.classes[id] = cls;
  save();
  res.json({ classId: id, code: cls.code, name: cls.name, teacherName: cls.teacherName, teacherKey: cls.teacherKey });
});

app.get('/api/teacher/classes/:id', (req, res) => {
  const cls = requireTeacher(req);
  res.json({
    id: cls.id, code: cls.code, name: cls.name, teacherName: cls.teacherName,
    activeQuizId: cls.activeQuizId,
    students: Object.values(cls.students),
    quizzes: Object.values(cls.quizzes).sort((a, b) => b.createdAt - a.createdAt),
    leaderboard: leaderboard(cls),
  });
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

app.post('/api/join', (req, res) => {
  const { code, name, avatar, studentId } = req.body || {};
  const cls = findClassByCode(code);
  if (!cls) throw httpError(404, '해당 코드의 학급이 없습니다. 코드를 다시 확인해 주세요.');
  const trimmed = String(name || '').trim().slice(0, 16);
  if (!trimmed) throw httpError(400, '닉네임을 입력해 주세요.');

  // 재접속: 같은 studentId 또는 같은 닉네임이면 기존 기록을 이어간다
  let student = (studentId && cls.students[studentId]) || null;
  if (!student) {
    student = Object.values(cls.students).find((s) => s.name === trimmed) || null;
  }
  if (!student) {
    student = {
      id: randomId('st'),
      name: trimmed,
      avatar: String(avatar || 'steve').slice(0, 20),
      points: 0, correct: 0, answered: 0,
      streak: 0, bestStreak: 0,
      joinedAt: Date.now(), online: false,
    };
    cls.students[student.id] = student;
    io.to(`t:${cls.id}`).emit('student:joined', { student });
  } else {
    student.name = trimmed;
    if (avatar) student.avatar = String(avatar).slice(0, 20);
  }
  save();
  broadcastLeaderboard(cls);
  const activeQuiz = cls.activeQuizId ? cls.quizzes[cls.activeQuizId] : null;
  res.json({
    classId: cls.id,
    className: cls.name,
    teacherName: cls.teacherName,
    student,
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
  const activeQuiz = cls.activeQuizId ? cls.quizzes[cls.activeQuizId] : null;
  res.json({
    className: cls.name,
    student,
    activeQuiz: publicQuiz(activeQuiz),
    myAnswers: activeQuiz ? answersFor(cls, activeQuiz.id, student.id) : null,
    leaderboard: leaderboard(cls),
  });
});

// 답안 제출 → 서버에서 채점 + 포인트 계산
app.post('/api/answer', (req, res) => {
  const { classId, studentId, quizId, questionIndex, choiceIndex, timeMs } = req.body || {};
  const cls = getClass(classId);
  if (!cls) throw httpError(404, '학급을 찾을 수 없습니다.');
  const student = cls.students[studentId];
  if (!student) throw httpError(404, '학생 정보를 찾을 수 없습니다.');
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
    completed: Boolean(sub.completedAt),
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

io.on('connection', (socket) => {
  socket.on('join', ({ classId, role, studentId, teacherKey }) => {
    const cls = getClass(classId);
    if (!cls) return;
    socket.join(`c:${classId}`);
    if (role === 'teacher' && teacherKey === cls.teacherKey) {
      socket.join(`t:${classId}`);
      socket.data = { classId, role: 'teacher' };
    } else if (role === 'student' && cls.students[studentId]) {
      const student = cls.students[studentId];
      student.online = true;
      socket.data = { classId, role: 'student', studentId };
      io.to(`t:${classId}`).emit('student:presence', { studentId, online: true });
      save();
    }
  });

  socket.on('disconnect', () => {
    const { classId, role, studentId } = socket.data || {};
    if (role === 'student' && classId) {
      const cls = getClass(classId);
      if (cls && cls.students[studentId]) {
        cls.students[studentId].online = false;
        io.to(`t:${classId}`).emit('student:presence', { studentId, online: false });
        save();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`BlockQuest 서버 실행 중: http://localhost:${PORT}`);
  console.log(`AI 퀴즈 엔진: ${process.env.ANTHROPIC_API_KEY ? 'Claude API (' + (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8') + ')' : '규칙 기반 폴백 (ANTHROPIC_API_KEY 설정 시 Claude 사용)'}`);
});
