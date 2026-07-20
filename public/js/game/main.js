// BlockQuest 3D 월드 — 게임 로직 + 서버 연동 (엔진/컨트롤/퀴즈/멀티플레이 통합)
import { createEngine, BLOCK_TYPES } from './engine.js';
import { createControls } from './controls.js';

const session = JSON.parse(localStorage.getItem('bq_student') || 'null');
if (!session) location.href = '/';

const $ = (id) => document.getElementById(id);
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- 상태 ----------
let me = { points: 0, streak: 0 }; // 서버 응답 전에도 안전한 기본값
let quiz = null;
let myAnswers = {};
let board = { rankings: [], classTotal: 0 };
const inv = { blocks: 10, ammo: 0, bombs: 1 };
let selectedSlot = 0;
let openQuestion = null; // 현재 열린 문항 인덱스
let stateLoaded = false;

BQ.drawAvatar($('me-avatar'), session.avatar, 34);
$('me-name').textContent = session.name;

// ---------- 엔진 ----------
const engine = createEngine({
  canvas: $('game-canvas'),
  classSeed: hashStr(session.classId),
  avatarKey: session.avatar,
  playerName: session.name,
});

// ---------- 토스트 ----------
let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

// ---------- 오버레이 관리 ----------
// 도움말/인트로/퀴즈/결과가 겹칠 수 있으므로, 열려 있는 오버레이가 하나라도 있으면 조작을 잠근다
const openOverlays = new Set();
function syncControlLock() {
  const locked = openOverlays.size > 0;
  controls.setEnabled(!locked);
  if (locked) {
    engine.setMove(0, 0);
    engine.clearJump();
  }
}
function showOverlay(id) {
  openOverlays.add(id);
  $(id).classList.remove('hidden');
  syncControlLock();
}
function hideOverlay(id) {
  openOverlays.delete(id);
  $(id).classList.add('hidden');
  syncControlLock();
}

// ---------- 핫바 / 도구 ----------
const SLOTS = [
  { id: 'pickaxe', icon: '⛏️', name: '곡괭이', count: null },
  { id: 'block', icon: '🧱', name: '블록', count: () => inv.blocks },
  { id: 'gun', icon: '🔫', name: '블래스터', count: () => inv.ammo },
  { id: 'bomb', icon: '💣', name: '폭탄', count: () => inv.bombs },
];
function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  SLOTS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot' + (i === selectedSlot ? ' sel' : '');
    el.innerHTML = `<div>${s.icon}</div>` + (s.count ? `<div class="cnt">${s.count()}</div>` : '');
    el.title = s.name;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); selectSlot(i); });
    bar.appendChild(el);
  });
  $('btn-act').textContent = SLOTS[selectedSlot].icon;
  $('crosshair').style.display = selectedSlot === 2 ? 'block' : 'none';
}
function selectSlot(i) {
  selectedSlot = i;
  renderHotbar();
  BQ.sound('click');
  toast(`${SLOTS[i].icon} ${SLOTS[i].name} 선택`, 900);
}
renderHotbar();

function grantLoot() {
  const roll = Math.random();
  if (roll < 0.3) { inv.blocks += 4; toast('🧱 블록 +4 획득!'); }
  else if (roll < 0.55) { inv.ammo += 6; toast('🔫 탄약 +6 획득!'); }
  else if (roll < 0.8) { inv.bombs += 1; toast('💣 폭탄 +1 획득!'); }
  else { engine.setSpeedBoost(10000); toast('👢 스피드 부스트! (10초)'); }
  renderHotbar();
}

function doBreak(hit) {
  if (!hit || hit.kind !== 'block') return;
  if (!BLOCK_TYPES[hit.type] || !BLOCK_TYPES[hit.type].breakable) {
    toast('이 블록은 부술 수 없어요', 1200);
    return;
  }
  const type = engine.removeBlock(hit.key);
  if (!type) return;
  BQ.sound('break');
  if (socket.connected) socket.emit('w:break', { key: hit.key });
  if (type === 'crate') grantLoot();
  else if (Math.random() < 0.25) { inv.blocks += 1; renderHotbar(); }
}

