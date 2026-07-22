// BlockQuest 3D 월드 엔진 — three.js 기반 복셀 아레나
// 커스텀 AABB 물리(중력/점프/이중점프/제트팩/수영), 블록 파괴·설치, 폭탄/발사체,
// 아이템, 퀴즈 블록, 맵/존 테마, 낮밤 사이클, NPC 동물, 포털, 원격 플레이어 렌더링을 담당한다.
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
  // 신규 장식/지형 블록 5종
  sand: { color: 0xe8d08a, breakable: true },
  snow: { color: 0xf4f8fc, breakable: true },
  ice: { color: 0xa8d8f0, breakable: true, slippery: true },
  glass: { color: 0xd8f0f4, breakable: true, transparent: true, opacity: 0.45 },
  gold: { color: 0xf5c518, breakable: true, sparkle: true },
  // 기능 블록 (게임 요소용 — 장식 5종 카운트와 별개)
  water: { color: 0x3f7fd9, breakable: false, swim: true, transparent: true, opacity: 0.6 }, // 충돌 없음
  lava: { color: 0xe85d1a, breakable: false, hazard: true }, // 충돌 없음, 닿으면 리스폰
  tramp: { color: 0xd94fa0, breakable: true, bouncy: true }, // 트램펄린
  fan: { color: 0x9adbe8, breakable: true, updraft: true }, // 상승 기류
};

// 맵(테마) 정의 — 존 배치는 인덱스 0=중앙, 1=북, 2=동, 3=남, 4=서
export const MAP_DEFS = {
  classic: { label: '초원 왕국',   sky: 0x87b7f2, zones: ['plaza','snowfield','desert','forest','volcano'] },
  desert:  { label: '사막 대탐험', sky: 0xf2d489, zones: ['desert','desert','plaza','desert','volcano'] },
  snow:    { label: '눈의 왕국',   sky: 0xcfe4f7, zones: ['snowfield','snowfield','forest','snowfield','plaza'] },
  volcano: { label: '화산 모험',   sky: 0xd98a66, zones: ['volcano','volcano','plaza','desert','volcano'] },
  sky:     { label: '하늘 섬',     sky: 0xa8d4ff, zones: ['plaza','forest','snowfield','desert','forest'] },
  ocean:   { label: '바다 마을',   sky: 0x7fc4e8, zones: ['plaza','forest','desert','forest','snowfield'] },
};

// 꾸미기(모자/펫) 정의
export const HAT_DEFS = { cap:{color:0xd93b3b,label:'빨간 모자'}, crown:{color:0xf5c518,label:'황금 왕관'}, wizard:{color:0x6a3a9c,label:'마법사 모자'}, leaf:{color:0x57a531,label:'새싹 모자'} };
export const PET_DEFS = { chick:{color:0xffe066,label:'병아리'}, slime:{color:0x80e61d,label:'슬라임'}, ghost:{color:0xeeeeff,label:'유령'}, star:{color:0xffd94f,label:'별똥이'} };

const PLAYER = { HX: 0.3, HEIGHT: 1.8, SPEED: 6, JUMP_V: 10.5, GRAVITY: 28, MAX_FALL: 30 };
const WORLD_R = 72; // 아레나 반경 (블록)

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
  g.userData = { armL, armR, legL, legR, phase: 0, hatMesh: null, petMesh: null, petT: 0, emoteSprite: null };
  return g;
}

function animateCharacter(g, moving, dt) {
  const u = g.userData;
  u.phase = moving ? u.phase + dt * 9 : u.phase * 0.8;
  const swing = Math.sin(u.phase) * (moving ? 0.7 : 0.05);
  u.armL.rotation.x = swing; u.armR.rotation.x = -swing;
  u.legL.rotation.x = -swing; u.legR.rotation.x = swing;
  // 펫 둥둥 애니메이션
  if (u.petMesh) {
    u.petT += dt;
    u.petMesh.position.y = 1.35 + Math.sin(u.petT * 2.4) * 0.08;
  }
}

