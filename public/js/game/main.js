// BlockQuest 3D 월드 — 게임 로직 + 서버 연동 (엔진/컨트롤/퀴즈/멀티플레이 통합)
// 부팅 순서: 로딩 오버레이 → 서버 상태 로드(mapKey/inventory 확보) → 엔진 생성 → 소켓 연결
import { createEngine, BLOCK_TYPES, HAT_DEFS, PET_DEFS } from './engine.js';
import { createControls } from './controls.js';

const session = JSON.parse(localStorage.getItem('bq_student') || 'null');
if (!session) location.href = './';

const $ = (id) => document.getElementById(id);
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hexColor = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

// ---------- 상태 ----------
let me = { points: 0, streak: 0 }; // 서버 응답 전에도 안전한 기본값
let quiz = null;
let lastQuiz = null;      // 종료 후 복습용으로 보관하는 마지막 퀴즈
let practiceOnly = false; // 퀴즈 종료 후 복습만 가능한 상태
let practiceOpen = false; // 현재 열린 퀴즈 오버레이가 복습 모드인지
let myAnswers = {};
let board = { rankings: [], classTotal: 0 };
const inv = { blocks: 10, ammo: 25, bombs: 1, fireworks: 0 };
let inventory = { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null }; // 서버 저장 인벤토리
let localCoins = 0;      // 세션 중 월드에서 주운 코인 (서버 미저장)
let goldenUntil = 0;     // 황금 시간(코인 2배) 종료 시각
let courseStartAt = 0;   // 타임어택 시작 시각 (0이면 진행 중 아님)
let selectedSlot = 0;
let selectedDecor = null; // 핫바 장식 슬롯에서 선택된 블록 타입
let openQuestion = null;  // 현재 열린 문항 인덱스
let stateLoaded = false;

// ---------- 전투(좀비/총/방어력) ----------
let gunLevel = 1;         // 총 단계 1~5
let killCount = 0;        // 처치한 좀비 수 (세션)
let coinsSpent = 0;       // 총 업그레이드로 쓴 코인 (표시값에서 차감)
const GUN_COSTS = { 2: 20, 3: 45, 4: 80, 5: 140 }; // 다음 단계로 올리는 코인 비용
const KILL_COINS = { 1: 10, 2: 7, 3: 5, 4: 3, 5: 2 }; // 처치 시 코인 (강한 좀비일수록 많이)
const combatKey = () => 'bq_combat_' + (session.studentId || 'me');
(function loadCombat() {
  try {
    const c = JSON.parse(localStorage.getItem(combatKey()) || 'null');
    if (c) { gunLevel = Math.min(5, Math.max(1, c.gunLevel || 1)); killCount = c.killCount || 0; coinsSpent = c.coinsSpent || 0; }
  } catch { /* 무시 */ }
})();
function persistCombat() {
  try { localStorage.setItem(combatKey(), JSON.stringify({ gunLevel, killCount, coinsSpent })); } catch { /* 무시 */ }
}
// 코인 잔액 = 서버 저장 코인 + 세션 코인 − 업그레이드로 쓴 코인
function coinBalance() { return Math.max(0, inventory.coins + localCoins - coinsSpent); }
// 방어력 = 서버가 알려준 defense(문제·복습으로 상승), 없으면 정답 수로 근사 (최대 24)
function currentArmor() {
  const d = (me && typeof me.defense === 'number') ? me.defense : Math.floor(((me && me.correct) || 0) * 1.5);
  return Math.min(24, d);
}

// 부팅 완료 후 채워진다 — 참조하는 코드는 모두 boot 이후에만 호출되거나 null 가드가 있다
let engine = null;
let controls = null;
let socket = null;

