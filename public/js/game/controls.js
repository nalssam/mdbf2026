// 입력 컨트롤: 가상 조이스틱(터치) + 카메라 드래그 + 키보드(WASD/스페이스) + 액션 버튼
// 태블릿(멀티터치)과 데스크톱(마우스+키보드)을 모두 지원한다.
export function createControls({ canvas, joystickEl, knobEl, jumpBtn, actionBtn, callbacks }) {
  const cb = Object.assign({ move() {}, jump() {}, drag() {}, tap() {}, action() {}, slot() {} }, callbacks);

  // ---------- 가상 조이스틱 ----------
  let joyPointer = null;
  let joyCenter = { x: 0, y: 0 };
  const JOY_RADIUS = 52;

  function joyUpdate(clientX, clientY) {
    let dx = clientX - joyCenter.x;
    let dy = clientY - joyCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    // 위로 밀면 전진(+y), 오른쪽 +x
    const nx = dx / JOY_RADIUS;
    const ny = -dy / JOY_RADIUS;
    const dead = 0.12;
    cb.move(Math.abs(nx) < dead ? 0 : nx, Math.abs(ny) < dead ? 0 : ny);
  }
  function joyEnd() {
    joyPointer = null;
    knobEl.style.transform = 'translate(0,0)';
    cb.move(0, 0);
  }
  joystickEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (joyPointer !== null) return; // 두 번째 손가락이 스틱을 빼앗지 못하게 한다
    joyPointer = e.pointerId;
    const rect = joystickEl.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joystickEl.setPointerCapture(e.pointerId);
    joyUpdate(e.clientX, e.clientY);
  });
  joystickEl.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyPointer) { e.preventDefault(); joyUpdate(e.clientX, e.clientY); }
  });
  joystickEl.addEventListener('pointerup', (e) => { if (e.pointerId === joyPointer) joyEnd(); });
  joystickEl.addEventListener('pointercancel', (e) => { if (e.pointerId === joyPointer) joyEnd(); });
  joystickEl.addEventListener('lostpointercapture', (e) => { if (e.pointerId === joyPointer) joyEnd(); });

  // ---------- 카메라 드래그 / 월드 탭 ----------
  // 조이스틱이 아닌 첫 손가락(또는 마우스)만 카메라를 조작한다:
  //  - 7px 이상 움직이면 카메라 회전, 그대로 떼면 탭(도구 사용)
  //  - 나머지 손가락은 무시해 두 손가락 제스처의 카메라 튐/이중 탭을 막는다
  let camPointer = null;
  let camState = null; // {x, y, sx, sy, moved}
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (camPointer !== null) return;
    camPointer = e.pointerId;
    camState = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== camPointer || !camState) return;
    // 창 밖에서 마우스 버튼을 뗀 걸 놓친 경우 즉시 종료
    if (e.pointerType === 'mouse' && e.buttons === 0) { camPointer = null; camState = null; return; }
    const dx = e.clientX - camState.x;
    const dy = e.clientY - camState.y;
    camState.x = e.clientX; camState.y = e.clientY;
    if (!camState.moved && Math.hypot(e.clientX - camState.sx, e.clientY - camState.sy) > 7) camState.moved = true;
    if (camState.moved) cb.drag(dx, dy);
  });
  function endDrag(e) {
    if (e.pointerId !== camPointer) return;
    const wasTap = camState && !camState.moved && e.type === 'pointerup';
    camPointer = null;
    camState = null;
    if (wasTap) cb.tap(e.clientX, e.clientY);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', (e) => { if (e.pointerId === camPointer) { camPointer = null; camState = null; } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 버튼 ----------
  function bindButton(el, fn) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }
  bindButton(jumpBtn, () => cb.jump());
  bindButton(actionBtn, () => cb.action());

  // ---------- 키보드 ----------
  const keys = new Set();
  let enabled = true;
  function updateKeyMove() {
    let x = 0, y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y) || 1;
    cb.move(x / len, y / len);
  }
  addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) cb.jump();
      return;
    }
    if (/^Digit[1-4]$/.test(e.code)) { cb.slot(Number(e.code.slice(5)) - 1); return; }
    if (e.code === 'KeyF' && !e.repeat) { cb.action(); return; }
    keys.add(e.code);
    updateKeyMove();
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (enabled) updateKeyMove();
  });
  addEventListener('blur', () => {
    keys.clear();
    camPointer = null; camState = null;
    cb.move(0, 0);
  });

  return {
    setEnabled(v) {
      enabled = v;
      if (!v) {
        keys.clear();
        joyEnd();
        camPointer = null; camState = null;
        cb.move(0, 0);
      }
    },
  };
}
