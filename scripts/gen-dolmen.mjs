/* ============================================================================
 * 5-2-1 1차시 페이퍼크래프트 — 「탁자식 고인돌」 전개도 생성기
 * ----------------------------------------------------------------------------
 * SVG 1 단위 = 1mm.  A4 안쪽(여백 10mm) 가용 영역 = 190 × 277mm.
 * 조각: 덮개돌(열린 상자) 1 · 굄돌(사각기둥) 2 · 막음돌 1   ← 탁자식 = 굄돌 3개
 *       받침판 1 · 통나무 굴림대 3 · 흙 경사로 실루엣 2 · 순서 카드 4
 * 출력: public/social/lessons/5-2-1/01/craft/index.html  (HTML 한 파일을 통째로 씀)
 * ========================================================================== */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(new URL('../public/social/lessons/5-2-1/01/craft/index.html', import.meta.url).pathname);

const r2 = (n) => Math.round(n * 100) / 100;
const PW = 190;                       // 인쇄 가용 폭
const TAB = 6;                        // 풀칠 탭 폭
const parts = [];                     // 검증용 조각 명세(생성 후 콘솔로 출력)

/* ── 공통 헬퍼 ───────────────────────────────────────────────────────────── */

// 사각형 자르기 선
const cut = (x, y, w, h) =>
  `<rect class="cutline" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/>`;
// 접는 선 (수평/수직)
const foldH = (x1, x2, y) => `<line class="foldline" x1="${r2(x1)}" y1="${r2(y)}" x2="${r2(x2)}" y2="${r2(y)}"/>`;
const foldV = (y1, y2, x) => `<line class="foldline" x1="${r2(x)}" y1="${r2(y1)}" x2="${r2(x)}" y2="${r2(y2)}"/>`;
// 글자
const t = (x, y, s, cls = 'facelab', anchor = 'middle') =>
  `<text class="${cls}" x="${r2(x)}" y="${r2(y)}" text-anchor="${anchor}">${s}</text>`;

/* 풀칠 탭 — 사다리꼴(붙일 때 삐져나오지 않게 양 끝을 1.4mm 깎는다)
   side: 'R'|'L'|'T'|'B'  = 어느 변에 붙는 탭인가 */
function tab(x, y, w, h, side) {
  const k = 1.4;
  let d;
  if (side === 'R')      d = `M${r2(x)},${r2(y)} L${r2(x + w)},${r2(y + k)} L${r2(x + w)},${r2(y + h - k)} L${r2(x)},${r2(y + h)} Z`;
  else if (side === 'L') d = `M${r2(x + w)},${r2(y)} L${r2(x)},${r2(y + k)} L${r2(x)},${r2(y + h - k)} L${r2(x + w)},${r2(y + h)} Z`;
  else if (side === 'B') d = `M${r2(x)},${r2(y)} L${r2(x + k)},${r2(y + h)} L${r2(x + w - k)},${r2(y + h)} L${r2(x + w)},${r2(y)} Z`;
  else                   d = `M${r2(x)},${r2(y + h)} L${r2(x + k)},${r2(y)} L${r2(x + w - k)},${r2(y)} L${r2(x + w)},${r2(y + h)} Z`;
  return `<path class="tab" d="${d}"/>`;
}

/* ── ① 덮개돌 — 바닥 없는 납작한 상자 (위에서만 보이므로 밑면 생략) ────────
   윗면 CL×CW, 네 옆면 높이 CH. 좌·우 옆면에 탭을 달아 앞·뒤 옆면 안쪽에 붙인다. */
const CL = 112, CW = 72, CH = 12;
function capstone(ox, oy) {
  const g = [];
  const x0 = ox + CH, y0 = oy + CH;        // 윗면 좌상단 (뒤 옆면·좌 옆면 두께만큼 안쪽)
  // 윗면
  g.push(`<rect class="stonetop" x="${r2(x0)}" y="${r2(y0)}" width="${CL}" height="${CW}"/>`);
  for (let i = 1; i <= 5; i++) {           // 돌 표면 결 (장식)
    const yy = y0 + (CW * i) / 6;
    g.push(`<path class="grain" d="M${r2(x0 + 8)},${r2(yy)} q${r2(CL * 0.24)},${i % 2 ? -3 : 3} ${r2(CL * 0.48)},0 t${r2(CL * 0.44 - 8)},0"/>`);
  }
  g.push(t(x0 + CL / 2, y0 + CW / 2 - 1, '덮개돌', 'facelab'));
  g.push(t(x0 + CL / 2, y0 + CW / 2 + 5.4, '이 면이 하늘을 봅니다', 'facelab2'));
  // 네 옆면
  g.push(`<rect class="stoneside" x="${r2(x0)}" y="${r2(oy)}" width="${CL}" height="${CH}"/>`);         // 뒤
  g.push(`<rect class="stoneside" x="${r2(x0)}" y="${r2(y0 + CW)}" width="${CL}" height="${CH}"/>`);    // 앞
  g.push(`<rect class="stoneside" x="${r2(ox)}" y="${r2(y0)}" width="${CH}" height="${CW}"/>`);         // 좌
  g.push(`<rect class="stoneside" x="${r2(x0 + CL)}" y="${r2(y0)}" width="${CH}" height="${CW}"/>`);    // 우
  // 바깥 윤곽 — 십자(+) 모양. 네 귀퉁이는 탭 자리라 비워 둔다.
  const k = 1.4;                           // tab() 의 깎임과 같은 값
  g.push(`<path class="cutline" d="${[
    `M${r2(x0)},${r2(oy)}`, `L${r2(x0 + CL)},${r2(oy)}`,
    `L${r2(x0 + CL)},${r2(y0)}`,
    `L${r2(x0 + CL + k)},${r2(oy)}`, `L${r2(x0 + CL + CH - k)},${r2(oy)}`, `L${r2(x0 + CL + CH)},${r2(y0)}`,
    `L${r2(x0 + CL + CH)},${r2(y0 + CW)}`,
    `L${r2(x0 + CL + CH - k)},${r2(y0 + CW + CH)}`, `L${r2(x0 + CL + k)},${r2(y0 + CW + CH)}`, `L${r2(x0 + CL)},${r2(y0 + CW)}`,
    `L${r2(x0 + CL)},${r2(y0 + CW + CH)}`, `L${r2(x0)},${r2(y0 + CW + CH)}`,
    `L${r2(x0)},${r2(y0 + CW)}`,
    `L${r2(x0 - k)},${r2(y0 + CW + CH)}`, `L${r2(ox + k)},${r2(y0 + CW + CH)}`, `L${r2(ox)},${r2(y0 + CW)}`,
    `L${r2(ox)},${r2(y0)}`,
    `L${r2(ox + k)},${r2(oy)}`, `L${r2(x0 - k)},${r2(oy)}`, `L${r2(x0)},${r2(y0)}`, 'Z'
  ].join(' ')}"/>`);
  // 좌·우 옆면에 달린 풀칠 탭 4개 — 접어 올려 앞·뒤 옆면 안쪽에 붙인다
  g.push(tab(ox, oy, CH, CH, 'T'));
  g.push(tab(ox, y0 + CW, CH, CH, 'B'));
  g.push(tab(x0 + CL, oy, CH, CH, 'T'));
  g.push(tab(x0 + CL, y0 + CW, CH, CH, 'B'));
  // 접는 선 — 윗면 둘레 네 변 + 탭 네 개
  g.push(foldH(x0, x0 + CL, y0), foldH(x0, x0 + CL, y0 + CW));
  g.push(foldV(y0, y0 + CW, x0), foldV(y0, y0 + CW, x0 + CL));
  g.push(foldH(ox, x0, y0), foldH(ox, x0, y0 + CW));
  g.push(foldH(x0 + CL, x0 + CL + CH, y0), foldH(x0 + CL, x0 + CL + CH, y0 + CW));
  parts.push({ name: '덮개돌', x: ox, y: oy, w: CH * 2 + CL, h: CH * 2 + CW });
  return g.join('\n    ');
}
const CAP_W = CH * 2 + CL;            // 136
const CAP_H = CH * 2 + CW;            //  96