BQ.drawAvatar($('me-avatar'), session.avatar, 34);
$('me-name').textContent = session.name;

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
// 도움말/인트로/퀴즈/결과/가방이 겹칠 수 있으므로, 열려 있는 오버레이가 하나라도 있으면 조작을 잠근다
const openOverlays = new Set();
function syncControlLock() {
  if (!controls || !engine) return; // 부팅 전 — 컨트롤이 아직 없다
  const locked = openOverlays.size > 0;
  controls.setEnabled(!locked);
  if (locked) {
    engine.setMove(0, 0);
    engine.clearJump();
    engine.setJumpHeld(false);
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

// ---------- 장식 블록 / 코스메틱 정보 ----------
const DECOR_TYPES = ['sand', 'snow', 'ice', 'glass', 'gold', 'tramp', 'fan'];
const DECOR_INFO = {
  sand: { emoji: '🏜️', label: '모래' },
  snow: { emoji: '⛄', label: '눈' },
  ice: { emoji: '🧊', label: '얼음' },
  glass: { emoji: '🪟', label: '유리' },
  gold: { emoji: '🪙', label: '황금' },
  tramp: { emoji: '🤸', label: '트램펄린' },
  fan: { emoji: '🌀', label: '바람개비' },
};
function cosmeticLabel(type) {
  // 'hat:cap' / 'pet:chick' 형식
  const [kind, key] = String(type || '').split(':');
  if (kind === 'hat' && HAT_DEFS[key]) return `🎩 ${HAT_DEFS[key].label}`;
  if (kind === 'pet' && PET_DEFS[key]) return `🐾 ${PET_DEFS[key].label}`;
  return '🎁 코스메틱';
}
function normalizeInventory(raw) {
  const base = { coins: 0, decors: {}, cosmetics: [], hat: null, pet: null };
  const v = Object.assign(base, raw || {});
  v.decors = v.decors || {};
  v.cosmetics = v.cosmetics || [];
  return v;
}
function ownedDecorTypes() { return DECOR_TYPES.filter((t) => (inventory.decors[t] || 0) > 0); }

// ---------- 핫바 / 도구 (6슬롯) ----------
const SLOTS = [
  { id: 'pickaxe', icon: '⛏️', name: '곡괭이', count: null },
  { id: 'block', icon: '🧱', name: '블록', count: () => inv.blocks },
  { id: 'decor', icon: '🎨', name: '장식', count: () => (selectedDecor ? inventory.decors[selectedDecor] || 0 : 0) },
  { id: 'gun', icon: '🔫', name: '블래스터', count: () => inv.ammo },
  { id: 'bomb', icon: '💣', name: '폭탄', count: () => inv.bombs },
  { id: 'firework', icon: '🎆', name: '폭죽', count: () => inv.fireworks },
];
function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  SLOTS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot' + (i === selectedSlot ? ' sel' : '');
    let cnt = '';
    if (s.id === 'decor') {
      // 장식 슬롯: 선택된 타입의 이모지 + 보유 수 (다시 탭하면 타입 순환)
      cnt = `<div class="cnt">${selectedDecor ? DECOR_INFO[selectedDecor].emoji : ''}${s.count()}</div>`;
    } else if (s.count) {
      cnt = `<div class="cnt">${s.count()}</div>`;
    }
    el.innerHTML = `<div>${s.icon}</div>` + cnt;
    el.title = s.name;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); selectSlot(i); });
    bar.appendChild(el);
  });
  $('btn-act').textContent = SLOTS[selectedSlot].icon;
  $('crosshair').style.display = SLOTS[selectedSlot].id === 'gun' ? 'block' : 'none';
}
function cycleDecor() {
  const owned = ownedDecorTypes();
  if (!owned.length) { toast('🎨 아직 장식 블록이 없어요 — 복습 보상으로 모아보세요!', 1600); return; }
  const i = owned.indexOf(selectedDecor);
  selectedDecor = owned[(i + 1) % owned.length];
  renderHotbar();
  BQ.sound('click');
  toast(`🎨 ${DECOR_INFO[selectedDecor].emoji} ${DECOR_INFO[selectedDecor].label} 블록 선택`, 900);
}
function selectSlot(i) {
  if (SLOTS[i].id === 'decor') {
    // 이미 선택된 장식 슬롯을 다시 탭하면 보유 타입 순환
    if (selectedSlot === i) { cycleDecor(); return; }
    if (!selectedDecor || !(inventory.decors[selectedDecor] > 0)) selectedDecor = ownedDecorTypes()[0] || null;
  }
  selectedSlot = i;
  renderHotbar();
  BQ.sound('click');
  toast(`${SLOTS[i].icon} ${SLOTS[i].name} 선택`, 900);
}
renderHotbar();

// ---------- 코인 HUD ----------
// 표시값 = 서버 저장 코인(복습 보상) + 세션 중 월드에서 주운 코인 − 업그레이드 소모
function renderCoins() {
  $('coin-count').textContent = '⭐' + BQ.fmt(coinBalance());
}

