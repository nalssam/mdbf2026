// BlockQuest 3D 월드 엔진 — three.js 기반 복셀 아레나
// 커스텀 AABB 물리(중력/점프/이중점프), 블록 파괴·설치, 폭탄/발사체,
// 아이템, 퀴즈 블록, 원격 플레이어 렌더링을 담당한다.
import * as THREE from 'three';

// ---------- 상수 ----------
export const BLOCK_TYPES = {
  grass: { color: 0x6fbf44, breakable: false },
  dirt: { color: 0x8a5a2b, breakable: false },
  stone: { color: 0x8f8f8f, breakable: false },
  plank: { color: 0xb8945f, breakable: true },
  brick: { color: 0xc0563e, breakable: true },
  wood: { color: 0x6b4423, breakable: true },
  leaf: { color: 0x57a531, breakable: true },
  crate: { color: 0xd9a520, breakable: true },
};
const PLAYER = { HX: 0.3, HEIGHT: 1.8, SPEED: 6, JUMP_V: 10.5, GRAVITY: 28, MAX_FALL: 30 };
const WORLD_R = 23; // 아레나 반경 (블록)

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const keyOf = (x, y, z) => `${x},${y},${z}`;
const parseKey = (k) => k.split(',').map(Number);

// ---------- 텍스트 스프라이트 ----------
function makeTextSprite(text, { size = 26, color = '#fff', bg = 'rgba(0,0,0,0.45)' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `bold ${size}px sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 22;
  c.width = w; c.height = size + 18;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = bg;
  ctx2.fillRect(0, 0, c.width, c.height);
  ctx2.font = `bold ${size}px sans-serif`;
  ctx2.fillStyle = color;
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  ctx2.fillText(text, c.width / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(c.width / 90, c.height / 90, 1);
  return sprite;
}

// ---------- 캐릭터 (로블록스풍 블록 인간) ----------
const SHIRT_COLORS = {
  creeper: 0x3f7d20, steve: 0x2c9c9c, pig: 0xd97b7b, zombie: 0x3a5f8a,
  skeleton: 0x666666, fox: 0xde7c30, robot: 0x5a6470, ender: 0x6a3a9c,
};
function avatarFaceTexture(avatarKey) {
  const av = (window.BQ && BQ.AVATARS[avatarKey]) || null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (av) {
    ctx.imageSmoothingEnabled = false;
    const cell = 8;
    for (let y = 0; y < 8; y++) {
      const row = av.grid[y] || '';
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = av.pal[row[x]] || Object.values(av.pal)[0];
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  } else {
    ctx.fillStyle = '#e8b08c'; ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCharacter(avatarKey, name) {
  const g = new THREE.Group();
  const shirt = SHIRT_COLORS[avatarKey] || 0x2c9c9c;
  const av = (window.BQ && BQ.AVATARS[avatarKey]) || null;
  const headColorHex = av ? Object.values(av.pal)[0] : '#e8b08c';
  const headColor = new THREE.Color(headColorHex);
  const skin = new THREE.MeshLambertMaterial({ color: headColor });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x39424e });
  const faceMat = new THREE.MeshLambertMaterial({ map: avatarFaceTexture(avatarKey) });

  // 머리: 앞면만 아바타 얼굴 텍스처
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52),
    [skin, skin, skin, skin, faceMat, skin]); // +x,-x,+y,-y,+z(front),-z
  head.position.y = 1.48;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.34), shirtMat);
  torso.position.y = 0.92;
  const mkLimb = (mat, w) => new THREE.Mesh(new THREE.BoxGeometry(w, 0.56, 0.24), mat);
  const armL = mkLimb(shirtMat, 0.2); const armR = mkLimb(shirtMat, 0.2);
  const legL = mkLimb(pantsMat, 0.24); const legR = mkLimb(pantsMat, 0.24);
  // 팔다리 피벗을 상단으로 (스윙 애니메이션용)
  for (const limb of [armL, armR, legL, legR]) limb.geometry.translate(0, -0.28, 0);
  armL.position.set(-0.42, 1.2, 0); armR.position.set(0.42, 1.2, 0);
  legL.position.set(-0.16, 0.6, 0); legR.position.set(0.16, 0.6, 0);

  const tag = makeTextSprite(name, { size: 24 });
  tag.position.y = 2.15;

  // 발밑 그림자 (가짜 블롭)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;

  g.add(head, torso, armL, armR, legL, legR, tag, shadow);
  g.userData = { armL, armR, legL, legR, phase: 0 };
  return g;
}

function animateCharacter(g, moving, dt) {
  const u = g.userData;
  u.phase = moving ? u.phase + dt * 9 : u.phase * 0.8;
  const swing = Math.sin(u.phase) * (moving ? 0.7 : 0.05);
  u.armL.rotation.x = swing; u.armR.rotation.x = -swing;
  u.legL.rotation.x = -swing; u.legR.rotation.x = swing;
}

// ---------- 엔진 본체 ----------
export function createEngine({ canvas, classSeed, avatarKey, playerName }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b7f2);
  scene.fog = new THREE.Fog(0x87b7f2, 42, 90);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x6a5335, 1.05));
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
  sun.position.set(18, 30, 12);
  scene.add(sun);

  // 구름 (장식)
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 8; i++) {
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(4 + (i % 3) * 2, 0.6, 2.4), cloudMat);
    cloud.position.set((i * 13 % 60) - 30, 22 + (i % 4) * 2, ((i * 23) % 60) - 30);
    scene.add(cloud);
  }

  // ---------- 복셀 월드 ----------
  const blocks = new Map(); // key → type
  const rnd = mulberry32(classSeed);

  function setBlock(x, y, z, type) { blocks.set(keyOf(x, y, z), type); }

  function generateWorld() {
    // 바닥: 잔디 + 흙 테두리 절벽
    for (let x = -WORLD_R; x <= WORLD_R; x++) {
      for (let z = -WORLD_R; z <= WORLD_R; z++) {
        setBlock(x, 0, z, 'grass');
        if (Math.abs(x) === WORLD_R || Math.abs(z) === WORLD_R) {
          setBlock(x, 1, z, 'stone'); setBlock(x, 2, z, 'stone'); // 외곽 벽
        }
      }
    }
    // 나무
    for (let i = 0; i < 7; i++) {
      const tx = Math.floor(rnd() * 34 - 17), tz = Math.floor(rnd() * 34 - 17);
      if (Math.abs(tx) < 4 && Math.abs(tz) < 4) continue;
      const h = 3 + Math.floor(rnd() * 2);
      for (let y = 1; y <= h; y++) setBlock(tx, y, tz, 'wood');
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
        if (dy === 1 && (dx !== 0 || dz !== 0)) continue;
        setBlock(tx + dx, h + dy + 1, tz + dz, 'leaf');
      }
    }
    // 벽돌 유적 (부술 수 있는 벽)
    for (let i = 0; i < 4; i++) {
      const bx = Math.floor(rnd() * 28 - 14), bz = Math.floor(rnd() * 28 - 14);
      if (Math.abs(bx) < 5 && Math.abs(bz) < 5) continue;
      const w = 3 + Math.floor(rnd() * 2);
      for (let dx = 0; dx < w; dx++) for (let dy = 1; dy <= 2; dy++) {
        if (dx === Math.floor(w / 2) && dy === 1) continue; // 출입구
        setBlock(bx + dx, dy, bz, 'brick');
      }
    }
    // 점프 코스: 떠 있는 판자 발판 (나선 상승)
    let px = 6, pz = 6, py = 2;
    for (let i = 0; i < 9; i++) {
      setBlock(px, py, pz, 'plank');
      if (i % 2 === 1) setBlock(px + 1, py, pz, 'plank');
      const ang = i * 0.8;
      px += Math.round(Math.cos(ang) * 3);
      pz += Math.round(Math.sin(ang) * 3);
      px = Math.max(-18, Math.min(18, px)); pz = Math.max(-18, Math.min(18, pz));
      py += 1;
    }
    // 아이템 상자
    for (let i = 0; i < 8; i++) {
      const cx = Math.floor(rnd() * 32 - 16), cz = Math.floor(rnd() * 32 - 16);
      if (blocks.has(keyOf(cx, 1, cz))) continue;
      setBlock(cx, 1, cz, 'crate');
    }
    // 돌기둥
    for (let i = 0; i < 3; i++) {
      const sx = Math.floor(rnd() * 30 - 15), sz = Math.floor(rnd() * 30 - 15);
      if (Math.abs(sx) < 3 && Math.abs(sz) < 3) continue;
      const h = 2 + Math.floor(rnd() * 3);
      for (let y = 1; y <= h; y++) setBlock(sx, y, sz, 'stone');
    }
  }
  generateWorld();

  // ---------- 인스턴스 렌더링 ----------
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const edgeTint = {}; // 타입별 인스턴스 메시
  const instanceKeys = {}; // type → [key,...] (instanceId 매핑)
  const dummy = new THREE.Object3D();

  function rebuildType(type) {
    if (edgeTint[type]) { scene.remove(edgeTint[type]); edgeTint[type].dispose(); }
    const keys = [];
    for (const [k, t] of blocks) if (t === type) keys.push(k);
    instanceKeys[type] = keys;
    const mat = new THREE.MeshLambertMaterial({ color: BLOCK_TYPES[type].color });
    const mesh = new THREE.InstancedMesh(blockGeo, mat, Math.max(keys.length, 1));
    mesh.count = keys.length;
    keys.forEach((k, i) => {
      const [x, y, z] = parseKey(k);
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.blockType = type;
    edgeTint[type] = mesh;
    scene.add(mesh);
  }
  const dirtyTypes = new Set();
  function markDirty(type) { dirtyTypes.add(type); }
  function flushDirty() {
    for (const t of dirtyTypes) rebuildType(t);
    dirtyTypes.clear();
  }
  for (const t of Object.keys(BLOCK_TYPES)) rebuildType(t);

  // ---------- 월드 조작 ----------
  const listeners = { blockBroken: [], itemPickup: [], quizTouch: [] };
  function on(evt, cb) { listeners[evt].push(cb); }
  function emit(evt, ...args) { for (const cb of listeners[evt]) cb(...args); }

  function removeBlock(key, { silent } = {}) {
    const type = blocks.get(key);
    if (!type) return null;
    blocks.delete(key);
    markDirty(type);
    if (!silent) {
      const [x, y, z] = parseKey(key);
      burst(new THREE.Vector3(x, y, z), BLOCK_TYPES[type].color, 14);
    }
    return type;
  }
  function placeBlock(key, type) {
    if (blocks.has(key) || !BLOCK_TYPES[type]) return false;
    blocks.set(key, type);
    markDirty(type);
    return true;
  }
  function applyDiffs(diffs) {
    for (const [key, d] of Object.entries(diffs || {})) {
      if (d.removed) {
        const t = blocks.get(key);
        if (t && BLOCK_TYPES[t].breakable) { blocks.delete(key); markDirty(t); }
      } else if (d.type && BLOCK_TYPES[d.type]) {
        const existing = blocks.get(key);
        if (existing === d.type) continue;
        // 원래 있던 블록이 파괴 가능했다면 "부순 뒤 설치"가 하나의 diff로 합쳐진 것 — 교체한다
        if (existing && !BLOCK_TYPES[existing].breakable) continue;
        if (existing) { blocks.delete(key); markDirty(existing); }
        blocks.set(key, d.type);
        markDirty(d.type);
      }
    }
    flushDirty();
  }

  // ---------- 물리 ----------
  const solid = (x, y, z) => blocks.has(keyOf(x, y, z));
  function aabbSolid(px, py, pz) {
    const e = 0.001;
    const x0 = Math.ceil(px - PLAYER.HX - 0.5 + e), x1 = Math.floor(px + PLAYER.HX + 0.5 - e);
    const y0 = Math.ceil(py - 0.5 + e), y1 = Math.floor(py + PLAYER.HEIGHT + 0.5 - e);
    const z0 = Math.ceil(pz - PLAYER.HX - 0.5 + e), z1 = Math.floor(pz + PLAYER.HX + 0.5 - e);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (solid(x, y, z)) return true;
    }
    return false;
  }

  const player = {
    pos: new THREE.Vector3(0, 3, 2),
    vel: new THREE.Vector3(),
    yaw: 0,
    grounded: false,
    jumpsUsed: 0,
    coyote: 0,
    speedBoostUntil: 0,
    moving: false,
  };
  const mesh = buildCharacter(avatarKey, playerName);
  scene.add(mesh);

  const input = { move: new THREE.Vector2(), jumpQueued: false };
  function setMove(x, y) { input.move.set(x, y); }
  function jump() { input.jumpQueued = true; }

  const cam = { yaw: Math.PI, pitch: 0.42, dist: 7.5 };
  function rotateCamera(dx, dy) {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(-0.15, Math.min(1.25, cam.pitch + dy * 0.005));
  }

  function respawn() {
    player.pos.set(0, 3, 2);
    player.vel.set(0, 0, 0);
  }

  function physicsStep(dt) {
    const now = performance.now();
    // 끼임 탈출: 다른 플레이어가 내 위치에 블록을 설치하는 등으로 몸이 블록에 묻히면 위로 밀어낸다
    if (aabbSolid(player.pos.x, player.pos.y, player.pos.z)) {
      let freed = false;
      for (let up = 1; up <= 6; up++) {
        if (!aabbSolid(player.pos.x, player.pos.y + up, player.pos.z)) {
          player.pos.y += up;
          player.vel.set(0, 0, 0);
          freed = true;
          break;
        }
      }
      if (!freed) respawn();
    }
    const speed = now < player.speedBoostUntil ? PLAYER.SPEED * 1.9 : PLAYER.SPEED;
    // 카메라 기준 이동 방향
    const mv = input.move;
    let dx = 0, dz = 0;
    if (mv.lengthSq() > 0.01) {
      const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
      dx = (mv.x * cos - mv.y * sin) * speed;
      dz = (-mv.x * sin - mv.y * cos) * speed;
      player.yaw = Math.atan2(dx, dz);
      player.moving = true;
    } else {
      player.moving = false;
    }
    player.vel.x = dx; player.vel.z = dz;
    player.vel.y = Math.max(player.vel.y - PLAYER.GRAVITY * dt, -PLAYER.MAX_FALL);

    if (input.jumpQueued) {
      input.jumpQueued = false;
      const canGround = player.grounded || player.coyote > 0;
      if (canGround) {
        player.vel.y = PLAYER.JUMP_V;
        player.jumpsUsed = 1;
        player.coyote = 0;
      } else if (player.jumpsUsed < 2) {
        player.vel.y = PLAYER.JUMP_V * 0.92; // 이중 점프
        player.jumpsUsed = 2;
        burst(player.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xffffff, 10, 0.12);
        if (window.BQ) BQ.sound('click');
      }
    }

    // 서브스텝으로 터널링 방지
    const maxDisp = Math.max(Math.abs(player.vel.x), Math.abs(player.vel.y), Math.abs(player.vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxDisp / 0.35));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      // X
      let nx = player.pos.x + player.vel.x * sdt;
      if (aabbSolid(nx, player.pos.y, player.pos.z)) { nx = player.pos.x; player.vel.x = 0; }
      player.pos.x = nx;
      // Z
      let nz = player.pos.z + player.vel.z * sdt;
      if (aabbSolid(player.pos.x, player.pos.y, nz)) { nz = player.pos.z; player.vel.z = 0; }
      player.pos.z = nz;
      // Y — 충돌 시 블록 표면에 스냅해 착지가 붕 뜨지 않게 한다
      let ny = player.pos.y + player.vel.y * sdt;
      if (aabbSolid(player.pos.x, ny, player.pos.z)) {
        if (player.vel.y < 0) {
          const cy = Math.ceil(ny - 0.5 + 0.001); // 발밑 충돌 셀
          const snapped = cy + 0.5;
          if (!aabbSolid(player.pos.x, snapped, player.pos.z)) player.pos.y = snapped;
          player.grounded = true; player.jumpsUsed = 0; player.coyote = 0.12;
        } else if (player.vel.y > 0) {
          const cy = Math.floor(ny + PLAYER.HEIGHT + 0.5 - 0.001); // 머리 위 충돌 셀
          const snapped = cy - 0.5 - PLAYER.HEIGHT;
          if (!aabbSolid(player.pos.x, snapped, player.pos.z)) player.pos.y = snapped;
        }
        player.vel.y = 0;
      } else {
        player.pos.y = ny;
      }
    }
    // 접지 판정 (아래로 살짝 밀어보기)
    player.grounded = aabbSolid(player.pos.x, player.pos.y - 0.05, player.pos.z) && player.vel.y <= 0;
    if (player.grounded) {
      player.jumpsUsed = 0;
      player.coyote = 0.12;
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
    }

    if (player.pos.y < -25) respawn();

    mesh.position.copy(player.pos);
    mesh.rotation.y = player.yaw;
    animateCharacter(mesh, player.moving, dt);

    // 부츠 파티클
    if (now < player.speedBoostUntil && player.moving && Math.random() < 0.5) {
      burst(player.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), 0x80e61d, 1, 0.08);
    }
  }

  function updateCamera(dt) {
    const target = player.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = new THREE.Vector3(
      Math.sin(cam.yaw) * Math.cos(cam.pitch),
      Math.sin(cam.pitch),
      Math.cos(cam.yaw) * Math.cos(cam.pitch)
    );
    // 카메라가 지형에 파묻히지 않도록 DDA로 거리 클램프 (장애물보다 멀어지면 안 된다)
    let dist = cam.dist;
    const hit = raycastVoxel(target, dir, cam.dist);
    if (hit) dist = Math.max(0.4, Math.min(cam.dist, hit.dist - 0.45));
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
  }

  // ---------- DDA 복셀 레이캐스트 ----------
  function raycastVoxel(origin, dir, maxDist) {
    let x = Math.round(origin.x), y = Math.round(origin.y), z = Math.round(origin.z);
    const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dir.x || 1e-9)), tDeltaY = Math.abs(1 / (dir.y || 1e-9)), tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
    const bound = (o, i, st) => ((st > 0 ? i + 0.5 - o : o - (i - 0.5)));
    let tMaxX = bound(origin.x, x, stepX) * tDeltaX;
    let tMaxY = bound(origin.y, y, stepY) * tDeltaY;
    let tMaxZ = bound(origin.z, z, stepZ) * tDeltaZ;
    let face = null, t = 0;
    for (let i = 0; i < 64; i++) {
      if (solid(x, y, z) && t > 0.001) {
        return { key: keyOf(x, y, z), type: blocks.get(keyOf(x, y, z)), dist: t, face, pos: { x, y, z } };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
      if (t > maxDist) return null;
    }
    return null;
  }

  function screenRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc;
  }

  // 화면 탭 → 월드 상호작용 판정
  function pickAt(clientX, clientY, maxDist = 7) {
    const rc = screenRay(clientX, clientY);
    // 1) 퀴즈 블록 우선 — 단, 플레이어 근처에 있는 블록만 (멀리서/벽 너머 개봉 방지)
    const quizHit = rc.intersectObjects(quizGroup.children, true)[0];
    if (quizHit) {
      let obj = quizHit.object;
      while (obj && obj.userData.quizIndex === undefined) obj = obj.parent;
      if (obj && obj.position.distanceTo(player.pos) < 8) return { kind: 'quiz', index: obj.userData.quizIndex };
    }
    // 2) 복셀
    const hit = raycastVoxel(rc.ray.origin, rc.ray.direction, maxDist + cam.dist);
    if (hit) {
      const playerDist = new THREE.Vector3(hit.pos.x, hit.pos.y, hit.pos.z).distanceTo(player.pos);
      if (playerDist <= maxDist) return { kind: 'block', ...hit };
    }
    return null;
  }

  function clearJump() { input.jumpQueued = false; }

  // ---------- 공용 리소스 정리 헬퍼 ----------
  function disposeObject(root) {
    root.traverse((o) => {
      if (o.geometry && o.geometry !== blockGeo && o.geometry !== particleGeo) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }

  // ---------- 파티클 ----------
  const particles = [];
  const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const particleMats = new Map(); // color → 공유 재질 (버스트마다 새로 만들지 않는다)
  function particleMat(color) {
    if (!particleMats.has(color)) particleMats.set(color, new THREE.MeshBasicMaterial({ color }));
    return particleMats.get(color);
  }
  function burst(pos, color, count = 14, size = 1) {
    const mat = particleMat(color);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(particleGeo, mat);
      p.position.copy(pos);
      p.scale.setScalar(size === 1 ? 0.7 + Math.random() * 0.9 : size * 6);
      p.userData = {
        vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 6 + 2, (Math.random() - 0.5) * 6),
        life: 0.7 + Math.random() * 0.4,
      };
      particles.push(p);
      scene.add(p);
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); continue; }
      p.userData.vel.y -= 18 * dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.scale.multiplyScalar(1 - dt * 1.2);
    }
  }

  // ---------- 폭탄 ----------
  const bombs = [];
  const bombGeo = new THREE.SphereGeometry(0.34, 10, 10);
  function dropBomb(pos, { remote } = {}) {
    const bomb = new THREE.Mesh(bombGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
    bomb.position.copy(pos).add(new THREE.Vector3(0, 0.35, 0));
    bomb.userData = { fuse: 2, remote };
    bombs.push(bomb);
    scene.add(bomb);
    return bomb;
  }
  function explodeAt(pos, { radius = 2.6, remote } = {}) {
    // 파괴 가능한 블록 수집
    const destroyed = [];
    const r = Math.ceil(radius);
    const cx = Math.round(pos.x), cy = Math.round(pos.y), cz = Math.round(pos.z);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      const key = keyOf(x, y, z);
      const type = blocks.get(key);
      if (!type || !BLOCK_TYPES[type].breakable) continue;
      if (Math.hypot(x - pos.x, y - pos.y, z - pos.z) > radius) continue;
      destroyed.push({ key, type });
    }
    for (const d of destroyed) removeBlock(d.key, { silent: true });
    flushDirty();
    // 연출
    burst(pos, 0xff8c1a, 30);
    burst(pos, 0x555555, 20);
    burst(pos, 0xffcf3f, 16);
    shake = 0.5;
    if (window.BQ) BQ.sound('explosion');
    // 플레이어 넉백 — 밀린 위치가 블록 속이면 밀지 않는다 (벽 끼임 방지)
    if (!remote) {
      const d = player.pos.clone().sub(pos);
      const dist = d.length();
      if (dist < radius + 1.5) {
        d.normalize();
        player.vel.y = 8;
        const nx = player.pos.x + d.x * 0.4;
        const nz = player.pos.z + d.z * 0.4;
        if (!aabbSolid(nx, player.pos.y, nz)) {
          player.pos.x = nx;
          player.pos.z = nz;
        }
      }
    }
    return destroyed; // [{key, type}] — 호출부에서 상자 전리품·서버 동기화를 처리
  }
  let onBombExploded = null;
  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.userData.fuse -= dt;
      b.material.color.setHex(Math.floor(b.userData.fuse * 6) % 2 ? 0x222222 : 0xd03b3b);
      const s = 1 + Math.sin(b.userData.fuse * 20) * 0.06;
      b.scale.setScalar(s);
      if (b.userData.fuse <= 0) {
        scene.remove(b);
        bombs.splice(i, 1);
        const keys = explodeAt(b.position, { remote: b.userData.remote });
        if (!b.userData.remote && onBombExploded) onBombExploded(b.position, keys);
      }
    }
  }

  // ---------- 발사체 (총) ----------
  const projectiles = [];
  const projGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const projMat = new THREE.MeshBasicMaterial({ color: 0x37e0e0 });
  function shootFrom(origin, dir, { remote } = {}) {
    const p = new THREE.Mesh(projGeo, projMat);
    p.position.copy(origin);
    p.userData = { dir: dir.clone().normalize(), life: 1.4, remote };
    projectiles.push(p);
    scene.add(p);
    if (window.BQ) BQ.sound('shoot');
  }
  // 플레이어 시점 사격 (크로스헤어 방향)
  function shoot() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const origin = player.pos.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(dir, 0.6);
    shootFrom(origin, dir);
    return { origin, dir };
  }
  let onProjectileHit = null;
  function updateProjectiles(dt) {
    const SPEED = 26;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) { scene.remove(p); projectiles.splice(i, 1); continue; }
      const move = SPEED * dt;
      const hit = raycastVoxel(p.position, p.userData.dir, move);
      if (hit) {
        burst(new THREE.Vector3(hit.pos.x, hit.pos.y, hit.pos.z), 0x37e0e0, 8, 0.6);
        if (!p.userData.remote && BLOCK_TYPES[hit.type].breakable && onProjectileHit) onProjectileHit(hit);
        scene.remove(p);
        projectiles.splice(i, 1);
        continue;
      }
      p.position.addScaledVector(p.userData.dir, move);
    }
  }

  // ---------- 아이템 ----------
  const ITEM_DEFS = {
    boots: { color: 0x80e61d, emoji: '👢', label: '스피드 부츠' },
    gun: { color: 0x37e0e0, emoji: '🔫', label: '블래스터' },
    bomb: { color: 0x333333, emoji: '💣', label: '폭탄' },
    gem: { color: 0xc07de8, emoji: '💎', label: '블록 꾸러미' },
  };
  const items = [];
  function spawnItem(type, pos) {
    const def = ITEM_DEFS[type];
    if (!def) return;
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35 }));
    g.add(core);
    const label = makeTextSprite(def.emoji, { size: 30, bg: 'rgba(0,0,0,0)' });
    label.position.y = 0.7;
    g.add(label);
    g.position.copy(pos);
    g.userData = { itemType: type, baseY: pos.y, respawnAt: 0, t: Math.random() * 6 };
    items.push(g);
    scene.add(g);
  }
  function seedItems() {
    const irnd = mulberry32(classSeed ^ 0x9e3779b9);
    const types = ['boots', 'gun', 'bomb', 'gem', 'boots', 'bomb', 'gun', 'gem'];
    for (const type of types) {
      const x = Math.floor(irnd() * 36 - 18), z = Math.floor(irnd() * 36 - 18);
      let y = 1;
      while (blocks.has(keyOf(x, y, z)) && y < 12) y++;
      spawnItem(type, new THREE.Vector3(x, y + 0.4, z));
    }
  }
  seedItems();
  const _tmpCenter = new THREE.Vector3(); // 프레임 루프용 임시 벡터 (GC 압박 방지)
  function updateItems(dt) {
    const now = performance.now();
    _tmpCenter.copy(player.pos);
    _tmpCenter.y += 0.5;
    for (const it of items) {
      it.userData.t += dt;
      if (it.userData.respawnAt) {
        if (now >= it.userData.respawnAt) { it.userData.respawnAt = 0; it.visible = true; }
        else continue;
      }
      it.rotation.y += dt * 2;
      it.position.y = it.userData.baseY + Math.sin(it.userData.t * 2.2) * 0.14;
      if (it.position.distanceTo(_tmpCenter) < 1.1) {
        it.visible = false;
        it.userData.respawnAt = now + 25000;
        burst(it.position, 0xffffff, 10, 0.5);
        if (window.BQ) BQ.sound('pickup');
        emit('itemPickup', it.userData.itemType, ITEM_DEFS[it.userData.itemType]);
      }
    }
  }

  // ---------- 퀴즈 블록 ----------
  const quizGroup = new THREE.Group();
  scene.add(quizGroup);
  const QUIZ_COLORS = { pending: 0xffcf3f, correct: 0x4cc94c, wrong: 0x777777 };
  function setQuizBlocks(quizId, count, states) {
    for (const child of [...quizGroup.children]) disposeObject(child);
    quizGroup.clear();
    if (!count) return;
    const qrnd = mulberry32(hashStr(quizId));
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + qrnd() * 0.6;
      const radius = 8 + qrnd() * 8;
      const x = Math.round(Math.cos(ang) * radius), z = Math.round(Math.sin(ang) * radius);
      let y = 1;
      while (blocks.has(keyOf(x, y, z)) && y < 14) y++;
      const g = new THREE.Group();
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.1, 1.1),
        new THREE.MeshLambertMaterial({ color: QUIZ_COLORS.pending, emissive: 0xffcf3f, emissiveIntensity: 0.3 })
      );
      const mark = makeTextSprite(`${i + 1}번 ❓`, { size: 26, bg: 'rgba(0,0,0,0.55)' });
      mark.position.y = 1.15;
      g.add(cube, mark);
      g.position.set(x, y + 0.8, z);
      g.userData = { quizIndex: i, cube, mark, baseY: y + 0.8, t: qrnd() * 6 };
      quizGroup.add(g);
      updateQuizBlockState(i, states ? states[i] : 'pending');
    }
  }
  function updateQuizBlockState(index, state) {
    const g = quizGroup.children.find((c) => c.userData.quizIndex === index);
    if (!g) return;
    g.userData.state = state;
    const cube = g.userData.cube;
    cube.material.color.setHex(QUIZ_COLORS[state] || QUIZ_COLORS.pending);
    cube.material.emissive.setHex(state === 'pending' ? 0xffcf3f : state === 'correct' ? 0x1f7d1f : 0x222222);
    const old = g.userData.mark;
    const label = state === 'correct' ? `${index + 1}번 ✓` : state === 'wrong' ? `${index + 1}번 ✗` : `${index + 1}번 ❓`;
    const mark = makeTextSprite(label, { size: 26, bg: 'rgba(0,0,0,0.55)' });
    mark.position.copy(old.position);
    g.remove(old);
    disposeObject(old);
    g.add(mark);
    g.userData.mark = mark;
    if (state === 'correct') burst(g.position, 0x80e61d, 24);
  }
  function celebrateQuizBlock(index) {
    const g = quizGroup.children.find((c) => c.userData.quizIndex === index);
    if (g) { burst(g.position, 0xffcf3f, 30); burst(g.position, 0x80e61d, 20); }
  }
  function nearestQuizBlock() {
    let best = null;
    _tmpCenter.copy(player.pos);
    _tmpCenter.y += 1;
    for (const g of quizGroup.children) {
      const d = g.position.distanceTo(_tmpCenter);
      if (d < 2.6 && (!best || d < best.dist)) best = { index: g.userData.quizIndex, state: g.userData.state, dist: d };
    }
    return best;
  }
  function updateQuizBlocks(dt) {
    for (const g of quizGroup.children) {
      g.userData.t += dt;
      g.rotation.y += dt * (g.userData.state === 'pending' ? 1.2 : 0.2);
      g.position.y = g.userData.baseY + Math.sin(g.userData.t * 1.8) * 0.16;
    }
  }

  // ---------- 원격 플레이어 ----------
  const remotes = new Map(); // id → {mesh, target:{pos,yaw}, anim}
  function addRemote(id, { name, avatar }) {
    if (remotes.has(id)) removeRemote(id);
    const m = buildCharacter(avatar || 'steve', name || '친구');
    m.position.set(0, 1, 0);
    scene.add(m);
    remotes.set(id, { mesh: m, target: { pos: new THREE.Vector3(0, 1, 0), yaw: 0 }, anim: 'idle' });
  }
  function updateRemote(id, { x, y, z, yaw, anim }) {
    const r = remotes.get(id);
    if (!r) return;
    r.target.pos.set(x, y, z);
    r.target.yaw = yaw;
    r.anim = anim;
  }
  function removeRemote(id) {
    const r = remotes.get(id);
    if (r) {
      scene.remove(r.mesh);
      disposeObject(r.mesh);
      remotes.delete(id);
    }
  }
  function updateRemotes(dt) {
    for (const r of remotes.values()) {
      r.mesh.position.lerp(r.target.pos, Math.min(1, dt * 10));
      let dy = r.target.yaw - r.mesh.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.mesh.rotation.y += dy * Math.min(1, dt * 10);
      animateCharacter(r.mesh, r.anim === 'walk', dt);
    }
  }

  // ---------- 루프 ----------
  let shake = 0;
  let running = true;
  let lastT = performance.now();
  const tickCallbacks = [];
  function onTick(cb) { tickCallbacks.push(cb); }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.09); // 저사양 태블릿(11fps 이상)에서도 실시간 유지, 서브스텝이 터널링 방지
    lastT = now;
    physicsStep(dt);
    updateCamera(dt);
    updateParticles(dt);
    updateBombs(dt);
    updateProjectiles(dt);
    updateItems(dt);
    updateQuizBlocks(dt);
    updateRemotes(dt);
    flushDirty();
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x += (Math.random() - 0.5) * shake * 0.5;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    }
    for (const cb of tickCallbacks) cb(dt);
    renderer.render(scene, camera);
  }
  frame();

  return {
    THREE, scene, camera, player, blocks,
    BLOCK_TYPES,
    setMove, jump, clearJump, rotateCamera, respawn,
    pickAt, raycastVoxel,
    // flush는 매 프레임 루프에서 일괄 수행 — 같은 프레임의 다중 변경을 한 번의 인스턴스 재구축으로 합친다
    removeBlock: (key) => removeBlock(key),
    placeBlock: (key, type) => { const ok = placeBlock(key, type); if (ok && window.BQ) BQ.sound('place'); return ok; },
    applyDiffs,
    dropBomb, explodeAt, setOnBombExploded: (cb) => { onBombExploded = cb; },
    shoot, shootFrom, setOnProjectileHit: (cb) => { onProjectileHit = cb; },
    burst,
    setQuizBlocks, updateQuizBlockState, celebrateQuizBlock, nearestQuizBlock,
    addRemote, updateRemote, removeRemote,
    setSpeedBoost: (ms) => { player.speedBoostUntil = performance.now() + ms; },
    on, onTick,
    keyOf, parseKey,
    dispose: () => { running = false; renderer.dispose(); },
  };
}
