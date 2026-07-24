// BlockQuest 공통 테마 헬퍼: 픽셀 텍스처, 복셀 아바타, 파티클 효과, 8비트 사운드
(function () {
  const BQ = (window.BQ = {});

  // ---------- 시드 랜덤 (텍스처가 매번 같게 보이도록) ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 픽셀 텍스처 생성 ----------
  function makeTile(size, painter, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    painter(ctx, size, mulberry32(seed));
    return c.toDataURL();
  }

  function noiseFill(ctx, size, rnd, colors) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  BQ.applyTextures = function () {
    const dirt = makeTile(16, (ctx, s, r) => noiseFill(ctx, s, r, ['#8a5a2b', '#7c4f24', '#6b4423', '#94633a']), 7);
    const grass = makeTile(16, (ctx, s, r) => {
      noiseFill(ctx, s, r, ['#6fbf44', '#63b33a', '#57a531', '#7bcc50']);
    }, 21);
    const plank = makeTile(16, (ctx, s, r) => {
      noiseFill(ctx, s, r, ['#b8945f', '#b08b57', '#ab8752', '#bd9a66']);
      ctx.fillStyle = '#93714a';
      ctx.fillRect(0, 3, s, 1); ctx.fillRect(0, 8, s, 1); ctx.fillRect(0, 13, s, 1);
    }, 33);
    const stone = makeTile(16, (ctx, s, r) => noiseFill(ctx, s, r, ['#8f8f8f', '#868686', '#7c7c7c', '#989898']), 44);
    const root = document.documentElement.style;
    root.setProperty('--tex-dirt', `url(${dirt})`);
    root.setProperty('--tex-grass', `url(${grass})`);
    root.setProperty('--tex-plank', `url(${plank})`);
    root.setProperty('--tex-stone', `url(${stone})`);
  };

  // ---------- 복셀 아바타 (8x8 픽셀 얼굴) ----------
  // 각 아바타: 팔레트 + 8행 문자열 그리드
  const AVATARS = {
    creeper: {
      label: '크리퍼',
      pal: { g: '#57a531', G: '#6fbf44', d: '#3f7d20', b: '#101010' },
      grid: ['GgGgGGgG', 'gGGgGgGG', 'GbbGGbbG', 'GbbggbbG', 'ggGbbGgg', 'gGbbbbGg', 'GgbbbbgG', 'GgbGGbgG'],
    },
    steve: {
      label: '스티브',
      pal: { h: '#5a3a22', s: '#e8b08c', S: '#dea27c', w: '#ffffff', b: '#3a4fd6', m: '#8c5a42' },
      grid: ['hhhhhhhh', 'hhhhhhhh', 'sSssssSs', 'swbssbws', 'sSssssSs', 'ssmmmmss', 'sSmssmSs', 'ssssssss'],
    },
    pig: {
      label: '돼지',
      pal: { p: '#f0a3a3', P: '#eb9494', n: '#d97b7b', b: '#101010' },
      grid: ['pPpppPpp', 'PppPppPp', 'pbppppbp', 'pbppppbp', 'ppnnnnpp', 'ppnbbnpp', 'ppnnnnpp', 'pPppppPp'],
    },
    zombie: {
      label: '좀비',
      pal: { g: '#6fae61', G: '#63a055', d: '#4a7d40', b: '#101010' },
      grid: ['dGgggGdg', 'gGgGgGgG', 'gbGggGbg', 'gbggggbg', 'gGgggGgG', 'ggbbbbgg', 'gGgbbgGg', 'ggggGggg'],
    },
    skeleton: {
      label: '스켈레톤',
      pal: { w: '#d9d9d9', W: '#cccccc', d: '#a8a8a8', b: '#333333' },
      grid: ['wWwwwWww', 'WwwWwwWw', 'wbwwwwbw', 'wbwwwwbw', 'wWwddwWw', 'wbbbbbbw', 'wWwwwwWw', 'wwwWwwww'],
    },
    fox: {
      label: '여우',
      pal: { o: '#e8863a', O: '#de7c30', w: '#ffffff', b: '#101010', n: '#333333' },
      grid: ['obooooboo', 'oOooooOo', 'oboOOobo', 'oOooooOo', 'owwwwwwo', 'owbwwbwo', 'owwnnwwo', 'oowwwwoo'],
    },
    robot: {
      label: '로봇',
      pal: { s: '#9aa5b1', S: '#8b96a3', c: '#37e0e0', d: '#5a6470', b: '#101010' },
      grid: ['dssssssd', 'sSssssSs', 'sccccccs', 'sccccccs', 'sSssssSs', 'sdbbbbds', 'sSssssSs', 'dssssssd'],
    },
    ender: {
      label: '엔더맨',
      pal: { k: '#1b1b1b', K: '#242424', p: '#c07de8', P: '#a45fd0' },
      grid: ['kKkkkKkk', 'KkkKkkKk', 'kkkkkkkk', 'ppPkkPpp', 'kKkkkKkk', 'kkkKkkkk', 'KkkkkkKk', 'kkKkkkKk'],
    },
  };
  BQ.AVATARS = AVATARS;

  BQ.drawAvatar = function (canvas, name, size) {
    const av = AVATARS[name] || AVATARS.steve;
    const px = 8;
    size = size || canvas.width || 64;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cell = size / px;
    for (let y = 0; y < px; y++) {
      const row = av.grid[y] || '';
      for (let x = 0; x < px; x++) {
        const ch = row[x];
        ctx.fillStyle = av.pal[ch] || av.pal[Object.keys(av.pal)[0]];
        ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  };

  BQ.avatarDataURL = function (name, size) {
    const c = document.createElement('canvas');
    BQ.drawAvatar(c, name, size || 64);
    return c.toDataURL();
  };

  // ---------- 구름 배경 ----------
  BQ.buildWorld = function () {
    if (document.querySelector('.world-bg')) return;
    const bg = document.createElement('div');
    bg.className = 'world-bg';
    for (let i = 0; i < 5; i++) {
      const cl = document.createElement('div');
      cl.className = 'cloud';
      cl.style.top = 6 + i * 11 + '%';
      cl.style.animationDuration = 40 + i * 17 + 's';
      cl.style.animationDelay = -i * 13 + 's';
      cl.style.transform = `scale(${0.7 + (i % 3) * 0.3})`;
      bg.appendChild(cl);
    }
    const ground = document.createElement('div');
    ground.className = 'ground';
    bg.appendChild(ground);
    document.body.prepend(bg);
    BQ.applyTextures();
  };

  // ---------- 파티클 효과 (블록 파괴/XP 오브) ----------
  let fxCanvas, fxCtx, particles = [];
  function ensureFx() {
    if (fxCanvas) return;
    fxCanvas = document.createElement('canvas');
    fxCanvas.id = 'fx-canvas';
    document.body.appendChild(fxCanvas);
    fxCtx = fxCanvas.getContext('2d');
    const resize = () => { fxCanvas.width = innerWidth; fxCanvas.height = innerHeight; };
    addEventListener('resize', resize);
    resize();
    (function loop() {
      requestAnimationFrame(loop);
      if (!particles.length) { fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); return; }
      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= 1;
        fxCtx.globalAlpha = Math.max(p.life / p.maxLife, 0);
        fxCtx.fillStyle = p.color;
        fxCtx.fillRect(p.x, p.y, p.size, p.size);
      }
      fxCtx.globalAlpha = 1;
    })();
  }

  BQ.blockBurst = function (x, y, colors, count) {
    ensureFx();
    colors = colors || ['#6fbf44', '#8a5a2b', '#ffcf3f'];
    for (let i = 0; i < (count || 26); i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 3,
        g: 0.25,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 40 + Math.random() * 20,
        maxLife: 60,
      });
    }
  };

  BQ.floatText = function (x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'float-pts';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (color) el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  };

  // ---------- 8비트 사운드 (WebAudio) ----------
  let audioCtx = null;
  // iOS/크롬은 사용자 제스처 전에는 오디오를 잠근다 — 첫 터치에서 해제
  BQ.unlockAudio = function () {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().then(musicKick).catch(() => { /* 무시 */ });
      else musicKick(); // 이미 해제됨 — 대기 중인 배경음이 있으면 시작
    } catch { /* 무시 */ }
  };
  function beep(freq, dur, type, delay, vol) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch { /* 사운드는 실패해도 무시 */ }
  }
  BQ.sound = function (name) {
    if (name === 'correct') { beep(523, 0.12); beep(659, 0.12, 'square', 0.1); beep(784, 0.2, 'square', 0.2); }
    else if (name === 'wrong') { beep(180, 0.25, 'sawtooth'); beep(140, 0.3, 'sawtooth', 0.12); }
    else if (name === 'click') { beep(700, 0.05, 'square', 0, 0.05); }
    else if (name === 'levelup') { [523, 587, 659, 784, 1047].forEach((f, i) => beep(f, 0.15, 'square', i * 0.09)); }
    else if (name === 'start') { beep(392, 0.15); beep(523, 0.25, 'square', 0.15); }
    else if (name === 'break') { beep(240, 0.08, 'square', 0, 0.06); beep(160, 0.1, 'square', 0.05, 0.06); }
    else if (name === 'place') { beep(300, 0.06, 'square', 0, 0.06); beep(420, 0.08, 'square', 0.05, 0.05); }
    else if (name === 'explosion') { beep(80, 0.5, 'sawtooth', 0, 0.14); beep(60, 0.6, 'sawtooth', 0.05, 0.12); beep(110, 0.3, 'square', 0.02, 0.08); }
    else if (name === 'shoot') { beep(980, 0.07, 'sawtooth', 0, 0.05); beep(620, 0.09, 'sawtooth', 0.04, 0.05); }
    else if (name === 'pickup') { beep(880, 0.08, 'square', 0, 0.06); beep(1175, 0.12, 'square', 0.07, 0.06); }
    else if (name === 'bounce') { beep(220, 0.08, 'square', 0, 0.07); beep(440, 0.1, 'square', 0.05, 0.07); beep(660, 0.12, 'square', 0.1, 0.05); }
    else if (name === 'teleport') { beep(880, 0.08, 'sine', 0, 0.07); beep(587, 0.08, 'sine', 0.06, 0.07); beep(880, 0.08, 'sine', 0.12, 0.06); beep(1175, 0.16, 'sine', 0.18, 0.06); }
    else if (name === 'coin') { beep(988, 0.07, 'square', 0, 0.06); beep(1319, 0.22, 'square', 0.07, 0.06); }
    else if (name === 'firework') { beep(392, 0.06, 'triangle', 0, 0.05); beep(587, 0.06, 'triangle', 0.06, 0.05); beep(784, 0.06, 'triangle', 0.12, 0.05); beep(90, 0.45, 'sawtooth', 0.24, 0.1); beep(1568, 0.2, 'square', 0.28, 0.04); }
    else if (name === 'splash') { beep(520, 0.08, 'sine', 0, 0.05); beep(300, 0.15, 'sawtooth', 0.03, 0.05); beep(180, 0.2, 'sawtooth', 0.09, 0.04); }
    else if (name === 'jet') { beep(110, 0.12, 'sawtooth', 0, 0.04); beep(90, 0.14, 'sawtooth', 0.06, 0.03); }
    else if (name === 'crown') { beep(523, 0.12, 'square', 0, 0.07); beep(659, 0.12, 'square', 0.1, 0.07); beep(784, 0.12, 'square', 0.2, 0.07); beep(1047, 0.35, 'square', 0.3, 0.08); }
    else if (name === 'chicken') { beep(1047, 0.06, 'square', 0, 0.05); beep(1319, 0.06, 'square', 0.08, 0.05); beep(1175, 0.09, 'square', 0.16, 0.05); }
    else if (name === 'pig') { beep(150, 0.1, 'sawtooth', 0, 0.07); beep(120, 0.13, 'sawtooth', 0.09, 0.07); }
    else if (name === 'reward') { beep(784, 0.09, 'square', 0, 0.06); beep(988, 0.09, 'square', 0.07, 0.06); beep(1175, 0.09, 'square', 0.14, 0.06); beep(1568, 0.24, 'square', 0.21, 0.07); }
  };

  // ---------- QR 코드 (클라이언트 생성, 서버 불필요) ----------
  // 벤더링된 qrcode-generator(window.qrcode)로 캔버스에 QR을 그린다.
  // 서버가 없는 정적 사이트(github.io)에서도 학급 접속 QR을 표시할 수 있다.
  BQ.makeQR = function (canvas, text, opts) {
    opts = opts || {};
    if (!window.qrcode || !canvas) return false;
    const scale = opts.scale || 6;                       // 모듈당 픽셀
    const margin = opts.margin != null ? opts.margin : 4; // 여백(모듈 단위, QR 규격 권장 4)
    try {
      const qr = window.qrcode(0, opts.ecc || 'M');
      qr.addData(String(text));
      qr.make();
      const n = qr.getModuleCount();
      const size = (n + margin * 2) * scale;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = opts.bg || '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = opts.fg || '#1d1a16';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
      return true;
    } catch (e) { return false; }
  };

  // ---------- 존별 배경음 (WebAudio 루프 시퀀서) ----------
  // 존마다 음계·템포가 다른 짧은 루프를 오디오 시계 기준 lookahead 방식으로 예약한다.
  // seq/bass: 8분음표 단위 스텝(주파수 Hz, 0은 쉼표). vol은 아주 작게(0.03~0.05).
  const MUSIC_DEFS = {
    plaza: { // 밝은 장조 120bpm
      bpm: 120, wave: 'triangle', vol: 0.045,
      seq: [523, 0, 659, 0, 784, 0, 659, 0, 587, 0, 698, 0, 659, 587, 523, 0],
      bass: [131, 0, 0, 0, 196, 0, 0, 0, 175, 0, 0, 0, 196, 0, 0, 0],
    },
    snowfield: { // 느린 벨소리 80bpm
      bpm: 80, wave: 'sine', vol: 0.05, noteLen: 1.4,
      seq: [988, 0, 0, 0, 784, 0, 0, 0, 880, 0, 0, 0, 659, 0, 0, 0],
      bass: [165, 0, 0, 0, 0, 0, 0, 0, 131, 0, 0, 0, 0, 0, 0, 0],
    },
    desert: { // 이국풍 단조 100bpm
      bpm: 100, wave: 'triangle', vol: 0.04,
      seq: [294, 311, 370, 0, 294, 0, 466, 440, 370, 311, 294, 0, 233, 0, 294, 0],
      bass: [147, 0, 0, 0, 110, 0, 0, 0, 147, 0, 0, 0, 110, 0, 0, 0],
    },
    forest: { // 아르페지오 110bpm
      bpm: 110, wave: 'triangle', vol: 0.04,
      seq: [220, 262, 330, 440, 175, 220, 262, 349, 262, 330, 392, 523, 196, 247, 294, 392],
      bass: [110, 0, 0, 0, 87, 0, 0, 0, 131, 0, 0, 0, 98, 0, 0, 0],
    },
    volcano: { // 낮은 긴장감 90bpm
      bpm: 90, wave: 'sawtooth', vol: 0.03,
      seq: [131, 0, 139, 0, 131, 0, 123, 0, 131, 0, 156, 0, 147, 0, 123, 0],
      bass: [65, 0, 0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0],
    },
  };

  let musicMaster = null; // 배경음 전체 게인 (음소거용)
  let musicTrack = null;  // 현재 재생 중인 트랙 { def, gain, i, next, timer, stopped }
  let musicZone = null;   // 현재(또는 잠금 해제 대기 중인) 존 키
  let musicMuted = false;
  try { musicMuted = localStorage.getItem('bq_muted') === '1'; } catch { /* 무시 */ }

  function musicReady() {
    return !!(audioCtx && audioCtx.state === 'running');
  }

  function ensureMusicMaster() {
    if (!musicMaster) {
      musicMaster = audioCtx.createGain();
      musicMaster.gain.value = musicMuted ? 0 : 1;
      musicMaster.connect(audioCtx.destination);
    }
    return musicMaster;
  }

  // 음표 하나 예약 (짧은 어택 + 지수 감쇠)
  function musicNote(freq, t, dur, wave, dest, vel) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // lookahead 스케줄러: 타이머는 깨우기 용도일 뿐, 실제 박자는 오디오 시계로
  // 0.4초 앞까지 미리 예약한다 (setInterval 박자 방식 아님)
  function musicTick(track) {
    if (track.stopped) return;
    const step = 30 / track.def.bpm; // 8분음표 길이(초)
    const ahead = audioCtx.currentTime + 0.4;
    // 백그라운드 탭 등으로 예약 시각이 밀렸으면 현재 시각으로 재정렬 (몰아치기 방지)
    if (track.next < audioCtx.currentTime - 0.1) track.next = audioCtx.currentTime + 0.05;
    while (track.next < ahead) {
      if (!musicMuted) { // 음소거 중엔 오실레이터를 만들지 않고 박자만 진행
        const d = track.def;
        const m = d.seq[track.i % d.seq.length];
        const b = d.bass[track.i % d.bass.length];
        if (m) musicNote(m, track.next, d.noteLen || step * 0.9, d.wave, track.gain, 1);
        if (b) musicNote(b, track.next, step * 3.2, 'triangle', track.gain, 0.8);
      }
      track.i += 1;
      track.next += step;
    }
    track.timer = setTimeout(() => musicTick(track), 100);
  }

  // 트랙 페이드아웃 후 정리 (크로스페이드의 나가는 쪽)
  function musicFadeOut(track, sec) {
    if (!track) return;
    track.stopped = true;
    clearTimeout(track.timer);
    try {
      const t = audioCtx.currentTime;
      const g = track.gain;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + sec);
      setTimeout(() => { try { g.disconnect(); } catch { /* 무시 */ } }, sec * 1000 + 200);
    } catch { /* 무시 */ }
  }

  function musicStartTrack(zoneKey) {
    const def = MUSIC_DEFS[zoneKey] || MUSIC_DEFS.plaza;
    ensureMusicMaster();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime;
    // 크로스페이드 1초: 새 트랙 0 → vol, 이전 트랙 vol → 0
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(def.vol, t + 1);
    gain.connect(musicMaster);
    musicFadeOut(musicTrack, 1);
    musicTrack = { def, gain, i: 0, next: t + 0.1, timer: null, stopped: false };
    musicTick(musicTrack);
  }

  // 오디오 잠금 해제 후 대기 중인 배경음 시작 (unlockAudio에서 호출)
  function musicKick() {
    if (musicZone && !musicTrack && musicReady()) musicStartTrack(musicZone);
  }

  BQ.music = {
    // 존 배경음 시작/전환 — 잠금 해제 전이면 대기했다가 해제 후 자동 시작
    start(zoneKey) {
      if (zoneKey === musicZone && musicTrack && !musicTrack.stopped) return;
      musicZone = zoneKey;
      if (!musicReady()) {
        // beep 쪽 resume 등으로 상태가 바뀌어도 이어받도록 보험 리스너 (musicKick은 중복 호출에 안전)
        if (audioCtx) audioCtx.addEventListener('statechange', musicKick, { once: true });
        return;
      }
      musicStartTrack(zoneKey);
    },
    stop() {
      musicZone = null;
      musicFadeOut(musicTrack, 0.4);
      musicTrack = null;
    },
    toggleMute() {
      musicMuted = !musicMuted;
      try { localStorage.setItem('bq_muted', musicMuted ? '1' : '0'); } catch { /* 무시 */ }
      if (musicMaster) {
        const t = audioCtx.currentTime;
        musicMaster.gain.cancelScheduledValues(t);
        musicMaster.gain.setValueAtTime(musicMaster.gain.value, t);
        musicMaster.gain.linearRampToValueAtTime(musicMuted ? 0 : 1, t + 0.2);
      }
      return musicMuted;
    },
    get muted() { return musicMuted; },
  };

  // ---------- 기타 ----------
  BQ.esc = function (s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  BQ.fmt = function (n) { return Number(n || 0).toLocaleString('ko-KR'); };
  BQ.level = function (points) { return Math.floor(Math.sqrt((points || 0) / 100)) + 1; };
  BQ.levelProgress = function (points) {
    const lv = BQ.level(points);
    const cur = (lv - 1) ** 2 * 100;
    const next = lv ** 2 * 100;
    return { lv, pct: Math.min(100, Math.round(((points - cur) / (next - cur)) * 100)), next };
  };
})();