// ---------- 전투 HUD (체력/방어력/총 단계) ----------
function renderCombat() {
  if (engine) {
    const hp = engine.getPlayerHp(), max = engine.getMaxHp();
    const pct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
    const fill = $('hp-fill'); if (fill) fill.style.width = pct + '%';
    const txt = $('hp-text'); if (txt) txt.textContent = Math.ceil(hp) + '/' + max;
    const ab = $('armor-badge'); if (ab) ab.textContent = '🛡' + engine.getArmor();
  }
  const btn = $('btn-gun-up');
  if (btn) btn.textContent = gunLevel >= 5 ? '🔫 MAX' : `🔫 Lv.${gunLevel} ⬆⭐${GUN_COSTS[gunLevel + 1]}`;
}
function upgradeGun() {
  if (gunLevel >= 5) { toast('🔫 이미 최고 단계예요! (5단계)', 1600); return; }
  const cost = GUN_COSTS[gunLevel + 1];
  if (coinBalance() < cost) { toast(`⭐ 코인이 부족해요 (${cost} 필요) — 좀비를 잡거나 복습해서 코인을 모으세요!`, 2800); return; }
  coinsSpent += cost;
  gunLevel += 1;
  if (engine) engine.setGunLevel(gunLevel);
  persistCombat();
  renderCoins(); renderCombat();
  BQ.sound('levelup');
  toast(`🔫 총 업그레이드 성공! ${gunLevel}단계 — 위력이 세졌어요!`, 2400);
}
// 좀비 처치 포인트 — 서버(또는 정적 심)에 반영해 랭킹에 오르게 한다
async function awardKill(level) {
  try {
    const res = await fetch('api/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: session.classId, studentId: session.studentId, secret: session.secret, level }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.totalPoints === 'number' && me) { me.points = data.totalPoints; renderTop(); }
  } catch { /* 오프라인 — 로컬 연출만, 점수는 다음 동기화 때 반영 */ }
}
// 피격 시 화면 빨간 플래시
let dmgFlashEl = null;
function flashDamage() {
  if (!dmgFlashEl) {
    dmgFlashEl = document.createElement('div');
    dmgFlashEl.style.cssText = 'position:fixed;inset:0;background:radial-gradient(transparent 40%,rgba(200,0,0,0.45));pointer-events:none;z-index:55;opacity:0;transition:opacity .12s';
    document.body.appendChild(dmgFlashEl);
  }
  dmgFlashEl.style.opacity = '1';
  setTimeout(() => { if (dmgFlashEl) dmgFlashEl.style.opacity = '0'; }, 130);
}

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
  // 설치할 타입 결정: 블록 슬롯 = 판자(무제한 로컬 재고), 장식 슬롯 = 선택된 장식(서버 인벤토리 차감)
  const slot = SLOTS[selectedSlot].id;
  let type = 'plank';
  if (slot === 'decor') {
    if (!selectedDecor || (inventory.decors[selectedDecor] || 0) <= 0) {
      toast('🎨 장식 블록이 없어요! 복습 보상으로 모아보세요', 1600);
      return;
    }
    type = selectedDecor;
  } else if (inv.blocks <= 0) {
    toast('블록이 없어요! 상자를 부수거나 💎을 찾아보세요', 1600);
    return;
  }
  let x, y, z;
  if (hit && hit.kind === 'block' && hit.face) {
    const [fx, fy, fz] = hit.face;
    x = hit.pos.x + fx; y = hit.pos.y + fy; z = hit.pos.z + fz;
  } else {
    // 정면 설치: 탭 지점이 없으면(허공 탭·액션 버튼) 캐릭터 정면의 빈 칸에 설치한다
    const fc = engine.frontCell();
    if (!fc) { toast('설치할 곳이 없어요', 1000); return; }
    x = fc.x; y = fc.y; z = fc.z;
  }
  // 플레이어와 겹치는 위치에는 설치 불가
  const p = engine.player.pos;
  if (Math.abs(x - p.x) < 0.85 && Math.abs(z - p.z) < 0.85 && y > p.y - 1 && y < p.y + 2.3) {
    toast('너무 가까워요!', 1000);
    return;
  }
  const key = engine.keyOf(x, y, z);
  if (engine.placeBlock(key, type)) {
    if (slot === 'decor') inventory.decors[type] = (inventory.decors[type] || 0) - 1;
    else inv.blocks -= 1;
    renderHotbar();
    if (socket.connected) socket.emit('w:place', { key, type });
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

function doFirework() {
  if (inv.fireworks <= 0) { toast('폭죽이 없어요! 🎆 보물상자나 복습 보상을 찾아보세요', 1600); return; }
  inv.fireworks -= 1;
  renderHotbar();
  engine.launchFirework();
  BQ.sound('firework');
}

function useToolAt(x, y) {
  const hit = engine.pickAt(x, y);
  if (hit && hit.kind === 'quiz') { tryOpenQuiz(hit.index); return; }
  const slot = SLOTS[selectedSlot].id;
  if (slot === 'pickaxe') doBreak(hit);
  else if (slot === 'block' || slot === 'decor') doPlace(hit);
  else if (slot === 'gun') doShoot();
  else if (slot === 'bomb') doBomb();
  else if (slot === 'firework') doFirework();
}

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
  if (q) { lastQuiz = q; practiceOnly = false; }
  renderHearts();
  if (quiz) engine.setQuizBlocks(quiz.id, quiz.questions.length, quizStates());
  else engine.setQuizBlocks('none', 0);
}
// 퀴즈 종료 — 블록·답안은 남겨 복습(practice) 모드로 전환한다 (새 퀴즈 시작 시 교체)
function retireQuiz() {
  lastQuiz = quiz || lastQuiz;
  quiz = null;
  practiceOnly = true;
  renderHearts();
}
function answeredCount() { return Object.keys(myAnswers).length; }

function tryOpenQuiz(index) {
  const q = quiz || (practiceOnly ? lastQuiz : null);
  if (!q) return;
  const a = myAnswers[index];
  if (a) { openQuizOverlay(index, { practice: true }); return; } // 이미 푼 문제 → 복습 모드
  if (!quiz) { toast('종료된 퀴즈예요 — 이미 푼 문제만 복습할 수 있어요', 1600); return; }
  openQuizOverlay(index);
}

let questionShownAt = 0;
function openQuizOverlay(index, { practice } = {}) {
  const q = quiz || lastQuiz;
  if (!q) return;
  practiceOpen = !!practice;
  openQuestion = index;
  showOverlay('quiz-overlay');
  const qq = q.questions[index];
  $('qz-no').textContent = `${index + 1}번`;
  $('qz-diff').textContent = { easy: '쉬움', medium: '보통', hard: '어려움' }[qq.difficulty] || '보통';
  $('qz-practice-tag').classList.toggle('hidden', !practice);
  $('qz-text').textContent = qq.prompt;
  $('qz-feedback').classList.add('hidden');
  $('qz-done').classList.add('hidden');
  $('qz-close').classList.remove('hidden');
  const grid = $('qz-choices');
  grid.className = 'choice-grid' + (qq.type === 'ox' ? ' ox' : '');
  grid.innerHTML = '';
  const keys = qq.type === 'ox' ? ['O', 'X'] : ['A', 'B', 'C', 'D'];
  qq.choices.forEach((choice, ci) => {
    const btn = document.createElement('button');
    btn.className = `choice c${ci}`;
    btn.innerHTML = `<span class="key">${keys[ci]}</span>${BQ.esc(choice)}`;
    btn.addEventListener('click', () => (practice ? submitPractice(index, ci) : submitAnswer(index, ci)));
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
    const res = await fetch('api/answer', {
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
    if (typeof data.defense === 'number') me.defense = data.defense;
    if (data.correct && me.correct != null) me.correct += 1; // 방어력 근사치 즉시 반영
    if (engine) engine.setArmor(currentArmor()); // 문제를 풀면 방어력 상승
    renderTop(); renderHearts(); renderCombat();

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

// ---------- 복습 모드 (이미 푼 문제 다시 풀기 — 포인트 없음, 하루 3회 보상) ----------
function applyPracticeReward(reward, newInv) {
  if (newInv) inventory = normalizeInventory(newInv);
  let msg = '🎁 복습 보상!';
  if (reward.kind === 'coins') msg = `🎁 복습 보상! ⭐ 코인 +${reward.qty}`;
  else if (reward.kind === 'decor') {
    const info = DECOR_INFO[reward.type] || { emoji: '🎨', label: '장식' };
    msg = `🎁 복습 보상! ${info.emoji} ${info.label} 블록 +${reward.qty}`;
  } else if (reward.kind === 'cosmetic') msg = `🎁 복습 보상! ${cosmeticLabel(reward.type)} 획득!`;
  toast(msg, 2600);
  BQ.sound('reward');
  renderCoins();
  renderHotbar();
  if (openOverlays.has('bag-overlay')) renderBag();
}

async function submitPractice(index, choiceIndex) {
  const q = quiz || lastQuiz;
  if (!q) return;
  document.querySelectorAll('#qz-choices .choice').forEach((b) => (b.disabled = true));
  try {
    const res = await fetch('api/practice-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId: session.classId, studentId: session.studentId, secret: session.secret,
        quizId: q.id, questionIndex: index, choiceIndex,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '복습 제출에 실패했습니다.');
    document.querySelectorAll('#qz-choices .choice').forEach((b, i) => {
      if (i === data.answerIndex) b.classList.add('reveal-correct');
      else if (i === choiceIndex) b.classList.add('picked-wrong');
      else b.classList.add('reveal-wrong');
    });
    const fb = $('qz-feedback');
    fb.classList.remove('hidden', 'good', 'bad');
    if (data.correct) {
      fb.classList.add('good');
      fb.innerHTML = `<b>📚 복습 정답!</b> (포인트는 변하지 않아요)<br/>${BQ.esc(data.explanation || '')}`;
      BQ.sound('correct');
      if (typeof data.defense === 'number') { me.defense = data.defense; if (engine) engine.setArmor(currentArmor()); renderCombat(); }
      if (data.reward) applyPracticeReward(data.reward, data.inventory);
      else fb.innerHTML += `<br/><span class="muted">오늘 이 문제의 보상 3번을 모두 받았어요 — 내일 다시 도전! (복습은 방어력을 올려줘요 🛡)</span>`;
    } else {
      fb.classList.add('bad');
      fb.innerHTML = `<b>💥 아쉬워요!</b> 정답은 "${BQ.esc(q.questions[index].choices[data.answerIndex])}"<br/>${BQ.esc(data.explanation || '')}`;
      BQ.sound('wrong');
    }
    $('qz-close').classList.add('hidden');
    $('qz-done').classList.remove('hidden');
    $('qz-done').textContent = '확인 ▶';
  } catch (err) {
    toast('⚠️ ' + err.message);
    document.querySelectorAll('#qz-choices .choice').forEach((b) => (b.disabled = false));
  }
}

function closeQuizOverlay() {
  hideOverlay('quiz-overlay');
  openQuestion = null;
  const wasPractice = practiceOpen;
  practiceOpen = false;
  if (!wasPractice && quiz && answeredCount() >= quiz.questions.length) showResult();
}
$('qz-close').addEventListener('click', closeQuizOverlay);
$('qz-done').addEventListener('click', closeQuizOverlay);

// 퀴즈 블록 근접 프롬프트
setInterval(() => {
  if (!engine || !quiz || openQuestion != null) { $('quiz-prompt').style.display = 'none'; return; }
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
$('btn-classic').addEventListener('click', () => { location.href = 'play.html'; });
if (!localStorage.getItem('bq_help_seen')) showOverlay('help-overlay');

// ---------- 배경음 토글 ----------
function renderMusicBtn() { $('btn-music').textContent = BQ.music.muted ? '🔇' : '🔊'; }
$('btn-music').addEventListener('click', () => {
  BQ.music.toggleMute();
  renderMusicBtn();
  BQ.sound('click');
});
renderMusicBtn();

// ---------- 이모지 픽커 ----------
$('btn-emote').addEventListener('click', () => {
  $('emote-picker').classList.toggle('hidden');
});
document.querySelectorAll('#emote-picker .em').forEach((b) => {
  b.addEventListener('click', () => {
    const e = b.dataset.e;
    $('emote-picker').classList.add('hidden');
    if (engine) engine.showEmote('me', e);
    if (socket && socket.connected) socket.emit('p:emote', { e });
  });
});

// ---------- 가방 (코인 / 장식 블록 / 모자·펫 장착) ----------
function renderBag() {
  $('bag-coins').textContent = `⭐ ${BQ.fmt(coinBalance())} 코인`;
  $('bag-decors').innerHTML = DECOR_TYPES.map((t) => {
    const n = inventory.decors[t] || 0;
    return `<div class="bag-item ${n ? '' : 'none'}">${DECOR_INFO[t].emoji}<div class="bag-cnt">×${n}</div><div class="bag-nm">${DECOR_INFO[t].label}</div></div>`;
  }).join('');
  const hats = inventory.cosmetics.filter((c) => c.startsWith('hat:')).map((c) => c.slice(4)).filter((k) => HAT_DEFS[k]);
  const pets = inventory.cosmetics.filter((c) => c.startsWith('pet:')).map((c) => c.slice(4)).filter((k) => PET_DEFS[k]);
  $('bag-hats').innerHTML = hats.length
    ? hats.map((k) => `<button class="bag-item ${inventory.hat === k ? 'sel' : ''}" data-hat="${k}">
        <span class="bag-chip" style="background:${hexColor(HAT_DEFS[k].color)}"></span>
        <div class="bag-nm">${HAT_DEFS[k].label}${inventory.hat === k ? ' ✓' : ''}</div>
      </button>`).join('')
    : '<div class="muted" style="font-size:13px">복습 보상으로 모자를 모아보세요!</div>';
  $('bag-pets').innerHTML = pets.length
    ? pets.map((k) => `<button class="bag-item ${inventory.pet === k ? 'sel' : ''}" data-pet="${k}">
        <span class="bag-chip" style="background:${hexColor(PET_DEFS[k].color)}"></span>
        <div class="bag-nm">${PET_DEFS[k].label}${inventory.pet === k ? ' ✓' : ''}</div>
      </button>`).join('')
    : '<div class="muted" style="font-size:13px">복습 보상으로 펫을 모아보세요!</div>';
}
// 장착/해제 → 엔진 반영 + 서버 브로드캐스트
function syncMyStyle() {
  if (engine) engine.setStyle('me', { hat: inventory.hat, pet: inventory.pet });
  if (socket && socket.connected) socket.emit('p:style', { hat: inventory.hat, pet: inventory.pet });
  BQ.sound('click');
  renderBag();
}
$('bag-hats').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-hat]');
  if (!b) return;
  inventory.hat = inventory.hat === b.dataset.hat ? null : b.dataset.hat;
  syncMyStyle();
});
$('bag-pets').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pet]');
  if (!b) return;
  inventory.pet = inventory.pet === b.dataset.pet ? null : b.dataset.pet;
  syncMyStyle();
});
$('btn-bag').addEventListener('click', () => { renderBag(); showOverlay('bag-overlay'); });
$('bag-close').addEventListener('click', () => hideOverlay('bag-overlay'));

// iOS/크롬 오디오 잠금 해제 (첫 사용자 제스처)
addEventListener('pointerdown', function unlockOnce() {
  BQ.unlockAudio();
  removeEventListener('pointerdown', unlockOnce);
}, { once: true });

// ---------- 상태 로드 / 재동기화 ----------
async function fetchState() {
  const qs = new URLSearchParams({
    classId: session.classId, studentId: session.studentId, secret: session.secret || '',
  });
  const res = await fetch(`api/student/state?${qs}`);
  if (res.status === 404) {
    // 세션이 무효(학급/학생 삭제 또는 인증 실패)일 때만 세션을 버린다
    localStorage.removeItem('bq_student');
    location.href = './';
    return null;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '상태를 불러오지 못했습니다.');
  return data;
}

function applyState(data, { silent } = {}) {
  me = data.student;
  board = data.leaderboard;
  if (data.inventory) inventory = normalizeInventory(data.inventory);
  if (selectedDecor && !(inventory.decors[selectedDecor] > 0)) selectedDecor = ownedDecorTypes()[0] || null;
  renderTop();
  renderCoins();
  renderHotbar();
  if (engine) { engine.setStyle('me', { hat: inventory.hat, pet: inventory.pet }); engine.setArmor(currentArmor()); renderCombat(); }

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
      // 끊긴 사이 퀴즈가 종료됨 — 블록은 남겨 복습 모드로 전환
      if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; practiceOpen = false; }
      showResult();
      retireQuiz();
    } else if (!silent) {
      toast('⛏️ 자유 시간! 선생님이 퀴즈를 시작하면 황금 블록이 나타나요', 3200);
    }
  }
}