function doPlace(hit) {
  if (!hit || hit.kind !== 'block' || !hit.face) return;
  if (inv.blocks <= 0) { toast('블록이 없어요! 상자를 부수거나 💎을 찾아보세요', 1600); return; }
  const [fx, fy, fz] = hit.face;
  const x = hit.pos.x + fx, y = hit.pos.y + fy, z = hit.pos.z + fz;
  // 플레이어와 겹치는 위치에는 설치 불가
  const p = engine.player.pos;
  if (Math.abs(x - p.x) < 0.85 && Math.abs(z - p.z) < 0.85 && y > p.y - 1 && y < p.y + 2.3) {
    toast('너무 가까워요!', 1000);
    return;
  }
  const key = engine.keyOf(x, y, z);
  if (engine.placeBlock(key, 'plank')) {
    inv.blocks -= 1;
    renderHotbar();
    if (socket.connected) socket.emit('w:place', { key, type: 'plank' });
  }
}

function doShoot() {
  if (inv.ammo <= 0) { toast('탄약이 없어요! 🔫 아이템이나 상자를 찾아보세요', 1600); return; }
  inv.ammo -= 1;
  renderHotbar();
  const { origin, dir } = engine.shoot();
  if (socket.connected) {
    socket.emit('p:shoot', { x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
  }
}

function doBomb() {
  if (inv.bombs <= 0) { toast('폭탄이 없어요! 💣 아이템이나 상자를 찾아보세요', 1600); return; }
  inv.bombs -= 1;
  renderHotbar();
  engine.dropBomb(engine.player.pos);
  toast('💣 2초 후 폭발!', 1500);
}

engine.setOnBombExploded((pos, destroyed) => {
  if (socket.connected) {
    socket.emit('w:bomb', { x: pos.x, y: pos.y, z: pos.z, keys: destroyed.map((d) => d.key) });
  }
  // 폭탄으로 부순 상자도 전리품을 준다 (곡괭이/총과 동일한 규칙, 최대 2개)
  destroyed.filter((d) => d.type === 'crate').slice(0, 2).forEach(() => grantLoot());
});
engine.setOnProjectileHit((hit) => {
  const type = engine.removeBlock(hit.key);
  if (type) {
    if (socket.connected) socket.emit('w:break', { key: hit.key });
    if (type === 'crate') grantLoot();
  }
});

function useToolAt(x, y) {
  const hit = engine.pickAt(x, y);
  if (hit && hit.kind === 'quiz') { tryOpenQuiz(hit.index); return; }
  const slot = SLOTS[selectedSlot].id;
  if (slot === 'pickaxe') doBreak(hit);
  else if (slot === 'block') doPlace(hit);
  else if (slot === 'gun') doShoot();
  else if (slot === 'bomb') doBomb();
}

// ---------- 컨트롤 ----------
const controls = createControls({
  canvas: $('game-canvas'),
  joystickEl: $('joy'),
  knobEl: $('joy-knob'),
  jumpBtn: $('btn-jump'),
  actionBtn: $('btn-act'),
  callbacks: {
    move: (x, y) => engine.setMove(x, y),
    jump: () => engine.jump(),
    drag: (dx, dy) => engine.rotateCamera(dx, dy),
    tap: (x, y) => useToolAt(x, y),
    action: () => {
      const slot = SLOTS[selectedSlot].id;
      if (slot === 'gun') doShoot();
      else if (slot === 'bomb') doBomb();
      else useToolAt(innerWidth / 2, innerHeight / 2);
    },
    slot: (i) => selectSlot(i),
  },
});

// ---------- 아이템 ----------
engine.on('itemPickup', (type, def) => {
  if (type === 'boots') { engine.setSpeedBoost(10000); toast(`${def.emoji} ${def.label}! 10초간 빠르게!`); }
  else if (type === 'gun') { inv.ammo += 8; toast(`${def.emoji} ${def.label} 탄약 +8!`); }
  else if (type === 'bomb') { inv.bombs += 2; toast(`${def.emoji} ${def.label} +2!`); }
  else if (type === 'gem') { inv.blocks += 6; toast(`${def.emoji} 블록 +6!`); }
  renderHotbar();
});

// ---------- HUD ----------
function renderTop() {
  if (!me) return;
  $('me-points').textContent = BQ.fmt(me.points);
  $('streak').textContent = '🔥' + (me.streak || 0);
}
function renderHearts() {
  const el = $('hud-hearts');
  if (!quiz) { el.innerHTML = ''; return; }
  el.innerHTML = quiz.questions.map((_, i) => {
    const a = myAnswers[i];
    return `<div class="h ${a ? (a.correct ? 'ok' : 'bad') : 'pending'}"></div>`;
  }).join('');
}

// ---------- 퀴즈 ----------
function quizStates() {
  if (!quiz) return [];
  return quiz.questions.map((_, i) => {
    const a = myAnswers[i];
    return a ? (a.correct ? 'correct' : 'wrong') : 'pending';
  });
}
function adoptQuiz(q, answers) {
  quiz = q;
  myAnswers = answers || {};
  renderHearts();
  if (quiz) engine.setQuizBlocks(quiz.id, quiz.questions.length, quizStates());
  else engine.setQuizBlocks('none', 0);
}
function answeredCount() { return Object.keys(myAnswers).length; }

function tryOpenQuiz(index) {
  if (!quiz) return;
  const a = myAnswers[index];
  if (a) { toast(a.correct ? '이미 맞힌 문제예요! ✓' : '이미 푼 문제예요 ✗', 1400); return; }
  openQuizOverlay(index);
}

let questionShownAt = 0;
function openQuizOverlay(index) {
  openQuestion = index;
  showOverlay('quiz-overlay');
  const q = quiz.questions[index];
  $('qz-no').textContent = `${index + 1}번`;
  $('qz-diff').textContent = { easy: '쉬움', medium: '보통', hard: '어려움' }[q.difficulty] || '보통';
  $('qz-text').textContent = q.prompt;
  $('qz-feedback').classList.add('hidden');
  $('qz-done').classList.add('hidden');
  $('qz-close').classList.remove('hidden');
  const grid = $('qz-choices');
  grid.className = 'choice-grid' + (q.type === 'ox' ? ' ox' : '');
  grid.innerHTML = '';
  const keys = q.type === 'ox' ? ['O', 'X'] : ['A', 'B', 'C', 'D'];
  q.choices.forEach((choice, ci) => {
    const btn = document.createElement('button');
    btn.className = `choice c${ci}`;
    btn.innerHTML = `<span class="key">${keys[ci]}</span>${BQ.esc(choice)}`;
    btn.addEventListener('click', () => submitAnswer(index, ci));
    grid.appendChild(btn);
  });
  questionShownAt = Date.now();
}

async function submitAnswer(index, choiceIndex) {
  if (myAnswers[index]) return;
  // 제출 중 quiz가 교체/종료될 수 있으므로 시점의 퀴즈를 캡처한다
  const submittedQuiz = quiz;
  if (!submittedQuiz) return;
  document.querySelectorAll('#qz-choices .choice').forEach((b) => (b.disabled = true));
  try {
    const res = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId: session.classId, studentId: session.studentId, secret: session.secret,
        quizId: submittedQuiz.id,
        questionIndex: index, choiceIndex, timeMs: Date.now() - questionShownAt,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '제출에 실패했습니다.');
    // 응답 도착 시점에 다른 퀴즈로 바뀌었으면 조용히 무시 (결과/새 퀴즈 화면이 이미 떠 있다)
    if (quiz !== submittedQuiz) return;
    myAnswers[index] = { choiceIndex, ...data };
    me.points = data.totalPoints;
    me.streak = data.streak;
    renderTop(); renderHearts();

    document.querySelectorAll('#qz-choices .choice').forEach((b, i) => {
      if (i === data.answerIndex) b.classList.add('reveal-correct');
      else if (i === choiceIndex) b.classList.add('picked-wrong');
      else b.classList.add('reveal-wrong');
    });
    const fb = $('qz-feedback');
    fb.classList.remove('hidden', 'good', 'bad');
    if (data.correct) {
      fb.classList.add('good');
      fb.innerHTML = `<b>💎 정답! +${data.points}P</b>${data.streak >= 3 ? ` · 🔥${data.streak}연속 콤보!` : ''}<br/>${BQ.esc(data.explanation || '')}`;
      BQ.sound('correct');
      engine.updateQuizBlockState(index, 'correct');
      engine.celebrateQuizBlock(index);
      BQ.floatText(innerWidth / 2 - 50, innerHeight / 3, `+${data.points}P`);
    } else {
      fb.classList.add('bad');
      fb.innerHTML = `<b>💥 아쉬워요!</b> 정답은 "${BQ.esc(submittedQuiz.questions[index].choices[data.answerIndex])}"<br/>${BQ.esc(data.explanation || '')}`;
      BQ.sound('wrong');
      engine.updateQuizBlockState(index, 'wrong');
    }
    $('qz-close').classList.add('hidden');
    $('qz-done').classList.remove('hidden');
    $('qz-done').textContent = answeredCount() >= submittedQuiz.questions.length ? '결과 보기 🏁' : '확인 ▶';
  } catch (err) {
    if (quiz !== submittedQuiz) return;
    toast('⚠️ ' + err.message);
    document.querySelectorAll('#qz-choices .choice').forEach((b) => (b.disabled = false));
  }
}

function closeQuizOverlay() {
  hideOverlay('quiz-overlay');
  openQuestion = null;
  if (quiz && answeredCount() >= quiz.questions.length) showResult();
}
$('qz-close').addEventListener('click', closeQuizOverlay);
$('qz-done').addEventListener('click', closeQuizOverlay);

// 퀴즈 블록 근접 프롬프트
setInterval(() => {
  if (!quiz || openQuestion != null) { $('quiz-prompt').style.display = 'none'; return; }
  const near = engine.nearestQuizBlock();
  const show = near && near.state === 'pending';
  $('quiz-prompt').style.display = show ? 'block' : 'none';
  if (show) {
    $('quiz-prompt').querySelector('button').textContent = `❓ ${near.index + 1}번 문제 풀기!`;
    $('quiz-prompt').dataset.index = near.index;
  }
}, 200);
$('quiz-prompt').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tryOpenQuiz(Number($('quiz-prompt').dataset.index));
});