/* ── ② 굄돌(사각기둥) — 네 면 띠 + 윗면. 밑면은 열어 둔다 ───────────────── */
const UW = 22, UD = 18, UH = 42;
function upright(ox, oy, label) {
  const g = [];
  const y0 = oy + UD;                                  // 띠 시작 y (위에 윗면)
  const panels = [UW, UD, UW, UD];
  let x = ox;
  panels.forEach((w, i) => {
    g.push(`<rect class="stone" x="${r2(x)}" y="${r2(y0)}" width="${r2(w)}" height="${UH}"/>`);
    if (i > 0) g.push(foldV(y0, y0 + UH, x));
    x += w;
  });
  const BW = panels.reduce((a, b) => a + b, 0);        // 84
  // 윗면 (첫 면 위)
  g.push(`<rect class="stonetop" x="${r2(ox)}" y="${r2(oy)}" width="${UW}" height="${UD}"/>`);
  g.push(foldH(ox, ox + UW, y0));
  g.push(t(ox + UW / 2, oy + UD / 2 + 1.4, '윗면', 'facelab2'));
  // 오른쪽 풀칠 탭
  g.push(tab(ox + BW, y0, TAB, UH, 'R'));
  g.push(foldV(y0, y0 + UH, ox + BW));
  // 돌 결
  for (let i = 1; i <= 4; i++) {
    const yy = y0 + (UH * i) / 5;
    g.push(`<path class="grain" d="M${r2(ox + 3)},${r2(yy)} q${r2(BW * 0.25)},${i % 2 ? -2.4 : 2.4} ${r2(BW * 0.5)},0 t${r2(BW * 0.5 - 3)},0"/>`);
  }
  g.push(t(ox + UW / 2, y0 + UH / 2, label, 'facelab'));
  g.push(t(ox + UW + UD + UW / 2, y0 + UH / 2, '밑면은 열어 둡니다', 'facelab2'));
  // 바깥 윤곽
  g.push(`<path class="cutline" d="${[
    `M${r2(ox)},${r2(oy)}`, `L${r2(ox + UW)},${r2(oy)}`, `L${r2(ox + UW)},${r2(y0)}`,
    `L${r2(ox + BW)},${r2(y0)}`, `L${r2(ox + BW + TAB)},${r2(y0 + 1.4)}`,
    `L${r2(ox + BW + TAB)},${r2(y0 + UH - 1.4)}`, `L${r2(ox + BW)},${r2(y0 + UH)}`,
    `L${r2(ox)},${r2(y0 + UH)}`, 'Z'
  ].join(' ')}"/>`);
  parts.push({ name: label, x: ox, y: oy, w: BW + TAB, h: UD + UH });
  return g.join('\n    ');
}
const UP_W = UW * 2 + UD * 2 + TAB;   // 91
const UP_H = UD + UH;                 // 64