async function refreshState({ silent } = {}) {
  const data = await fetchState();
  if (!data) return; // 세션 무효 — 리다이렉트 중
  applyState(data, { silent });
}

// ---------- 게임 시작 (엔진 생성 + 소켓 연결 + 이벤트 배선) ----------
function startGame(data) {
  // 엔진: 서버가 알려준 맵으로 생성한다
  engine = createEngine({
    canvas: $('game-canvas'),
    classSeed: hashStr(session.classId),
    avatarKey: session.avatar,
    playerName: session.name,
    mapKey: data.mapKey || 'classic',
  });

  // ---------- 컨트롤 ----------
  controls = createControls({
    canvas: $('game-canvas'),
    joystickEl: $('joy'),
    knobEl: $('joy-knob'),
    jumpBtn: $('btn-jump'),
    actionBtn: $('btn-act'),
    callbacks: {
      move: (x, y) => engine.setMove(x, y),
      jump: () => engine.jump(),
      jumpHold: (v) => engine.setJumpHeld(v), // 꾹 누르면 제트팩 (연료 있을 때)
      drag: (dx, dy) => engine.rotateCamera(dx, dy),
      tap: (x, y) => useToolAt(x, y),
      action: () => {
        const slot = SLOTS[selectedSlot].id;
        if (slot === 'gun') doShoot();
        else if (slot === 'bomb') doBomb();
        else if (slot === 'firework') doFirework();
        else if (slot === 'block' || slot === 'decor') doPlace(null); // 액션 버튼 = 정면 설치
        else useToolAt(innerWidth / 2, innerHeight / 2);
      },
      slot: (i) => selectSlot(i),
    },
  });
  syncControlLock(); // 부팅 전 열린 오버레이(도움말 등)의 잠금 상태를 반영

  // ---------- 엔진 콜백 ----------
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

  // ---------- 아이템 픽업 ----------
  engine.on('itemPickup', (type, def) => {
    if (type === 'boots') { engine.setSpeedBoost(10000); toast(`${def.emoji} ${def.label}! 10초간 빠르게!`); }
    else if (type === 'gun') { inv.ammo += 8; toast(`${def.emoji} ${def.label} 탄약 +8!`); }
    else if (type === 'bomb') { inv.bombs += 2; toast(`${def.emoji} ${def.label} +2!`); }
    else if (type === 'gem') { inv.blocks += 6; toast(`${def.emoji} 블록 +6!`); }
    else if (type === 'jet') { engine.addJetFuel(6); toast(`${def.emoji} ${def.label}! 연료 +6초 — 점프를 꾹!`); }
    else if (type === 'firework') { inv.fireworks += 2; toast(`${def.emoji} ${def.label} +2!`); }
    else if (type === 'coin') {
      // 황금 시간엔 코인 2배 (토스트는 생략 — 자주 발생)
      const gain = Date.now() < goldenUntil ? 2 : 1;
      localCoins += gain;
      BQ.sound('coin');
      renderCoins();
    }
    renderHotbar();
  });

  // ---------- 월드 이벤트 ----------
  engine.on('treasureOpen', () => {
    // 보물상자 보상: 코인 +15(로컬 표시) + 폭죽 +2
    localCoins += 15;
    inv.fireworks += 2;
    renderCoins();
    renderHotbar();
    BQ.sound('reward');
    toast('🎁 보물상자 발견! ⭐ 코인 +15 · 🎆 폭죽 +2', 2600);
  });
  engine.on('animalTouch', (kind) => {
    BQ.sound(kind); // 'chicken' | 'pig'
    // 하트 파티클
    engine.burst(engine.player.pos.clone().add(new engine.THREE.Vector3(0, 1.6, 0)), 0xff6b9d, 10, 0.6);
  });
  engine.on('meteor', () => toast('🌠 유성이 떨어졌어요!', 2400));

  // ---------- 전투: 좀비 처치 / 피격 / 쓰러짐 ----------
  engine.setGunLevel(gunLevel);
  engine.setArmor(currentArmor());
  engine.on('zombieKilled', ({ level, points, name }) => {
    killCount += 1;
    // 처치 시 코인도 지급 (강한 좀비일수록 많이) → 코인으로 총 업그레이드
    const coinGain = KILL_COINS[level] || 2;
    localCoins += coinGain;
    persistCombat();
    renderCoins();
    BQ.floatText(innerWidth / 2 - 40, innerHeight / 3, `+${points}P`, '#9acd32');
    if (level <= 2) toast(`💀 ${name} 처치! +${points}P · ⭐+${coinGain}`, 1800); // 강한 좀비만 알림
    awardKill(level);
  });
  engine.on('playerHurt', () => { renderCombat(); flashDamage(); });
  engine.on('playerDown', () => { toast('💀 쓰러졌어요! 안전한 곳에서 다시 시작합니다', 2400); BQ.sound('wrong'); renderCombat(); });

  $('btn-gun-up').addEventListener('click', upgradeGun);
  renderCombat();
  // 체력/방어력 HUD 주기적 갱신 (물림·회복 반영)
  setInterval(renderCombat, 200);
  // 탄약 서서히 재충전 (좀비와 계속 싸울 수 있도록, 최대 50) — 아이템 픽업은 즉시 보충
  setInterval(() => {
    if (inv.ammo < 50) { inv.ammo += 1; if (SLOTS[selectedSlot].id === 'gun') renderHotbar(); }
  }, 1500);
  engine.on('courseStart', () => {
    courseStartAt = Date.now();
    $('course-timer').style.display = 'block';
    toast('🏁 타임어택 시작! 꼭대기 골 링까지 달려요!', 2200);
    BQ.sound('start');
  });
  engine.on('courseEnd', (sec) => {
    courseStartAt = 0;
    $('course-timer').style.display = 'none';
    const best = Number(localStorage.getItem('bq_course_best') || 0);
    if (!best || sec < best) {
      localStorage.setItem('bq_course_best', String(sec));
      toast(`🏁 완주! ${sec.toFixed(1)}초 — ✨ 신기록!`, 2800);
      BQ.sound('levelup');
    } else {
      toast(`🏁 완주! ${sec.toFixed(1)}초 (최고 기록 ${best.toFixed(1)}초)`, 2600);
      BQ.sound('correct');
    }
  });
  engine.on('crowned', () => {
    toast('👑 왕관 정복!', 2400);
    BQ.sound('crown');
  });

  // ---------- 존 배경음 ----------
  engine.onZoneChange((zoneKey) => BQ.music.start(zoneKey));
  BQ.music.start(engine.getPlayerZone()); // 시작 존 음악 (오디오 잠금 해제 후 자동 시작)

  // ---------- 서버 연동 ----------
  socket = io();
  socket.on('connect', () => {
    socket.emit('join', {
      classId: session.classId, role: 'student',
      studentId: session.studentId, secret: session.secret, mode: 'world',
    });
    // 재접속이라면 끊긴 사이 놓친 퀴즈 시작/종료/답안 상태를 다시 맞춘다
    if (stateLoaded) refreshState({ silent: true }).catch(() => { /* 다음 재접속에서 재시도 */ });
  });
  socket.on('world:state', ({ diffs, players }) => {
    engine.applyDiffs(diffs);
    for (const p of players || []) {
      engine.addRemote(p.id, p);
      if (p.hat || p.pet) engine.setStyle(p.id, { hat: p.hat || null, pet: p.pet || null });
    }
  });
  socket.on('p:join', (p) => {
    if (p.id !== session.studentId) {
      engine.addRemote(p.id, p);
      if (p.hat || p.pet) engine.setStyle(p.id, { hat: p.hat || null, pet: p.pet || null });
      toast(`👋 ${p.name} 님이 입장했어요`, 1500);
    }
  });
  socket.on('p:leave', ({ id }) => engine.removeRemote(id));
  socket.on('p:move', (m) => {
    if (m.id === session.studentId) return;
    engine.updateRemote(m.id, m);
  });
  socket.on('p:emote', ({ id, e }) => {
    if (id === session.studentId) return;
    engine.showEmote(id, e);
  });
  socket.on('p:style', ({ id, hat, pet }) => {
    if (id === session.studentId) return;
    engine.setStyle(id, { hat: hat || null, pet: pet || null });
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
    // 서버가 설치를 거부(한도 초과/장식 재고 없음) — 로컬 블록을 되돌리고 재고 반환
    const t = engine.blocks.get(key);
    if (t) {
      engine.removeBlock(key);
      if (DECOR_TYPES.includes(t)) inventory.decors[t] = (inventory.decors[t] || 0) + 1;
      else inv.blocks += 1;
      renderHotbar();
    }
    toast('🧱 지금은 설치할 수 없어요!', 1800);
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
    if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; practiceOpen = false; }
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
      if (openQuestion != null) { hideOverlay('quiz-overlay'); openQuestion = null; practiceOpen = false; }
      showResult();
      retireQuiz(); // 블록은 남겨 복습 모드로 전환
    }
  });
  socket.on('leaderboard:update', (data2) => {
    board = data2;
    const mine = board.rankings.find((r) => r.id === session.studentId);
    if (mine && me) { me.points = mine.points; renderTop(); }
  });
  socket.on('world:map', () => {
    // 교사가 맵을 변경 — 새 맵으로 다시 접속한다 (state의 mapKey로 재부팅)
    toast('🗺️ 선생님이 맵을 바꿨어요! 새 월드로 이동합니다...', 1500);
    setTimeout(() => location.reload(), 1500);
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

  // 제트 연료 게이지 + 타임어택 타이머 갱신
  setInterval(() => {
    const fuel = engine.getJetFuel();
    const bar = $('fuel-bar');
    if (fuel > 0.05) {
      bar.classList.remove('hidden');
      $('fuel-fill').style.width = `${Math.min(100, (fuel / 12) * 100)}%`;
    } else {
      bar.classList.add('hidden');
    }
    if (courseStartAt) $('course-timer').textContent = `⏱ ${((Date.now() - courseStartAt) / 1000).toFixed(1)}초`;
  }, 120);

  // 황금 시간: 5분마다 30초 동안 코인 2배
  setInterval(() => {
    goldenUntil = Date.now() + 30000;
    toast('✨ 황금 시간! 30초 동안 코인 2배!', 2600);
    BQ.sound('reward');
  }, 300000);

  // 초기 상태 반영 → 로딩 오버레이 해제
  applyState(data);
  stateLoaded = true;
  $('loading-overlay').classList.add('hidden');

  // 개발/디버그용 훅 (콘솔에서 월드 조작 가능)
  window.bqDebug = {
    engine,
    get quiz() { return quiz; },
    get inv() { return inv; },
    get inventory() { return inventory; },
  };
}

// ---------- 부팅 ----------
(async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await fetchState();
      if (!data) return; // 세션 무효 — 리다이렉트 중
      startGame(data);
      return;
    } catch {
      // 일시적 네트워크 오류 — 세션을 지우지 않고 재시도
      $('loading-msg').textContent = '📡 서버 연결 중...';
      await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
    }
  }
})();