// ---------- 결과 ----------
function showResult() {
  const answers = Object.values(myAnswers);
  if (!answers.length) { toast('퀴즈가 종료되었어요', 2200); return; } // 한 문제도 안 푼 학생에게 축하 화면은 어색하다
  const myScore = answers.reduce((t, a) => t + (a.points || 0), 0);
  const correctCount = answers.filter((a) => a.correct).length;
  $('result-score').textContent = BQ.fmt(myScore);
  const myRank = board.rankings.find((r) => r.id === session.studentId);
  $('result-detail').textContent =
    `${quiz ? quiz.questions.length : answers.length}문제 중 ${correctCount}개 정답` + (myRank ? ` · 현재 ${myRank.rank}위` : '');
  const top3 = board.rankings.slice(0, 3);
  $('result-podium').innerHTML = [1, 0, 2].filter((i) => top3[i]).map((i) => {
    const r = top3[i];
    return `<div class="col">
      <img src="${BQ.avatarDataURL(r.avatar, 40)}" width="40" height="40" style="border:3px solid var(--ink)" alt="" />
      <div class="pillar p${r.rank}">${r.rank}</div>
      <div class="nm">${BQ.esc(r.name)}<br/><b>${BQ.fmt(r.points)}P</b></div>
    </div>`;
  }).join('');
  $('result-board').innerHTML = board.rankings.slice(0, 8).map((r) => `
    <div class="lb-row r${r.rank} ${r.id === session.studentId ? 'me' : ''}">
      <span class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
      <span class="nm">${BQ.esc(r.name)}</span>
      <span class="pts">${BQ.fmt(r.points)}P</span>
    </div>`).join('');
  showOverlay('result-overlay');
  BQ.sound('levelup');
}
$('result-close').addEventListener('click', () => hideOverlay('result-overlay'));