// ---------- 엔진 본체 ----------
export function createEngine({ canvas, classSeed, avatarKey, playerName, mapKey = 'classic' }) {
  const mapId = MAP_DEFS[mapKey] ? mapKey : 'classic';
  const map = MAP_DEFS[mapId];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const dayColor = new THREE.Color(map.sky);
  const nightColor = new THREE.Color(0x0e1230);
  const bgColor = dayColor.clone();
  scene.background = bgColor; // 낮/밤 보간을 위해 매 프레임 색을 갱신한다
  scene.fog = new THREE.Fog(map.sky, 55, 130);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 260);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x6a5335, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
  sun.position.set(18, 30, 12);
  scene.add(sun);

  // 구름 (장식) — 넓어진 맵에 맞춰 분포 확대
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(4 + (i % 3) * 2, 0.6, 2.4), cloudMat);
    cloud.position.set((i * 23 % 128) - 64, 24 + (i % 4) * 2, ((i * 37) % 128) - 64);
    scene.add(cloud);
  }

  // 별 (밤에만 표시)
  const starGeo = new THREE.BufferGeometry();
  {
    const n = 140, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.12;
      const r = 118;
      arr[i * 3] = Math.cos(a) * Math.cos(e) * r;
      arr[i * 3 + 1] = Math.sin(e) * r;
      arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }
  const stars = new THREE.Points(starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
  stars.visible = false;
  scene.add(stars);

  // ---------- 복셀 월드 ----------
  const blocks = new Map(); // key → type
  const rnd = mulberry32(classSeed);

  function setBlock(x, y, z, type) { blocks.set(keyOf(x, y, z), type); }

  // ---------- 맵/존 ----------
  const ZONE_CENTERS = [
    { x: 0, z: 0 }, { x: 0, z: -46 }, { x: 46, z: 0 }, { x: 0, z: 46 }, { x: -46, z: 0 },
  ]; // 0=중앙, 1=북, 2=동, 3=남, 4=서
  function zoneIndexAt(x, z) {
    if (Math.hypot(x, z) <= 20) return 0; // 중앙 광장 반경
    const ax = Math.abs(x), az = Math.abs(z);
    if (z < -ax) return 1; // 북
    if (x > az) return 2; // 동
    if (z > ax) return 3; // 남
    if (x < -az) return 4; // 서
    return x >= 0 ? 2 : 4; // 대각 경계선은 동/서로 귀속
  }
  function zoneAt(x, z) { return map.zones[zoneIndexAt(x, z)]; }
  const ZONE_FLOOR = { plaza: 'grass', snowfield: 'snow', desert: 'sand', forest: 'grass', volcano: 'stone' };

  // 결정적 셀 노이즈 (하늘 섬 구멍 배치용) — 모든 학생이 같은 지형을 본다
  function cellNoise(x, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) ^ classSeed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function skyHole(x, z) {
    const d = Math.hypot(x, z);
    if (d < 26 || Math.abs(x) > 66 || Math.abs(z) > 66) return false; // 중앙 광장/외곽 보호
    for (const c of ZONE_CENTERS) if (Math.hypot(x - c.x, z - c.z) < 11) return false; // 존 중심부 보호
    if (cellNoise(Math.floor(x / 4), Math.floor(z / 4)) >= 0.2) return false;
    // 4×4 타일 안에서 3×3만 뚫어 좁은 다리를 남긴다 (떠 있는 섬 느낌)
    return ((x % 4) + 4) % 4 !== 0 && ((z % 4) + 4) % 4 !== 0;
  }

  const crownPoints = []; // 왕관 지점 (중앙 타워 꼭대기 gold 좌표)
  const courseDefs = []; // 타임어택 코스 {start, goal} (plaza 점프코스)
  const clampW = (v) => Math.max(-WORLD_R + 2, Math.min(WORLD_R - 2, v));
  function zoneSpot(cx, cz, r) {
    return [clampW(cx + Math.floor(rnd() * (r * 2 + 1)) - r), clampW(cz + Math.floor(rnd() * (r * 2 + 1)) - r)];
  }
  function genTree(tx, tz, h, leafType) {
    for (let y = 1; y <= h; y++) setBlock(tx, y, tz, 'wood');
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
      if (dy === 1 && (dx !== 0 || dz !== 0)) continue;
      setBlock(tx + dx, h + dy + 1, tz + dz, leafType);
    }
  }

  // 존별 구조물 생성 (모든 맵 공통 규칙, 존 중심 좌표 기준)
  function genZone(kind, cx, cz) {
    if (kind === 'plaza') {
      // 나무 7
      for (let i = 0; i < 7; i++) {
        const [tx, tz] = zoneSpot(cx, cz, 15);
        if (Math.abs(tx - cx) < 4 && Math.abs(tz - cz) < 4) continue; // 중앙 타워 자리 확보
        genTree(tx, tz, 3 + Math.floor(rnd() * 2), 'leaf');
      }
      // 벽돌 유적 4
      for (let i = 0; i < 4; i++) {
        const [bx, bz] = zoneSpot(cx, cz, 13);
        if (Math.abs(bx - cx) < 5 && Math.abs(bz - cz) < 5) continue;
        const w = 3 + Math.floor(rnd() * 2);
        for (let dx = 0; dx < w; dx++) for (let dy = 1; dy <= 2; dy++) {
          if (dx === Math.floor(w / 2) && dy === 1) continue; // 출입구
          setBlock(bx + dx, dy, bz, 'brick');
        }
      }
      // 나선 점프 코스 (타임어택 코스로 기록)
      let px = cx + 6, pz = cz + 6, py = 2;
      const pts = [];
      for (let i = 0; i < 9; i++) {
        setBlock(px, py, pz, 'plank');
        if (i % 2 === 1) setBlock(px + 1, py, pz, 'plank');
        pts.push({ x: px, y: py, z: pz });
        const ang = i * 0.8;
        px += Math.round(Math.cos(ang) * 3);
        pz += Math.round(Math.sin(ang) * 3);
        px = Math.max(cx - 16, Math.min(cx + 16, px));
        pz = Math.max(cz - 16, Math.min(cz + 16, pz));
        py += 1;
      }
      courseDefs.push({ start: pts[0], goal: pts[pts.length - 1] });
      // 중앙 타워: stone 기둥 높이 8 + 꼭대기 gold (왕관 지점)
      for (let y = 1; y <= 8; y++) setBlock(cx, y, cz, 'stone');
      setBlock(cx, 9, cz, 'gold');
      crownPoints.push({ x: cx, y: 9, z: cz });
    } else if (kind === 'snowfield') {
      // ice 패치 8~12곳 (3×3)
      const patches = 8 + Math.floor(rnd() * 5);
      for (let i = 0; i < patches; i++) {
        const [ix, iz] = zoneSpot(cx, cz, 14);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) setBlock(ix + dx, 0, iz + dz, 'ice');
      }
      // 침엽수 (wood 기둥 + snow 잎)
      for (let i = 0; i < 6; i++) {
        const [tx, tz] = zoneSpot(cx, cz, 15);
        genTree(tx, tz, 3 + Math.floor(rnd() * 2), 'snow');
      }
      // 눈사람 2 (snow 2단)
      for (let i = 0; i < 2; i++) {
        const [sx, sz] = zoneSpot(cx, cz, 12);
        setBlock(sx, 1, sz, 'snow'); setBlock(sx, 2, sz, 'snow');
      }
    } else if (kind === 'desert') {
      // 선인장 (leaf 기둥 2~3단) 6
      for (let i = 0; i < 6; i++) {
        const [dxp, dzp] = zoneSpot(cx, cz, 14);
        const h = 2 + Math.floor(rnd() * 2);
        for (let y = 1; y <= h; y++) setBlock(dxp, y, dzp, 'leaf');
      }
      // 피라미드 (sand 계단형, 한 변 7) 1
      const [pxp, pzp] = zoneSpot(cx, cz, 9);
      for (let lvl = 0; lvl < 4; lvl++) {
        const half = 3 - lvl;
        for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
          setBlock(pxp + dx, lvl + 1, pzp + dz, 'sand');
        }
      }
      // 오아시스 (water 3×3) 1 — 물 밑에 sand 바닥을 깔아 가슴 깊이로
      const [ox, oz] = zoneSpot(cx, cz, 12);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        setBlock(ox + dx, -1, oz + dz, 'sand');
        setBlock(ox + dx, 0, oz + dz, 'water');
      }
    } else if (kind === 'forest') {
      // 나무 밀도 3배
      for (let i = 0; i < 21; i++) {
        const [tx, tz] = zoneSpot(cx, cz, 16);
        genTree(tx, tz, 3 + Math.floor(rnd() * 2), 'leaf');
      }
      // 거대 나무 1 (높이 7, 넓은 잎)
      const [gx, gz] = zoneSpot(cx, cz, 9);
      for (let y = 1; y <= 7; y++) setBlock(gx, y, gz, 'wood');
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        setBlock(gx + dx, 8, gz + dz, 'leaf');
      }
      setBlock(gx, 9, gz, 'leaf');
      // 통나무집 (wood 골조 + plank 지붕) 1
      const [hx, hz] = zoneSpot(cx, cz, 11);
      for (let dx = 0; dx < 5; dx++) for (let dz = 0; dz < 4; dz++) {
        const edge = dx === 0 || dx === 4 || dz === 0 || dz === 3;
        if (edge) {
          for (let dy = 1; dy <= 2; dy++) {
            if (dx === 2 && dz === 0) continue; // 출입구
            setBlock(hx + dx, dy, hz + dz, 'wood');
          }
        }
        setBlock(hx + dx, 3, hz + dz, 'plank'); // 지붕
      }
    } else if (kind === 'volcano') {
      // lava 웅덩이 3~5곳 (2×2)
      const pools = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < pools; i++) {
        const [lx, lz] = zoneSpot(cx, cz, 13);
        if (Math.abs(lx) < 5 && Math.abs(lz) < 5) continue; // 스폰 지점 보호
        for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) setBlock(lx + dx, 0, lz + dz, 'lava');
      }
      // stone 기둥 4
      for (let i = 0; i < 4; i++) {
        const [sx, sz] = zoneSpot(cx, cz, 13);
        const h = 2 + Math.floor(rnd() * 3);
        for (let y = 1; y <= h; y++) setBlock(sx, y, sz, 'stone');
      }
      // gold 광맥 (2×1) 4
      for (let i = 0; i < 4; i++) {
        const [gx, gz] = zoneSpot(cx, cz, 13);
        setBlock(gx, 1, gz, 'gold'); setBlock(gx + 1, 1, gz, 'gold');
      }
    }
    // 존마다 아이템 상자
    for (let i = 0; i < 3; i++) {
      const [cxx, czz] = zoneSpot(cx, cz, 14);
      if (!blocks.has(keyOf(cxx, 1, czz))) setBlock(cxx, 1, czz, 'crate');
    }
  }

  function generateWorld() {
    // 바닥: 존별 바닥 블록 + 외곽 벽 (파괴 불가)
    for (let x = -WORLD_R; x <= WORLD_R; x++) {
      for (let z = -WORLD_R; z <= WORLD_R; z++) {
        const d = Math.hypot(x, z);
        if (mapId === 'ocean' && d > 20 && d <= 26) {
          // 바다 마을 특수: 존 경계 링을 water로 (밑에 sand 바닥)
          setBlock(x, -1, z, 'sand');
          setBlock(x, 0, z, 'water');
        } else if (mapId === 'sky' && skyHole(x, z)) {
          // 하늘 섬 특수: 구멍 (바닥 없음)
        } else {
          setBlock(x, 0, z, ZONE_FLOOR[zoneAt(x, z)] || 'grass');
        }
        if (Math.abs(x) === WORLD_R || Math.abs(z) === WORLD_R) {
          setBlock(x, 1, z, 'stone'); setBlock(x, 2, z, 'stone'); // 외곽 벽
        }
      }
    }
    // 존별 구조물 (결정적 — rnd 호출 순서 고정)
    for (let zi = 0; zi < 5; zi++) {
      const c = ZONE_CENTERS[zi];
      genZone(map.zones[zi], c.x, c.z);
    }
  }
  generateWorld();

  // 해당 칸의 가장 높은 블록 y (소수 오브젝트 배치/텔레포트용 — 전수 스캔 아님)
  function topY(x, z) {
    for (let y = 16; y >= -2; y--) if (blocks.has(keyOf(x, y, z))) return y;
    return 0;
  }

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
    const def = BLOCK_TYPES[type];
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    if (def.transparent) { mat.transparent = true; mat.opacity = def.opacity || 1; } // glass/water 투명 재질
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
  const listeners = {
    blockBroken: [], itemPickup: [], quizTouch: [],
    treasureOpen: [], meteor: [], animalTouch: [],
    courseStart: [], courseEnd: [], crowned: [],
  };
  function on(evt, cb) { (listeners[evt] || (listeners[evt] = [])).push(cb); }
  function emit(evt, ...args) { for (const cb of listeners[evt] || []) cb(...args); }

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
  // 물(swim)/용암(hazard)은 비고체 — 통과 가능 (aabbSolid는 solid 기준 유지)
  const solid = (x, y, z) => {
    const t = blocks.get(keyOf(x, y, z));
    if (!t) return false;
    const def = BLOCK_TYPES[t];
    return !(def.swim || def.hazard);
  };
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

  // 제트팩 상태
  let jumpHeld = false;
  let jetFuel = 0; // 초 단위
  const JET_MAX = 12; // 연료 최대 12초
  function setJumpHeld(held) { jumpHeld = !!held; }
  function getJetFuel() { return jetFuel; }
  function addJetFuel(sec) { jetFuel = Math.min(JET_MAX, jetFuel + sec); }

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
    // 발/몸/발밑 셀 속성 조회 (O(1) 셀 조회 — 전수 스캔 아님)
    const ccx = Math.round(player.pos.x), ccz = Math.round(player.pos.z);
    const bodyDef = BLOCK_TYPES[blocks.get(keyOf(ccx, Math.round(player.pos.y + 0.5), ccz))] || null;
    const footDef = BLOCK_TYPES[blocks.get(keyOf(ccx, Math.round(player.pos.y - 0.3), ccz))] || null;
    const belowDef = BLOCK_TYPES[blocks.get(keyOf(ccx, Math.round(player.pos.y) - 1, ccz))] || null;
    const swimming = !!(bodyDef && bodyDef.swim);

    // 용암: 발/몸 셀이 hazard면 리스폰
    if ((bodyDef && bodyDef.hazard) || (footDef && footDef.hazard)) {
      burst(player.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xe85d1a, 22);
      if (window.BQ) BQ.sound('wrong');
      respawn();
    }

    const speed = (now < player.speedBoostUntil ? PLAYER.SPEED * 1.9 : PLAYER.SPEED) * (swimming ? 0.6 : 1);
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
    // 얼음(slippery) 위 지상 이동: 목표 속도로 서서히 보간 (미끄러짐), 일반 바닥은 즉시
    if (player.grounded && belowDef && belowDef.slippery) {
      const k = Math.min(1, dt * 3);
      player.vel.x += (dx - player.vel.x) * k;
      player.vel.z += (dz - player.vel.z) * k;
    } else {
      player.vel.x = dx; player.vel.z = dz;
    }
    if (swimming) {
      // 수영: 중력 1/4, 최대 낙하 3, 점프키를 누르고 있으면 위로 헤엄
      player.vel.y = Math.max(player.vel.y - PLAYER.GRAVITY * 0.25 * dt, -3);
      if (jumpHeld) player.vel.y = 4;
      if (Math.random() < dt * 8) burst(player.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x9fc8f0, 1, 0.2); // 물 파티클
    } else {
      player.vel.y = Math.max(player.vel.y - PLAYER.GRAVITY * dt, -PLAYER.MAX_FALL);
    }

    // 상승 기류: 몸 셀 아래 3칸 내 fan 블록이 있으면 위로 밀어올린다
    for (let dy2 = 1; dy2 <= 3; dy2++) {
      const uDef = BLOCK_TYPES[blocks.get(keyOf(ccx, Math.round(player.pos.y) - dy2, ccz))];
      if (uDef && uDef.updraft) {
        player.vel.y = Math.min(player.vel.y + 40 * dt, 9);
        if (Math.random() < 0.5) burst(player.pos.clone().add(new THREE.Vector3(0, -0.2, 0)), 0x9adbe8, 1, 0.14);
        break;
      }
    }

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

    // 제트팩: 점프 버튼을 누르고 있고 연료가 있으면 상승 (지상에서는 소모 없음, 소리 없이 화염 파티클만)
    if (!swimming && jumpHeld && jetFuel > 0 && !player.grounded) {
      player.vel.y = Math.min(player.vel.y + 55 * dt, 7.5);
      jetFuel = Math.max(0, jetFuel - dt);
      if (Math.random() < 0.8) burst(player.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), 0xff8c1a, 1, 0.12);
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

    // 트램펄린: 발밑 블록이 bouncy면 크게 튀어오른다
    if (player.grounded) {
      const bDef = BLOCK_TYPES[blocks.get(keyOf(Math.round(player.pos.x), Math.round(player.pos.y) - 1, Math.round(player.pos.z)))];
      if (bDef && bDef.bouncy) {
        player.vel.y = 18;
        player.grounded = false;
        player.coyote = 0;
        if (window.BQ) BQ.sound('bounce');
        burst(player.pos.clone(), 0xd94fa0, 12, 0.4);
      }
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
    // 2) 보물상자 — 근처에서 탭하면 1회 오픈
    const tHit = rc.intersectObjects(treasureGroup.children, true)[0];
    if (tHit) {
      let obj = tHit.object;
      while (obj && obj.userData.treasureIndex === undefined) obj = obj.parent;
      if (obj && obj.position.distanceTo(player.pos) < 7) {
        if (!obj.userData.opened) openTreasure(obj);
        return { kind: 'treasure', index: obj.userData.treasureIndex };
      }
    }
    // 3) 복셀
    const hit = raycastVoxel(rc.ray.origin, rc.ray.direction, maxDist + cam.dist);
    if (hit) {
      const playerDist = new THREE.Vector3(hit.pos.x, hit.pos.y, hit.pos.z).distanceTo(player.pos);
      if (playerDist <= maxDist) return { kind: 'block', ...hit };
    }
    return null;
  }

  function clearJump() { input.jumpQueued = false; jumpHeld = false; }

  // 캐릭터 정면 1.6칸의 빈 셀 (정면 설치용) — 발높이 → 머리높이 순서로 탐색
  function frontCell() {
    const fx = Math.round(player.pos.x + Math.sin(player.yaw) * 1.6);
    const fz = Math.round(player.pos.z + Math.cos(player.yaw) * 1.6);
    if (Math.abs(fx) >= WORLD_R || Math.abs(fz) >= WORLD_R) return null;
    const footY = Math.round(player.pos.y + 0.5); // 발높이 셀 (발 블록 +1)
    for (const y of [footY, footY + 1]) {
      const key = keyOf(fx, y, fz);
      if (!blocks.has(key)) return { x: fx, y, z: fz, key };
    }
    return null;
  }

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
    jet: { color: 0xff8c1a, emoji: '🚀', label: '제트엔진' },
    firework: { color: 0xe84f8a, emoji: '🎆', label: '폭죽' },
    coin: { color: 0xffd94f, emoji: '⭐', label: '코인' }, // 월드 스폰용 (작게, 회전)
  };
  const items = [];
  function spawnItem(type, pos) {
    const def = ITEM_DEFS[type];
    if (!def) return;
    const g = new THREE.Group();
    const small = type === 'coin'; // 코인은 작게, 이모지 라벨 없이
    const core = new THREE.Mesh(new THREE.BoxGeometry(small ? 0.26 : 0.42, small ? 0.26 : 0.42, small ? 0.1 : 0.42),
      new THREE.MeshLambertMaterial({ color: def.color, emissive: def.color, emissiveIntensity: small ? 0.5 : 0.35 }));
    g.add(core);
    if (!small) {
      const label = makeTextSprite(def.emoji, { size: 30, bg: 'rgba(0,0,0,0)' });
      label.position.y = 0.7;
      g.add(label);
    }
    g.position.copy(pos);
    g.userData = { itemType: type, baseY: pos.y, respawnAt: 0, t: Math.random() * 6, respawnMs: small ? 40000 : 25000 };
    items.push(g);
    scene.add(g);
  }
  function seedItems() {
    // 맵 전역 분포: 기존 4종 각 3개 + jet 2 + firework 2 + coin 40 (coin 리스폰 40초)
    const irnd = mulberry32(classSeed ^ 0x9e3779b9);
    const list = [];
    for (const t of ['boots', 'gun', 'bomb', 'gem']) for (let i = 0; i < 3; i++) list.push(t);
    list.push('jet', 'jet', 'firework', 'firework');
    for (let i = 0; i < 40; i++) list.push('coin');
    for (const type of list) {
      const x = Math.floor(irnd() * 133 - 66), z = Math.floor(irnd() * 133 - 66);
      let y = 1;
      while (blocks.has(keyOf(x, y, z)) && y < 14) y++;
      spawnItem(type, new THREE.Vector3(x, y + 0.4, z));
    }
  }
  seedItems();
  const _tmpCenter = new THREE.Vector3(); // 프레임 루프용 임시 벡터 (GC 압박 방지)
  function updateItems(dt) {
    const now = performance.now();
    // gold 블록 반짝임 — 프레임당 전수 스캔 금지: 인스턴스 키 배열에서 랜덤 1개만
    const goldKeys = instanceKeys.gold;
    if (goldKeys && goldKeys.length && Math.random() < 0.06) {
      const [gx, gy, gz] = parseKey(goldKeys[Math.floor(Math.random() * goldKeys.length)]);
      burst(new THREE.Vector3(gx, gy + 0.6, gz), 0xf5c518, 1, 0.13);
    }
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
        it.userData.respawnAt = now + it.userData.respawnMs;
        burst(it.position, 0xffffff, 10, 0.5);
        if (window.BQ) BQ.sound('pickup');
        emit('itemPickup', it.userData.itemType, ITEM_DEFS[it.userData.itemType]);
      }
    }
  }

  // ---------- 보물상자 (crate와 구분되는 특수 오브젝트 3개, 맵 구석 고정 시드) ----------
  const treasureGroup = new THREE.Group();
  scene.add(treasureGroup);
  function seedTreasures() {
    const trnd = mulberry32(classSeed ^ 0x51f7a3);
    const corners = [[54, 54], [-54, -54], [54, -54]];
    corners.forEach((c, i) => {
      const x = clampW(c[0] + Math.floor(trnd() * 9) - 4);
      const z = clampW(c[1] + Math.floor(trnd() * 9) - 4);
      const gy = topY(x, z);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
      body.position.y = 0.28;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.22, 0.74),
        new THREE.MeshLambertMaterial({ color: 0xd9a520, emissive: 0xd9a520, emissiveIntensity: 0.25 }));
      lid.position.y = 0.66;
      const label = makeTextSprite('🎁', { size: 30, bg: 'rgba(0,0,0,0)' });
      label.position.y = 1.3;
      g.add(body, lid, label);
      g.position.set(x, gy + 0.5, z);
      g.userData = { treasureIndex: i, opened: false, lid };
      treasureGroup.add(g);
    });
  }
  function openTreasure(g) {
    g.userData.opened = true;
    g.userData.lid.rotation.x = -0.9; // 뚜껑 열림 연출
    g.userData.lid.position.z = -0.28;
    burst(g.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xf5c518, 26);
    burst(g.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffffff, 12, 0.5);
    emit('treasureOpen', g.userData.treasureIndex);
  }
  function updateTreasures() {
    // 미개봉 상자 반짝임 (소수 오브젝트만 순회)
    if (Math.random() >= 0.03) return;
    for (const g of treasureGroup.children) {
      if (!g.userData.opened && Math.random() < 0.5) {
        burst(g.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xf5c518, 1, 0.14);
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

  // ---------- 모자/펫 장착 ----------
  function applyStyle(g, { hat, pet } = {}) {
    const u = g.userData;
    if (u.hatMesh) { g.remove(u.hatMesh); u.hatMesh.geometry.dispose(); u.hatMesh.material.dispose(); u.hatMesh = null; }
    if (u.petMesh) { g.remove(u.petMesh); u.petMesh.geometry.dispose(); u.petMesh.material.dispose(); u.petMesh = null; }
    if (hat && HAT_DEFS[hat]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.44),
        new THREE.MeshLambertMaterial({ color: HAT_DEFS[hat].color }));
      m.position.y = 1.86; // 머리 위
      g.add(m);
      u.hatMesh = m;
    }
    if (pet && PET_DEFS[pet]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26),
        new THREE.MeshLambertMaterial({ color: PET_DEFS[pet].color }));
      m.position.set(-0.55, 1.35, -0.35); // 왼쪽 어깨 뒤에서 둥둥
      g.add(m);
      u.petMesh = m;
      u.petT = 0;
    }
  }
  function setStyle(id, style) {
    const target = id === 'me' ? mesh : (remotes.get(id) || {}).mesh;
    if (target) applyStyle(target, style || {});
  }

  // ---------- 이모지 말풍선 (머리 위 2.5초) ----------
  const emotes = [];
  function removeEmoteSprite(target) {
    const s = target.userData.emoteSprite;
    if (!s) return;
    target.remove(s);
    if (s.material.map) s.material.map.dispose();
    s.material.dispose();
    target.userData.emoteSprite = null;
  }
  function showEmote(id, emoji) {
    const target = id === 'me' ? mesh : (remotes.get(id) || {}).mesh;
    if (!target) return;
    if (target.userData.emoteSprite) removeEmoteSprite(target);
    const s = makeTextSprite(emoji, { size: 40, bg: 'rgba(0,0,0,0)' });
    s.position.y = 2.55;
    target.add(s);
    target.userData.emoteSprite = s;
    emotes.push({ target, sprite: s, until: performance.now() + 2500 });
  }
  function updateEmotes() {
    const now = performance.now();
    for (let i = emotes.length - 1; i >= 0; i--) {
      const e = emotes[i];
      if (e.target.userData.emoteSprite !== e.sprite) { emotes.splice(i, 1); continue; } // 새 이모지로 교체됨
      if (now >= e.until) { removeEmoteSprite(e.target); emotes.splice(i, 1); }
    }
  }

  // ---------- 폭죽 (다단 파티클) ----------
  const fireworks = [];
  const FW_COLORS = [0xe84f8a, 0x37e0e0, 0xffcf3f, 0x80e61d, 0x9b4fd9];
  function launchFirework(pos) {
    const p = (pos ? pos.clone() : player.pos.clone()).add(new THREE.Vector3(0, 0.6, 0));
    fireworks.push({ pos: p, t: 0, dur: 0.8 + Math.random() * 0.4, spark: false });
    if (window.BQ) BQ.sound('firework');
  }
  function updateFireworks(dt) {
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      f.t += dt;
      if (f.spark) {
        // 2차 잔불
        if (f.t >= f.dur) {
          burst(f.pos, 0xffffff, 12, 0.4);
          fireworks.splice(i, 1);
        }
        continue;
      }
      f.pos.y += 11 * dt; // 로켓 상승
      burst(f.pos.clone(), 0xffd080, 1, 0.1); // 트레일
      if (f.t >= f.dur) {
        const c1 = FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)];
        const c2 = FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)];
        burst(f.pos, c1, 28);
        burst(f.pos, c2, 18);
        fireworks.push({ pos: f.pos.clone(), t: 0, dur: 0.25, spark: true });
        fireworks.splice(i, 1);
      }
    }
  }

  // ---------- NPC 동물 (닭 3 / 돼지 2 — 물리 무시, 소수 오브젝트) ----------
  const animals = [];
  function buildAnimal(type) {
    const g = new THREE.Group();
    if (type === 'chicken') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.5), new THREE.MeshLambertMaterial({ color: 0xf7f7f2 }));
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), new THREE.MeshLambertMaterial({ color: 0xf0b429 }));
      beak.position.set(0, 0.08, 0.3);
      g.add(body, beak);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.75), new THREE.MeshLambertMaterial({ color: 0xe8909c }));
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.1), new THREE.MeshLambertMaterial({ color: 0xd9707e }));
      snout.position.set(0, 0.04, 0.42);
      g.add(body, snout);
    }
    return g;
  }
  function seedAnimals() {
    // plaza/forest 존을 배회 무대로 (없으면 중앙)
    const anchors = [];
    for (let zi = 0; zi < 5; zi++) {
      const k = map.zones[zi];
      if (k === 'plaza' || k === 'forest') anchors.push(ZONE_CENTERS[zi]);
    }
    if (!anchors.length) anchors.push(ZONE_CENTERS[0]);
    const kinds = ['chicken', 'chicken', 'chicken', 'pig', 'pig'];
    kinds.forEach((type, i) => {
      const a = anchors[i % anchors.length];
      const m = buildAnimal(type);
      const x = clampW(a.x + Math.floor(rnd() * 17) - 8), z = clampW(a.z + Math.floor(rnd() * 17) - 8);
      m.position.set(x, topY(x, z) + 0.5 + 0.3, z); // 바닥 y+0.3
      scene.add(m);
      animals.push({ type, mesh: m, anchor: a, target: { x, z }, speed: 1 + Math.random() * 0.5, hopY: 0, hopV: 0, cooldownUntil: 0 });
    });
  }
  function updateAnimals(dt) {
    const now = performance.now();
    for (const an of animals) {
      const m = an.mesh;
      const dx = an.target.x - m.position.x, dz = an.target.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) {
        // 랜덤 워크: 새 목표 지점 (연출이므로 Math.random 사용)
        an.target.x = clampW(an.anchor.x + Math.random() * 20 - 10);
        an.target.z = clampW(an.anchor.z + Math.random() * 20 - 10);
      } else {
        const step = Math.min(dist, an.speed * dt);
        m.position.x += (dx / dist) * step;
        m.position.z += (dz / dist) * step;
        m.rotation.y = Math.atan2(dx, dz);
      }
      // 폴짝 오프셋 + 바닥 높이 추적 (물리 무시)
      an.hopV -= 22 * dt;
      an.hopY = Math.max(0, an.hopY + an.hopV * dt);
      if (an.hopY === 0 && an.hopV < 0) an.hopV = 0;
      const gy = topY(Math.round(m.position.x), Math.round(m.position.z));
      m.position.y = gy + 0.5 + 0.3 + an.hopY;
      // 플레이어 1.2칸 접근 → 폴짝 점프 + 이벤트 (쿨다운 3초)
      const pd = Math.hypot(player.pos.x - m.position.x, player.pos.z - m.position.z);
      if (pd < 1.2 && Math.abs(player.pos.y - m.position.y) < 1.6 && now > an.cooldownUntil) {
        an.cooldownUntil = now + 3000;
        an.hopV = 5;
        burst(m.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff9ecb, 6, 0.3);
        emit('animalTouch', an.type);
      }
    }
  }

  // ---------- 포털 2쌍 (중앙 광장 ↔ 원거리 존 2곳, 시드 고정) ----------
  const portals = [];
  let portalCooldownUntil = 0;
  function makePortalEnd(x, z, color) {
    const gy = topY(x, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.12, 8, 20),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 })
    );
    ring.position.set(x, gy + 0.5 + 1.1, z);
    scene.add(ring);
    return { x, z, y: gy + 0.5, mesh: ring, other: null, standT: 0, color };
  }
  function seedPortals() {
    const pi = Math.max(0, map.zones.indexOf('plaza'));
    const farIdx = [1, 2, 3, 4].filter((i) => i !== pi).slice(0, 2);
    const colors = [0x9b4fd9, 0x2fd0c8]; // 보라 / 청록
    const offsets = [[9, -9], [-9, 9]];
    farIdx.forEach((fi, k) => {
      const pc = ZONE_CENTERS[pi], fc = ZONE_CENTERS[fi];
      const a = makePortalEnd(clampW(pc.x + offsets[k][0]), clampW(pc.z + offsets[k][1]), colors[k]);
      const b = makePortalEnd(clampW(fc.x + 4), clampW(fc.z + 4), colors[k]);
      a.other = b; b.other = a;
      portals.push(a, b);
    });
  }
  function updatePortals(dt) {
    const now = performance.now();
    for (const p of portals) {
      p.mesh.rotation.y += dt * 1.2;
      if (now < portalCooldownUntil) { p.standT = 0; continue; }
      const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (d < 1.2 && player.pos.y > p.y - 1 && player.pos.y < p.y + 2.5) {
        p.standT += dt;
        if (Math.random() < 0.3) burst(new THREE.Vector3(p.x, p.y + 0.6, p.z), p.color, 1, 0.2);
        if (p.standT >= 1) {
          // 1초 서 있으면 상대 포털 옆으로 텔레포트
          const o = p.other;
          const lx = clampW(Math.round(o.x + 2)), lz = clampW(Math.round(o.z + 2));
          burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), p.color, 20);
          player.pos.set(lx, topY(lx, lz) + 0.52, lz);
          player.vel.set(0, 0, 0);
          burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), p.color, 20);
          if (window.BQ) BQ.sound('teleport');
          portalCooldownUntil = now + 2500;
          p.standT = 0;
        }
      } else {
        p.standT = 0;
      }
    }
  }

  // ---------- 타임어택 링 (plaza 점프코스 시작/골) ----------
  const courses = [];
  let courseActive = false, courseT0 = 0;
  function makeRing(x, y, z, color) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.09, 8, 20),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
    );
    ring.rotation.x = Math.PI / 2; // 눕힌 링
    ring.position.set(x, y, z);
    scene.add(ring);
    return ring;
  }
  function seedCourses() {
    for (const def of courseDefs) {
      courses.push({
        start: def.start, goal: def.goal,
        startRing: makeRing(def.start.x, def.start.y + 0.7, def.start.z, 0x4cc94c), // 초록 시작 링
        goalRing: makeRing(def.goal.x, def.goal.y + 0.7, def.goal.z, 0xffcf3f), // 골 링
        wasOnStart: false, wasOnGoal: false,
      });
    }
  }
  function nearPlatform(pt) {
    return Math.hypot(player.pos.x - pt.x, player.pos.z - pt.z) < 1.1 &&
      Math.abs(player.pos.y - (pt.y + 0.5)) < 0.9;
  }
  function updateCourses(dt) {
    const now = performance.now();
    for (const c of courses) {
      c.startRing.rotation.z += dt * 1.5;
      c.goalRing.rotation.z += dt * 1.5;
      const onStart = nearPlatform(c.start), onGoal = nearPlatform(c.goal);
      if (onStart && !c.wasOnStart) {
        // 시작 링 밟음 → 타이머 시작 (다시 밟으면 재시작)
        courseActive = true; courseT0 = now;
        burst(new THREE.Vector3(c.start.x, c.start.y + 1, c.start.z), 0x4cc94c, 12, 0.5);
        emit('courseStart');
      }
      if (onGoal && !c.wasOnGoal && courseActive) {
        courseActive = false;
        burst(new THREE.Vector3(c.goal.x, c.goal.y + 1, c.goal.z), 0xffcf3f, 24);
        emit('courseEnd', (now - courseT0) / 1000);
      }
      c.wasOnStart = onStart; c.wasOnGoal = onGoal;
    }
  }

  // ---------- 왕관 (중앙 타워 꼭대기 도달, 쿨다운 30초) ----------
  let crownCooldownUntil = 0;
  function updateCrown() {
    const now = performance.now();
    if (now < crownCooldownUntil) return;
    for (const cp of crownPoints) {
      if (Math.hypot(player.pos.x - cp.x, player.pos.z - cp.z) < 1.2 && player.pos.y > cp.y + 0.3) {
        crownCooldownUntil = now + 30000;
        // 왕관 파티클 연출 (머리 위 금빛 고리)
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          burst(player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 2.2, Math.sin(a) * 0.8)), 0xf5c518, 3, 0.3);
        }
        emit('crowned');
        break;
      }
    }
  }

  // ---------- 낮/밤 사이클 (5분 주기) + 유성 ----------
  const DAY_LEN = 300; // 초
  let worldTime = 0;
  let meteorTimer = 90 + Math.random() * 60; // 90~150초 랜덤
  const meteors = [];
  function getTimeOfDay() { return (worldTime % DAY_LEN) / DAY_LEN; } // 0.5 근처가 밤
  function spawnMeteor() {
    const tx = clampW(Math.floor(Math.random() * 120 - 60));
    const tz = clampW(Math.floor(Math.random() * 120 - 60));
    const gy = topY(tx, tz);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd94f }));
    const pos = new THREE.Vector3(tx + 26, 46, tz - 20);
    m.position.copy(pos);
    scene.add(m);
    const vel = new THREE.Vector3(tx, gy + 0.5, tz).sub(pos).normalize().multiplyScalar(36);
    meteors.push({ mesh: m, vel, tx, tz, gy });
  }
  function updateMeteors(dt) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const mt = meteors[i];
      mt.mesh.position.addScaledVector(mt.vel, dt);
      if (Math.random() < 0.8) burst(mt.mesh.position.clone(), 0xffcf3f, 1, 0.16);
      if (mt.mesh.position.y <= mt.gy + 0.9) {
        scene.remove(mt.mesh);
        mt.mesh.geometry.dispose(); mt.mesh.material.dispose();
        meteors.splice(i, 1);
        const impact = new THREE.Vector3(mt.tx, mt.gy + 1, mt.tz);
        burst(impact, 0xff8c1a, 26);
        burst(impact, 0xf5c518, 18);
        // 떨어진 자리에 gold 블록 1개 로컬 설치 (토스트는 main 담당)
        placeBlock(keyOf(mt.tx, mt.gy + 1, mt.tz), 'gold');
        emit('meteor', { x: mt.tx, z: mt.tz });
      }
    }
  }
  function updateDayNight(dt) {
    worldTime += dt;
    const bright = 0.5 + 0.5 * Math.cos(getTimeOfDay() * Math.PI * 2); // 1=낮, 0=밤 (sin 보간)
    hemi.intensity = 0.25 + 0.8 * bright;
    sun.intensity = 0.1 + 1.0 * bright;
    bgColor.copy(nightColor).lerp(dayColor, bright);
    scene.fog.color.copy(bgColor);
    stars.visible = bright < 0.3; // 밤에만 별
    if (bright < 0.35) {
      meteorTimer -= dt;
      if (meteorTimer <= 0) {
        spawnMeteor();
        meteorTimer = 90 + Math.random() * 60;
      }
    }
    updateMeteors(dt);
  }

  // ---------- 존 추적 ----------
  const zoneChangeCbs = [];
  let playerZone = zoneAt(player.pos.x, player.pos.z); // 매 프레임 캐시
  function onZoneChange(cb) { zoneChangeCbs.push(cb); }
  function getPlayerZone() { return playerZone; }
  function updateZone() {
    const zk = zoneAt(player.pos.x, player.pos.z);
    if (zk !== playerZone) {
      playerZone = zk;
      for (const cb of zoneChangeCbs) cb(zk); // 배경음 전환 등
    }
  }

  // 월드에 의존하는 오브젝트 배치 (모두 결정적 시드)
  seedTreasures();
  seedPortals();
  seedCourses();
  seedAnimals();

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
    updateZone();
    updateCamera(dt);
    updateParticles(dt);
    updateBombs(dt);
    updateProjectiles(dt);
    updateItems(dt);
    updateQuizBlocks(dt);
    updateRemotes(dt);
    updateAnimals(dt);
    updatePortals(dt);
    updateCourses(dt);
    updateCrown();
    updateDayNight(dt);
    updateFireworks(dt);
    updateEmotes();
    updateTreasures();
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
    // 신규 API — 맵/존
    zoneAt, getPlayerZone, onZoneChange,
    // 신규 API — 제트팩/설치/연출/꾸미기
    setJumpHeld, getJetFuel, addJetFuel,
    frontCell, launchFirework, showEmote, setStyle, getTimeOfDay,
    on, onTick,
    keyOf, parseKey,
    dispose: () => { running = false; renderer.dispose(); },
  };
}