/* ── ③ 막음돌 — 뒤를 받치는 넓적한 판(사각기둥) ──────────────────────────── */
const EW = 52, ED = 16, EH = UH;   // EH = UH : 세 굄돌 높이가 같아야 덮개돌이 기울지 않는다
function endstone(ox, oy) {
  const g = [];
  const y0 = oy + ED;
  const panels = [EW, ED, EW, ED];
  let x = ox;
  panels.forEach((w, i) => {
    g.push(`<rect class="stone" x="${r2(x)}" y="${r2(y0)}" width="${r2(w)}" height="${EH}"/>`);
    if (i > 0) g.push(foldV(y0, y0 + EH, x));
    x += w;
  });
  const BW = panels.reduce((a, b) => a + b, 0);       // 148
  g.push(`<rect class="stonetop" x="${r2(ox)}" y="${r2(oy)}" width="${EW}" height="${ED}"/>`);
  g.push(foldH(ox, ox + EW, y0));
  g.push(t(ox + EW / 2, oy + ED / 2 + 1.4, '윗면', 'facelab2'));
  g.push(tab(ox + BW, y0, TAB, EH, 'R'));
  g.push(foldV(y0, y0 + EH, ox + BW));
  for (let i = 1; i <= 3; i++) {
    const yy = y0 + (EH * i) / 4;
    g.push(`<path class="grain" d="M${r2(ox + 4)},${r2(yy)} q${r2(BW * 0.25)},${i % 2 ? -2.4 : 2.4} ${r2(BW * 0.5)},0 t${r2(BW * 0.5 - 4)},0"/>`);
  }
  g.push(t(ox + EW / 2, y0 + EH / 2, '막음돌 (뒤쪽 굄돌)', 'facelab'));
  g.push(`<path class="cutline" d="${[
    `M${r2(ox)},${r2(oy)}`, `L${r2(ox + EW)},${r2(oy)}`, `L${r2(ox + EW)},${r2(y0)}`,
    `L${r2(ox + BW)},${r2(y0)}`, `L${r2(ox + BW + TAB)},${r2(y0 + 1.4)}`,
    `L${r2(ox + BW + TAB)},${r2(y0 + EH - 1.4)}`, `L${r2(ox + BW)},${r2(y0 + EH)}`,
    `L${r2(ox)},${r2(y0 + EH)}`, 'Z'
  ].join(' ')}"/>`);
  parts.push({ name: '막음돌', x: ox, y: oy, w: BW + TAB, h: ED + EH });
  return g.join('\n    ');
}
const END_W = EW * 2 + ED * 2 + TAB;  // 155
const END_H = ED + EH;                // 56

/* ── ④ 받침판 — 굄돌 자리 점선 + 순서 번호 ──────────────────────────────── */
const BPW = 170, BPH = 92;
function baseplate(ox, oy) {
  const g = [];
  g.push(`<rect class="ground" x="${r2(ox)}" y="${r2(oy)}" width="${BPW}" height="${BPH}" rx="3"/>`);
  g.push(`<rect class="cutline" x="${r2(ox)}" y="${r2(oy)}" width="${BPW}" height="${BPH}" rx="3" fill="none"/>`);
  // 풀 자라는 땅 결
  for (let i = 0; i < 34; i++) {
    const gx = ox + 6 + (i * (BPW - 12)) / 33;
    const gy = oy + BPH - 6 - (i % 3) * 2.4;
    g.push(`<path class="turf" d="M${r2(gx)},${r2(gy)} l-1.5,-3.6 M${r2(gx)},${r2(gy)} l0,-4.4 M${r2(gx)},${r2(gy)} l1.5,-3.6"/>`);
  }
  g.push(t(ox + BPW / 2, oy + 9, '고인돌 자리 — 받침판', 'platetitle'));
  g.push(t(ox + BPW / 2, oy + 15.4, '굄돌 셋을 점선 자리에 세우고, 그 위에 덮개돌을 얹어요', 'fplab2'));

  // 평면도 — 덮개돌이 덮는 실제 범위 안에 굄돌 셋을 놓는다
  const cx = ox + BPW / 2;
  const capTop = oy + 18;                                   // 덮개돌 자리 윗변
  g.push(`<rect class="capshadow" x="${r2(cx - CL / 2)}" y="${r2(capTop)}" width="${CL}" height="${CW}" rx="2"/>`);
  g.push(t(cx, capTop + 5.2, '← 덮개돌이 덮이는 범위 →', 'fplab2'));
  const fp = (x, y, w, h, lab) => {
    g.push(`<rect class="footprint" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="1.4"/>`);
    g.push(t(x + w / 2, y + h / 2 + 1.3, lab, 'fplab'));
  };
  fp(cx - EW / 2, capTop + 8, EW, ED, '막음돌 (뒤)');         //  → capTop+24
  fp(cx - 38 - UW / 2, capTop + 44, UW, UD, '굄돌 ㉮');       //  → capTop+62
  fp(cx + 38 - UW / 2, capTop + 44, UW, UD, '굄돌 ㉯');
  parts.push({ name: '받침판', x: ox, y: oy, w: BPW, h: BPH });
  return g.join('\n    ');
}

/* ── ⑤ 통나무 굴림대 — 말아 붙이는 원통 ─────────────────────────────────── */
const LOG_D = 16, LOG_L = 46;
const LOG_C = r2(Math.PI * LOG_D);    // 둘레 28.27
function log(ox, oy, n) {
  const g = [];
  g.push(`<rect class="wood" x="${r2(ox)}" y="${r2(oy)}" width="${LOG_C}" height="${LOG_L}"/>`);
  // 나뭇결
  for (let i = 1; i <= 3; i++) {
    const xx = ox + (LOG_C * i) / 4;
    g.push(`<line class="woodgrain" x1="${r2(xx)}" y1="${r2(oy + 3)}" x2="${r2(xx)}" y2="${r2(oy + LOG_L - 3)}"/>`);
  }
  g.push(tab(ox + LOG_C, oy, 5.5, LOG_L, 'R'));
  g.push(`<path class="cutline" d="${[
    `M${r2(ox)},${r2(oy)}`, `L${r2(ox + LOG_C)},${r2(oy)}`,
    `L${r2(ox + LOG_C + 5.5)},${r2(oy + 1.4)}`, `L${r2(ox + LOG_C + 5.5)},${r2(oy + LOG_L - 1.4)}`,
    `L${r2(ox + LOG_C)},${r2(oy + LOG_L)}`, `L${r2(ox)},${r2(oy + LOG_L)}`, 'Z'
  ].join(' ')}"/>`);
  g.push(foldV(oy, oy + LOG_L, ox + LOG_C));
  g.push(`<text class="facelab2" x="${r2(ox + LOG_C / 2)}" y="${r2(oy + LOG_L / 2)}" text-anchor="middle" transform="rotate(-90 ${r2(ox + LOG_C / 2)} ${r2(oy + LOG_L / 2)})">통나무 ${n}</text>`);
  parts.push({ name: `통나무${n}`, x: ox, y: oy, w: LOG_C + 5.5, h: LOG_L });
  return g.join('\n    ');
}