// ---------- 인트로 ----------
function showIntro() {
  $('intro-title').textContent = quiz.title;
  $('intro-summary').textContent = quiz.summary || '';
  $('intro-objectives').innerHTML = (quiz.objectives || []).map((o) => `<li>${BQ.esc(o)}</li>`).join('');
  $('intro-desc').textContent = `월드에 흩어진 황금 퀴즈 블록 ${quiz.questions.length}개를 찾아 문제를 풀어보세요! 빨리 맞힐수록, 연속으로 맞힐수록 보너스!`;
  showOverlay('intro-overlay');
}
$('intro-go').addEventListener('click', () => {
  hideOverlay('intro-overlay');
  BQ.sound('start');
});

// ---------- 도움말 / 이동 ----------
$('btn-help').addEventListener('click', () => showOverlay('help-overlay'));
$('help-close').addEventListener('click', () => {
  hideOverlay('help-overlay');
  localStorage.setItem('bq_help_seen', '1');
});
$('btn-classic').addEventListener('click', () => { location.href = '/play.html'; });
if (!localStorage.getItem('bq_help_seen')) showOverlay('help-overlay');

// iOS/크롬 오디오 잠금 해제 (첫 사용자 제스처)
addEventListener('pointerdown', function unlockOnce() {
  BQ.unlockAudio();
  removeEventListener('pointerdown', unlockOnce);
}, { once: true });

