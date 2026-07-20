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
  function beep(freq, dur, type, delay, vol) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
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