/* ── ⑥ 흙 경사로 — 세우는 실루엣(직각삼각형 + 접어 세우는 발) ───────────── */
const RW = 62, RH = 34, RF = 10;
function ramp(ox, oy, flip) {
  const g = [];
  const yb = oy + RH;                                   // 밑변
  const apex = flip ? ox + RW : ox;                     // 높은 쪽
  const lo = flip ? ox : ox + RW;
  g.push(`<path class="soil" d="M${r2(apex)},${r2(oy)} L${r2(apex)},${r2(yb)} L${r2(lo)},${r2(yb)} Z"/>`);
  // 흙 결
  for (let i = 1; i <= 4; i++) {
    const yy = oy + (RH * i) / 5;
    const w = (RW * (yy - oy)) / RH;   // 꼭짓점에서 멀어질수록 넓어진다
    const xs = flip ? apex - w : apex + w;
    g.push(`<line class="soilgrain" x1="${r2(apex + (flip ? -2 : 2))}" y1="${r2(yy)}" x2="${r2(xs)}" y2="${r2(yy)}"/>`);
  }
  // 발 (밑변에서 뒤로 접음)
  g.push(tab(Math.min(apex, lo), yb, RW, RF, 'B'));
  g.push(foldH(Math.min(apex, lo), Math.min(apex, lo) + RW, yb));
  const sgn = apex < lo ? 1 : -1, k = 1.4;
  g.push(`<path class="cutline" d="M${r2(apex)},${r2(oy)} L${r2(apex)},${r2(yb)} L${r2(apex + sgn * k)},${r2(yb + RF)} L${r2(lo - sgn * k)},${r2(yb + RF)} L${r2(lo)},${r2(yb)} Z" fill="none"/>`);
  g.push(t(flip ? apex - 20 : apex + 20, yb - 6, '흙 경사로', 'facelab2'));
  parts.push({ name: `경사로${flip ? 'R' : 'L'}`, x: Math.min(apex, lo), y: oy, w: RW, h: RH + RF });
  return g.join('\n    ');
}

/* ── ⑦ 순서 카드 — 고인돌을 세운 네 단계 ───────────────────────────────── */
const CARDS = [
  ['①', '자리를 고르고', '굄돌 셋을 세운다'],
  ['②', '굄돌 주위에', '흙을 쌓아 언덕을 만든다'],
  ['③', '통나무와 줄로', '덮개돌을 끌어올린다'],
  ['④', '쌓았던 흙을', '치우면 완성!']
];
const CDW = 44, CDH = 30;
function card(ox, oy, i) {
  const [no, l1, l2] = CARDS[i];
  const g = [];
  g.push(`<rect class="card" x="${r2(ox)}" y="${r2(oy)}" width="${CDW}" height="${CDH}" rx="2.6"/>`);
  g.push(`<rect class="cutline" x="${r2(ox)}" y="${r2(oy)}" width="${CDW}" height="${CDH}" rx="2.6" fill="none"/>`);
  g.push(t(ox + CDW / 2, oy + 12, no, 'cardbig'));
  g.push(t(ox + CDW / 2, oy + 20.5, l1, 'cardsub'));
  g.push(t(ox + CDW / 2, oy + 26, l2, 'cardsub'));
  parts.push({ name: `카드${i + 1}`, x: ox, y: oy, w: CDW, h: CDH });
  return g.join('\n    ');
}


/* ── ⑧ 완성 모습 — 사투상(oblique) 투영. 뒤에 있는 것부터 그려 가린다 ─────
   모델 좌표 (X 좌우, Y 깊이[0=뒤 … 72=앞], Z 높이) → 화면 좌표            */
const PX = (X, Y, Z) => [r2(20 + X + 0.45 * (72 - Y)), r2(76 - Z - 0.30 * (72 - Y))];
function box3d(X0, X1, Y0, Y1, Z0, Z1, front, top, side) {
  const q = (pts) => `<path class="${pts.cls}" d="M${pts.p.map((c) => c.join(',')).join(' L')} Z"/>`;
  return [
    q({ cls: side,  p: [PX(X1, Y0, Z0), PX(X1, Y1, Z0), PX(X1, Y1, Z1), PX(X1, Y0, Z1)] }),
    q({ cls: top,   p: [PX(X0, Y0, Z1), PX(X1, Y0, Z1), PX(X1, Y1, Z1), PX(X0, Y1, Z1)] }),
    q({ cls: front, p: [PX(X0, Y1, Z0), PX(X1, Y1, Z0), PX(X1, Y1, Z1), PX(X0, Y1, Z1)] })
  ].join('\n      ');
}
function assembled() {
  const g = [];
  const [gx, gy] = PX(56, 40, 0);
  g.push(`<ellipse class="ground3d" cx="${gx}" cy="${r2(gy + 2)}" rx="82" ry="9"/>`);
  g.push(box3d(30, 82, 8, 24, 0, 42, 'f3', 't3', 's3'));      // 막음돌 (뒤)
  g.push(box3d(76, 98, 46, 64, 0, 42, 'f3', 't3', 's3'));     // 굄돌 ㉯ (앞 오른쪽)
  g.push(box3d(14, 36, 46, 64, 0, 42, 'f3', 't3', 's3'));     // 굄돌 ㉮ (앞 왼쪽)
  g.push(box3d(0, 112, 0, 72, 42, 54, 'fcap', 'tcap', 'scap'));// 덮개돌
  // 지시선
  const lead = (x1, y1, x2, y2, lab, anchor) => {
    g.push(`<line class="lead" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"/>`);
    g.push(`<circle class="leaddot" cx="${r2(x1)}" cy="${r2(y1)}" r="0.9"/>`);
    g.push(`<text class="leadlab" x="${r2(x2)}" y="${r2(y2 + 1.3)}" text-anchor="${anchor}">${lab}</text>`);
  };
  const [cx1, cy1] = PX(56, 0, 54);
  lead(cx1, cy1, cx1 + 26, cy1 + 9, '덮개돌', 'start');
  const [ux, uy] = PX(25, 64, 22);
  lead(ux, uy, ux - 14, uy + 6, '굄돌 ㉮', 'end');
  const [ex, ey] = PX(82, 24, 20);
  lead(ex, ey, ex + 26, ey + 8, '막음돌 (뒤)', 'start');
  return g.join('\n      ');
}