// ---------- 서버 연동 ----------
const socket = io();
socket.on('connect', () => {
  socket.emit('join', {
    classId: session.classId, role: 'student',
    studentId: session.studentId, secret: session.secret, mode: 'world',
  });
  // 재접속이라면 끊긴 사이 놓친 퀴즈 시작/종료/답안 상태를 다시 맞춘다
  if (stateLoaded) refreshState({ silent: true });
});
socket.on('world:state', ({ diffs, players }) => {
  engine.applyDiffs(diffs);
  for (const p of players || []) engine.addRemote(p.id, p);
});
socket.on('p:join', (p) => {
  if (p.id !== session.studentId) { engine.addRemote(p.id, p); toast(`👋 ${p.name} 님이 입장했어요`, 1500); }
});
socket.on('p:leave', ({ id }) => engine.removeRemote(id));
socket.on('p:move', (m) => {
  if (m.id === session.studentId) return;
  engine.updateRemote(m.id, m);
});
socket.on('w:break', ({ key, by }) => {
  if (by === session.studentId) return;
  // 원격 파괴도 파괴 가능한 블록만 허용 (조작된 클라이언트가 바닥을 지우지 못하게)
  const t = engine.blocks.get(key);
  if (t && BLOCK_TYPES[t].breakable) engine.removeBlock(key);
});
socket.on('w:place', ({ key, type, by }) => {
  if (by === session.studentId) return;
  engine.placeBlock(key, type); // 내 몸과 겹치면 엔진의 끼임 탈출 로직이 위로 밀어낸다
});
socket.on('w:reject', ({ key }) => {
  // 서버가 설치를 거부(한도 초과) — 로컬 블록을 되돌리고 재고 반환
  const t = engine.blocks.get(key);
  if (t) { engine.removeBlock(key); inv.blocks += 1; renderHotbar(); }
  toast('🧱 월드 블록 한도에 도달했어요!', 1800);
});
socket.on('w:bomb', ({ x, y, z, keys, by }) => {
  if (by === session.studentId) return;
  const diffs = {};
  for (const k of keys || []) diffs[k] = { removed: true };
  engine.applyDiffs(diffs);
  const pos = new engine.THREE.Vector3(x, y, z);
  engine.burst(pos, 0xff8c1a, 26);
  engine.burst(pos, 0x555555, 16);
  BQ.sound('explosion');
});
socket.on('p:shoot', (s) => {
  if (s.id === session.studentId) return;
  engine.shootFrom(new engine.THREE.Vector3(s.x, s.y, s.z), new engine.THREE.Vector3(s.dx, s.dy, s.dz), { remote: true });
});
socket.on('quiz:launched', ({ quiz: q }) => {
  const sameQuiz = quiz && quiz.id === q.id;
  // 열려 있던 문항/결과 화면 정리
  if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; }
  if (openOverlays.has('result-overlay')) hideOverlay('result-overlay');
  if (sameQuiz) {
    // 같은 퀴즈 재시작: 내 답안 기록은 유지한다
    adoptQuiz(q, myAnswers);
    toast('❓ 퀴즈가 다시 시작되었어요!', 2000);
    return;
  }
  adoptQuiz(q, {});
  BQ.sound('start');
  showIntro();
});
socket.on('quiz:closed', ({ quizId }) => {
  if (quiz && quiz.id === quizId) {
    if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; }
    showResult();
    adoptQuiz(null, {});
  }
});
socket.on('leaderboard:update', (data) => {
  board = data;
  const mine = board.rankings.find((r) => r.id === session.studentId);
  if (mine && me) { me.points = mine.points; renderTop(); }
});

// 내 위치 브로드캐스트 (10Hz)
let lastSent = { x: 0, y: 0, z: 0, yaw: 0, anim: '' };
setInterval(() => {
  if (!socket.connected) return;
  const p = engine.player;
  const anim = p.moving ? 'walk' : 'idle';
  if (
    Math.abs(p.pos.x - lastSent.x) > 0.02 || Math.abs(p.pos.y - lastSent.y) > 0.02 ||
    Math.abs(p.pos.z - lastSent.z) > 0.02 || Math.abs(p.yaw - lastSent.yaw) > 0.05 ||
    anim !== lastSent.anim
  ) {
    lastSent = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, anim };
    socket.emit('p:move', lastSent);
  }
}, 100);

// 개발/디버그용 훅 (콘솔에서 월드 조작 가능)
window.bqDebug = { engine, get quiz() { return quiz; }, get inv() { return inv; } };

// ---------- 초기 상태 로드 / 재동기화 ----------
async function refreshState({ silent } = {}) {
  const qs = new URLSearchParams({
    classId: session.classId, studentId: session.studentId, secret: session.secret || '',
  });
  const res = await fetch(`/api/student/state?${qs}`);
  if (res.status === 404) {
    // 세션이 무효(학급/학생 삭제 또는 인증 실패)일 때만 세션을 버린다
    localStorage.removeItem('bq_student');
    location.href = '/';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '상태를 불러오지 못했습니다.');
  me = data.student;
  board = data.leaderboard;
  renderTop();

  const active = data.activeQuiz;
  if (active) {
    const sameQuiz = quiz && quiz.id === active.id;
    if (!sameQuiz || openQuestion == null) {
      adoptQuiz(active, data.myAnswers);
    } else {
      // 문항을 푸는 중이면 화면은 유지하고 답안만 병합
      quiz = active;
      myAnswers = Object.assign(data.myAnswers || {}, myAnswers);
      renderHearts();
    }
    if (silent) return;
    const remain = active.questions.length - answeredCount();
    if (remain <= 0) showResult();
    else {
      if (answeredCount() === 0 && localStorage.getItem('bq_help_seen')) showIntro();
      toast(`❓ 퀘스트 진행 중: 황금 블록 ${remain}개 남음`, 3000);
    }
  } else {
    if (quiz && silent) {
      // 끊긴 사이 퀴즈가 종료됨
      if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; }
      showResult();
      adoptQuiz(null, {});
    } else if (!silent) {
      toast('⛏️ 자유 시간! 선생님이 퀴즈를 시작하면 황금 블록이 나타나요', 3200);
    }
  }
}

(async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      await refreshState();
      stateLoaded = true;
      return;
    } catch {
      // 일시적 네트워크 오류 — 세션을 지우지 않고 재시도
      toast('📡 서버 연결 중...', 2500);
      await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
    }
  }
})();