/* ── 빗금(=풀칠) 범례를 도안 SVG 맨 위에 함께 그린다 (쪽마다 필요) ───────── */
function legend(oy) {
  const g = [];
  const y = oy + 3.4;
  const seg = (x, lab, inner) => {
    g.push(inner(x));
    g.push(`<text class="legendlab" x="${r2(x + 16)}" y="${r2(y + 1.5)}">${lab}</text>`);
  };
  seg(2,  '실선 = 자르기', (x) => `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x + 13)}" y2="${r2(y)}" stroke="#111" stroke-width="0.6"/>`);
  seg(56, '점선 = 접기',   (x) => `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x + 13)}" y2="${r2(y)}" stroke="#6a7a90" stroke-width="0.32" stroke-dasharray="2.6 1.7"/>`);
  seg(104, '빗금 = 풀칠',  (x) => `<rect x="${r2(x)}" y="${r2(y - 2.4)}" width="13" height="4.8" fill="url(#glue)" stroke="#111" stroke-width="0.35"/>`);
  g.push(`<text class="legendlab2" x="188" y="${r2(y + 1.5)}" text-anchor="end">실제 크기(100%)로 인쇄하세요</text>`);
  return g.join('\n    ');
}

/* ── 1쪽 조립 — 돌 조각 ─────────────────────────────────────────────────── */
const AVAIL = 243;                                 // 헤더(실측 22.3mm) 아래로 쓸 수 있는 높이 = 277 - 22.3 - 여유
const P1 = [];
P1.push(legend(0));
const capY = 7;
P1.push(capstone(r2((PW - CAP_W) / 2), capY));                    //   9 → 117
const upY = capY + CAP_H + 3;                                     // 122 → 182
P1.push(upright(4, upY, '굄돌 ㉮'));
P1.push(upright(4 + UP_W + 6, upY, '굄돌 ㉯'));
const endY = upY + UP_H + 3;                                      // 187 → 245
P1.push(endstone(4, endY));
const P1_BOTTOM = endY + END_H;

/* ── 2쪽 조립 — 받침판 · 통나무 · 흙 경사로 · 순서 카드 ─────────────────── */
const P2 = [];
P2.push(legend(0));
const bpY = 7;
P2.push(baseplate(r2((PW - BPW) / 2), bpY));                      //   9 → 105
const logCapY = bpY + BPH + 7;
P2.push(`<text class="rowcap" x="4" y="${r2(logCapY)}">통나무 굴림대 3개 — 둥글게 말아 빗금 탭을 붙이세요</text>`);
const logY = logCapY + 3;
[0, 1, 2].forEach((i) => P2.push(log(4 + i * (LOG_C + 5.5 + 8), logY, i + 1)));
const rampCapY = logY + LOG_L + 7;
P2.push(`<text class="rowcap" x="4" y="${r2(rampCapY)}">흙 경사로 2개 — 밑에 달린 빗금 발을 뒤로 접어 세우세요 (고인돌 쪽이 높습니다)</text>`);
const rampY = rampCapY + 3;
P2.push(ramp(6, rampY, true));            // 왼쪽 경사로 — 오른쪽(고인돌 쪽)이 높다
P2.push(ramp(PW - 6 - RW, rampY, false));  // 오른쪽 경사로 — 왼쪽(고인돌 쪽)이 높다
const cardY = rampY + RH + RF + 4;
[0, 1, 2, 3].forEach((i) => P2.push(card(2 + i * (CDW + 2.5), cardY, i)));
const P2_BOTTOM = cardY + CDH;

/* ── 검증: 가용 영역을 벗어나는 조각이 있는지 ───────────────────────────── */
let bad = 0;
for (const p of parts) {
  if (p.x < -0.01 || p.y < -0.01 || p.x + p.w > PW + 0.01 || p.y + p.h > AVAIL + 0.01) {
    console.error(`\u2716 \ub118\uce68: ${p.name}  x=${r2(p.x)} y=${r2(p.y)} w=${r2(p.w)} h=${r2(p.h)} \u2192 \uc6b0=${r2(p.x + p.w)} \ud558=${r2(p.y + p.h)}`);
    bad++;
  }
}
console.log(`조각 ${parts.length}개 · 넘침 ${bad}개 (가용 ${PW}\u00d7${AVAIL}mm)`);
console.log(`1쪽 아래끝 ${r2(P1_BOTTOM)}mm · 2쪽 아래끝 ${r2(P2_BOTTOM)}mm`);
console.log(`덮개돌 ${CAP_W}\u00d7${CAP_H} · 굄돌 ${UP_W}\u00d7${UP_H} · 막음돌 ${END_W}\u00d7${END_H} · 통나무 둘레 ${LOG_C}`);
console.log(`굄돌 높이 ${UH} / 막음돌 높이 ${EH} ${UH === EH ? '(일치 \u2713)' : '(\u2716 높이 불일치 \u2014 덮개돌이 기웁니다)'}`);
if (bad || UH !== EH) process.exit(1);

/* ── 탭 규약 자동 검사 ─────────────────────────────────────────────────────
 * 풀칠 탭은 "경첩으로 접히고 바깥 세 변은 잘린다". 이 규약을 손으로 지키다
 * capstone() 과 ramp() 두 곳에서 놓쳐, 경첩이 자르기선으로 인쇄된 적이 있다
 * (그대로 오리면 탭이 떨어져 나가 조립이 불가능해진다).
 * 그래서 사람 대신 여기서 확인한다 — 어기면 생성이 실패한다.
 *   · 탭의 Z-닫힘변(= 경첩)은 어떤 .cutline 선분과도 같으면 안 된다
 *   · 경첩에는 반드시 .foldline 이 있어야 한다
 *   · 탭의 나머지 변은 모두 .cutline 위에 있어야 한다
 * ======================================================================== */
function auditTabs(svg) {
  const num = '(-?[\\d.]+)';
  const ptsOf = (d) => {
    const out = [];
    const re = new RegExp(`[ML]\\s*${num}\\s*,\\s*${num}`, 'g');
    let m;
    while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    return out;
  };
  const key = (a, b) => {
    const r = (v) => Math.round(v * 100) / 100;
    const p = [[r(a[0]), r(a[1])], [r(b[0]), r(b[1])]].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    return JSON.stringify(p);
  };
  const edges = (d) => {
    const p = ptsOf(d), out = [];
    for (let i = 0; i < p.length - 1; i++) out.push([p[i], p[i + 1]]);
    if (/Z\s*$/.test(d.trim()) && p.length > 2) out.push([p[p.length - 1], p[0]]);
    return out;
  };

  const cut = new Set(), fold = new Set();
  let m;
  const cutPath = /<path class="cutline" d="([^"]+)"/g;
  while ((m = cutPath.exec(svg))) edges(m[1]).forEach((e) => cut.add(key(e[0], e[1])));
  const cutRect = new RegExp(`<rect class="cutline"[^>]*x="${num}" y="${num}" width="${num}" height="${num}"`, 'g');
  while ((m = cutRect.exec(svg))) {
    const [x, y, w, h] = m.slice(1).map(parseFloat);
    [[[x, y], [x + w, y]], [[x + w, y], [x + w, y + h]],
     [[x + w, y + h], [x, y + h]], [[x, y + h], [x, y]]].forEach((e) => cut.add(key(e[0], e[1])));
  }
  const foldLine = new RegExp(`<line class="foldline" x1="${num}" y1="${num}" x2="${num}" y2="${num}"`, 'g');
  while ((m = foldLine.exec(svg))) {
    const [x1, y1, x2, y2] = m.slice(1).map(parseFloat);
    fold.add(key([x1, y1], [x2, y2]));
  }

  const problems = [];
  let n = 0;
  const tabPath = /<path class="tab" d="([^"]+)"/g;
  while ((m = tabPath.exec(svg))) {
    n++;
    const e = edges(m[1]);
    const hinge = key(e[e.length - 1][0], e[e.length - 1][1]);
    if (cut.has(hinge)) problems.push(`탭 ${n}: 경첩이 자르기선이다 ${hinge}`);
    if (!fold.has(hinge)) problems.push(`탭 ${n}: 경첩에 접는 선이 없다 ${hinge}`);
    e.slice(0, -1).forEach((o) => {
      if (!cut.has(key(o[0], o[1]))) problems.push(`탭 ${n}: 바깥 변이 잘리지 않는다 ${key(o[0], o[1])}`);
    });
  }
  return { count: n, problems };
}

/* ── HTML ───────────────────────────────────────────────────────────────── */
const HEAD = (page, sub) => `
  <header class="print-head">
    <div class="ph-brand"><img class="ph-mascot" src="../../../../img/mascot.png" alt="몽당분필 날쌤"
      onerror="this.style.display='none'">
      <div class="ph-brandname">몽당분필 날쌤<small>초등사회 교육콘텐츠 클라우드</small></div>
    </div>
    <div class="ph-main">
      <div class="ph-title">탁자식 고인돌 만들기</div>
      <div class="ph-sub">${sub}</div>
      <div class="ph-chips">
        <span class="chip">5학년 2학기 · 1단원 1차시</span>
        <span class="chip">유적과 유물로 살펴본 옛사람들의 생활</span>
        <span class="chip dim">A4 ${page} / 3쪽</span>
      </div>
    </div>
    <div class="name-date">모둠 <span class="nd-line"></span><br>이름 <span class="nd-line"></span></div>
  </header>`;


const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>탁자식 고인돌 만들기 — 페이퍼크래프트 도안 (5-2 1단원 1차시)</title>
<meta name="description" content="오려·접어·붙여 세우는 탁자식 고인돌 — 굄돌 셋과 덮개돌, 그리고 거대한 돌을 올린 네 단계를 손으로 재현하는 도안 (A4 3쪽, 몽당분필 날쌤)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../../../templates/print/print-base.css?v=1">
<style>
/* ── 1차시 전용 (탁자식 고인돌 페이퍼크래프트) ── */
.abs { position: absolute; }
.ph-brand { display: flex; align-items: center; gap: 2.5mm; }
.ph-brand .ph-mascot { display: block; height: 15mm; width: auto; }
.sheet { display: block; }
.rowcap     { font-size: 3.6px; font-weight: 700; fill: #8b9593; }
.legendlab  { font-size: 3.6px; font-weight: 700; fill: #5d6874; }
.legendlab2 { font-size: 3.2px; font-weight: 700; fill: #b08a1a; }

/* 전개도 선 규약 — SVG 1 단위 = 1mm 이므로 굵기도 mm 값으로 직접 지정 */
.cutline   { stroke: #111; stroke-width: 0.6; fill: none; stroke-linecap: square; }
.foldline  { stroke: #6a7a90; stroke-width: 0.32; fill: none; stroke-dasharray: 2.6 1.7; }
.tab       { fill: url(#glue); stroke: none; }

/* 돌·나무·흙 면 */
.stone      { fill: #dfe2e0; stroke: none; }
.stonetop   { fill: #eceeec; stroke: none; }
.stoneside  { fill: #cfd4d2; stroke: none; }
.grain      { fill: none; stroke: #b9c0bd; stroke-width: 0.28; }
.wood       { fill: #e6d4b8; stroke: none; }
.woodgrain  { stroke: #c9ae84; stroke-width: 0.3; }
.soil       { fill: #e3d2bb; stroke: none; }
.soilgrain  { stroke: #c9b495; stroke-width: 0.3; }
.ground     { fill: #eef3e8; stroke: none; }
.turf       { fill: none; stroke: #a9c195; stroke-width: 0.32; }
.capshadow  { fill: none; stroke: #9aa5ad; stroke-width: 0.4; stroke-dasharray: 3.2 2; }
.footprint  { fill: #fff; stroke: #8fa3b5; stroke-width: 0.4; stroke-dasharray: 2.4 1.6; }

/* 글자 */
.facelab    { font-size: 4.4px; font-weight: 700; fill: #6e7a79; }
.facelab2   { font-size: 3.1px; font-weight: 700; fill: #8b9593;
              paint-order: stroke fill; stroke: #fff; stroke-width: 1.0; stroke-linejoin: round; }
.platetitle { font-size: 5.4px; font-weight: 900; fill: #4e6b45; }
.fplab      { font-size: 3.4px; font-weight: 700; fill: #6f8299; }
.fplab2     { font-size: 3.0px; fill: #94a3b4; }
.card       { fill: #fffdf4; stroke: none; }
/* 완성 모습(사투상) */
.ground3d   { fill: #eef3e8; stroke: #cfdcc4; stroke-width: 0.4; }
.f3         { fill: #d7dbd9; stroke: #9aa29f; stroke-width: 0.4; }
.t3         { fill: #eceeec; stroke: #9aa29f; stroke-width: 0.4; }
.s3         { fill: #c3c9c6; stroke: #9aa29f; stroke-width: 0.4; }
.fcap       { fill: #cfd4d2; stroke: #7c8784; stroke-width: 0.5; }
.tcap       { fill: #e8ebe9; stroke: #7c8784; stroke-width: 0.5; }
.scap       { fill: #b9c1be; stroke: #7c8784; stroke-width: 0.5; }
.lead       { stroke: #c8931d; stroke-width: 0.3; }
.leaddot    { fill: #c8931d; }
.leadlab    { font-size: 4px; font-weight: 700; fill: #a5760a; }
.cardbig    { font-size: 9px; font-weight: 900; fill: #c8931d; }
.cardsub    { font-size: 3.5px; font-weight: 700; fill: #4a4a4a; }

/* 안내 박스 */
.usage {
  border: 0.5mm solid var(--blue-print); border-radius: 3mm; background: #f7faff;
  padding: 2.6mm 3.2mm; font-size: 7.6pt; line-height: 1.6;
}
.usage h4 { font-size: 9.5pt; font-weight: 900; color: var(--blue-print); margin-bottom: 1mm; }
.usage b { color: var(--blue-print); }
.materials {
  border: 0.45mm dashed #999; border-radius: 3mm; padding: 2mm 3mm;
  font-size: 7.4pt; line-height: 1.58; background: #fafafa;
}
.ask {
  border: 0.5mm solid var(--gold-print); border-radius: 3mm; background: #fffdf5;
  padding: 2.6mm 3.2mm; font-size: 7.8pt; line-height: 1.62;
}
.ask h4 { font-size: 9.5pt; font-weight: 900; color: var(--gold-print); margin-bottom: 1mm; }
.ask b { color: var(--gold-print); }
</style>
</head>
<body>

<!-- 문서 전체에서 쓰는 빗금(=풀칠) 패턴 -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <defs>
    <pattern id="glue" patternUnits="userSpaceOnUse" width="1.8" height="1.8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="1.8" stroke="#98a3b0" stroke-width="0.32"/>
    </pattern>
    <pattern id="glueLg" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="#98a3b0" stroke-width="1"/>
    </pattern>
  </defs>
</svg>

<div class="print-toolbar no-print">
  <span class="tb-title">✂️ 탁자식 고인돌 만들기 — 1단원 1차시 페이퍼크래프트</span>
  <button onclick="window.print()">인쇄 / PDF 저장</button>
  <a class="ghost" href="../">← 1차시 수업 꾸러미</a>
  <a class="ghost" href="../../../../">자료실</a>
  <p class="print-tip">A4 · <b>실제 크기(100%)</b>로 인쇄하세요. '페이지에 맞추기'를 켜면 조각 크기가 서로 맞지 않습니다. 180g 이상 두꺼운 종이를 권합니다.</p>
</div>

<!-- ───────────────────────── 1쪽 : 돌 조각 ───────────────────────── -->
<section class="a4-page"><div class="pc">
${HEAD(1, '굄돌 셋과 덮개돌 — 오려서 상자처럼 접어 세웁니다')}

  <svg class="sheet" viewBox="0 0 190 ${P1_BOTTOM}" width="190mm" height="${P1_BOTTOM}mm">
    ${P1.join('\n    ')}
  </svg>

  <footer class="print-foot">
    <span>몽당분필 날쌤 · 초등사회 교육콘텐츠 클라우드 — 5학년 2학기 1단원 1차시</span>
    <span>탁자식 고인돌 페이퍼크래프트 · 1 / 3</span>
  </footer>
</div></section>

<!-- ───────────────── 2쪽 : 받침판 · 통나무 · 흙 경사로 · 순서 카드 ───────────────── -->
<section class="a4-page"><div class="pc">
${HEAD(2, '받침판과 통나무 — 거대한 돌을 어떻게 올렸는지 손으로 해 봅니다')}

  <svg class="sheet" viewBox="0 0 190 ${P2_BOTTOM}" width="190mm" height="${P2_BOTTOM}mm">
    ${P2.join('\n    ')}
  </svg>

  <footer class="print-foot">
    <span>몽당분필 날쌤 · 초등사회 교육콘텐츠 클라우드 — 5학년 2학기 1단원 1차시</span>
    <span>탁자식 고인돌 페이퍼크래프트 · 2 / 3</span>
  </footer>
</div></section>

<!-- ───────────────────────── 3쪽 : 만드는 법과 생각할 거리 ───────────────────────── -->
<section class="a4-page"><div class="pc">
${HEAD(3, '만드는 순서와, 만들고 나서 이야기할 것')}

  <div class="abs materials" style="left:0; top:30mm; width:190mm;">
    <b>준비물</b> &nbsp;가위 · 풀 · (있으면) 자와 다 쓴 볼펜 — 접는 선을 볼펜으로 한 번 눌러 두면 훨씬 반듯하게 접힙니다.
    &nbsp;<b>더 튼튼하게!</b> 얇은 종이라면 오리기 전에 도안을 마분지(과자 상자도 좋아요)에 붙였다가 함께 오리세요. 받침판과 순서 카드는 접지 않고 오리기만 합니다.
  </div>

  <div class="abs usage" style="left:0; top:48mm; width:190mm;">
    <h4>만드는 순서</h4>
    <b>①</b> 1쪽의 네 조각(덮개돌 · 굄돌 ㉮ · 굄돌 ㉯ · 막음돌)을 <b>실선</b>만 따라 오립니다.<br>
    <b>②</b> <b>점선</b>을 모두 접습니다. 굄돌·막음돌은 네 면을 둘러 기둥을 만들고, 오른쪽 빗금 탭에 풀을 칠해 처음 면 안쪽에 붙입니다. 밑면은 열어 둡니다.<br>
    <b>③</b> 덮개돌은 윗면을 가운데 두고 네 옆면을 아래로 접은 뒤, 좌·우 옆면에 달린 빗금 탭을 앞·뒤 옆면 <b>안쪽</b>에 붙입니다. 뚜껑처럼 아래가 열린 납작한 상자가 됩니다.<br>
    <b>④</b> 2쪽 받침판의 점선 자리에 굄돌 ㉮·㉯와 막음돌을 세우고, 그 위에 덮개돌을 <b>얹기만</b> 합니다. 붙이지 않아야 몇 번이고 다시 올려 볼 수 있습니다.<br>
    <b>⑤</b> 통나무 셋은 둥글게 말아 빗금 탭을 붙이고, 흙 경사로 둘은 밑에 달린 빗금 발을 뒤로 접어 세웁니다.
    <span style="color:#777">(시간이 모자라면 ①~② 를 집에서 미리 오려 와도 좋고, 모둠에서 조각을 나누어 만들어도 됩니다.)</span>
  </div>

  <div class="abs" style="left:0; top:100mm; width:190mm; text-align:center;">
    <svg viewBox="0 0 190 80" width="150mm" height="63mm">
      ${assembled()}
    </svg>
    <div style="font-size:8pt; font-weight:700; color:#6e7a79; margin-top:0.5mm;">
      완성한 모습 — 굄돌 ㉮·㉯ 와 막음돌 셋 위에 덮개돌을 <b style="color:#c8931d">얹기만</b> 합니다
    </div>
  </div>

  <div class="abs ask" style="left:0; top:174mm; width:190mm;">
    <h4>해 보기 — 이 거대한 돌을 어떻게 올렸을까?</h4>
    순서 카드 ①~④를 섞어 놓고, 받침판·통나무·흙 경사로를 직접 움직이며 <b>차례를 맞혀 보세요.</b>
    맞혀 본 다음에 카드를 뒤집어 확인하지 말고, <b>왜 그 순서라고 생각했는지 근거를 먼저 말해 봅니다.</b><br>
    <b>①</b> 통나무 셋을 나란히 놓고 그 위에 덮개돌을 <b>얹어</b> 살짝 밀어 보세요 — 무엇이 쉬워질까요? &nbsp;<b>②</b> 흙 경사로는 왜 필요했을까요?
    &nbsp;<b>③</b> 흙은 마지막에 왜 치웠을까요?<br>
    <span style="color:#777">※ 교과서 6〕7쪽 발문 「어떻게 만들었을까요?」의 예시 답에도 <b>「동그란 무언가를 바퀴로 활용하여」</b>가 나옵니다. 통나무가 바로 그것입니다.<br>※ 카드의 순서는 고인돌을 세운 방법으로 널리 받아들여지는 설명입니다. 직접 해 보고 나서 모둠의 생각과 비교해 보세요.</span>
  </div>

  <div class="abs usage" style="left:0; top:216mm; width:190mm;">
    <h4>만들고 나서 — 돌에게 묻기</h4>
    <b>①</b> 다 만든 고인돌을 보면, 이 돌을 옮기고 세우는 데 <b>몇 사람</b>이 필요했을 것 같나요? 그렇게 생각한 근거는 무엇인가요?<br>
    <b>②</b> 그만큼 많은 사람을 불러 모을 수 있었던 사람은 마을에서 <b>어떤 사람</b>이었을까요?<br>
    <b>③</b> 고인돌은 옛사람의 <b>무덤</b>입니다. 무덤을 이렇게 크게 만든 까닭을 짝과 이야기해 보세요.<br>
    <span style="color:#777">※ 눈에 보이는 것(관찰)과 그것을 근거로 짐작한 것(추론)을 구분해서 말해 보는 것이 이 시간의 핵심입니다.</span>
  </div>

  <div class="abs" style="left:0; top:258mm; width:190mm; text-align:center;">
    <div style="font-size:8pt; color:#666; line-height:1.7;">
      이 도안은 <b>초등사회 교육콘텐츠 클라우드 @nalssam</b> 의 1단원 1차시 수업 꾸러미에 들어 있습니다.<br>
      같은 차시의 <b>비주얼싱킹 학습지 「유물 탐정 수첩」</b> 과 함께 쓰면 좋습니다.
    </div>
  </div>

  <footer class="print-foot">
    <span>몽당분필 날쌤 · 초등사회 교육콘텐츠 클라우드 — 5학년 2학기 1단원 1차시</span>
    <span>만드는 법 · 3 / 3</span>
  </footer>
</div></section>

</body>
</html>
`;

const audit = auditTabs(html);
console.log(`풀칠 탭 ${audit.count}개 · 규약 위반 ${audit.problems.length}건`);
if (audit.problems.length) {
  audit.problems.forEach((x) => console.error('  \u2716 ' + x));
  console.error('\u2716 탭 규약 위반 — 이대로 인쇄하면 아이가 탭을 오려 버린다. 생성을 중단한다.');
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`→ ${OUT}  (${html.length.toLocaleString()} bytes)`);
