/* 몽당분필 날쌤 · 초등사회 마무리활동 — 허브 SPA (해시 라우터 + 렌더)
   window.MDBF_CURRICULUM (curriculum.js) 을 읽어 화면을 그린다. 빌드 도구/서버 불필요. */
'use strict';
(function () {
  var C = window.MDBF_CURRICULUM;
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function types() { return C.deliverableTypes; }
  function unitDeliv(unit, key) {
    var d = (unit.deliverables && unit.deliverables[key]) || (C.DEFAULT && C.DEFAULT[key]) || { status: '준비중' };
    return d;
  }
  function isReady(d) { return d && d.status === 'ready' && d.href; }

  function gradeStats(g) {
    var total = 0, ready = 0;
    (g.semesters || []).forEach(function (s) {
      (s.units || []).forEach(function (u) {
        Object.keys(types()).forEach(function (k) {
          total++; if (isReady(unitDeliv(u, k))) ready++;
        });
      });
    });
    return { total: total, ready: ready };
  }

  /* ---------------- routing ---------------- */
  function parseRoute() {
    var h = (location.hash || '').replace(/^#/, '');
    var m = h.match(/^\/grade\/([3-6])$/);
    if (m) return { view: 'grade', grade: Number(m[1]) };
    return { view: 'landing' };
  }

  /* ---------------- views ---------------- */
  function renderLanding() {
    var cards = (C.grades || []).map(function (g) {
      var st = gradeStats(g);
      var readyTxt = st.ready > 0
        ? '<span class="g-ready">공개 ' + st.ready + '개</span> · 준비중 ' + (st.total - st.ready) + '개'
        : '준비중 ' + st.total + '개';
      return '' +
        '<a class="grade-card" href="#/grade/' + g.grade + '">' +
          '<span class="g-emoji">🎒</span>' +
          '<span class="g-title">' + g.grade + '학년</span>' +
          '<span class="g-meta">' + readyTxt + '</span>' +
        '</a>';
    }).join('');

    app.innerHTML =
      '<div class="hero">' +
        '<h1>' + esc(C.meta.title) + '</h1>' +
        '<p>' + esc(C.meta.subtitle) + '</p>' +
      '</div>' +
      '<div class="section-label">학년 선택</div>' +
      '<div class="grade-grid">' + cards + '</div>';
  }

  function tileHTML(unit, key) {
    var t = types()[key];
    var d = unitDeliv(unit, key);
    var ready = isReady(d);
    var inner =
      '<span class="t-emoji">' + t.emoji + '</span>' +
      '<span class="t-label">' + esc(t.label) + '</span>' +
      (d.note ? '<span class="t-note">' + esc(d.note) + '</span>' : '') +
      '<span class="t-status">' + (ready ? '이용하기' : '준비 중') + '</span>';
    if (ready) {
      return '<a class="tile ready" href="' + esc(d.href) + '">' + inner + '</a>';
    }
    return '<div class="tile pending" aria-disabled="true">' + inner + '</div>';
  }

  function unitHTML(unit) {
    var tiles = Object.keys(types()).map(function (k) { return tileHTML(unit, k); }).join('');
    return '' +
      '<div class="unit-card">' +
        '<div class="unit-head">' +
          '<span class="unit-no">' + esc(unit.id) + '</span>' +
          '<span class="unit-title">' + esc(unit.title) + '</span>' +
        '</div>' +
        '<div class="tiles">' + tiles + '</div>' +
      '</div>';
  }

  function renderGrade(n) {
    var g = (C.grades || []).find(function (x) { return x.grade === n; });
    if (!g) { location.hash = '#/'; return; }
    var body = (g.semesters || []).map(function (s) {
      var units = (s.units || []).map(unitHTML).join('');
      return '<div class="section-label">' + s.semester + '학기</div>' + units;
    }).join('');

    app.innerHTML =
      '<div class="breadcrumb"><a href="#/">전체 학년</a><span>›</span><span>' + n + '학년</span></div>' +
      '<div class="hero"><h1>' + n + '학년 사회 · 단원 마무리 활동</h1></div>' +
      body;
  }

  /* ---------------- boot ---------------- */
  function route() {
    var r = parseRoute();
    if (r.view === 'grade') renderGrade(r.grade); else renderLanding();
    window.scrollTo({ top: 0 });
  }

  // header content from meta
  function initChrome() {
    var brand = document.querySelector('header .brand');
    if (brand) brand.innerHTML = esc((C.meta.title || '').split(' · ')[0] || '몽당분필 날쌤') +
      '<small>' + esc(((C.meta.title || '').split(' · ')[1]) || '초등사회 마무리활동') + '</small>';
    var badge = document.getElementById('memberBadge');
    if (badge && C.meta.memberNote) {
      badge.textContent = '🔒 ' + C.meta.memberNote;
      if (C.meta.memberLink) { badge.setAttribute('href', C.meta.memberLink); }
      badge.style.display = 'inline-flex';
    }
    var banner = document.getElementById('provisional');
    if (banner && C.meta.provisional) {
      banner.innerHTML = '📝 <b>안내</b> — 현재 단원 목록은 <b>' + esc(C.meta.curriculumVersion || '가안') +
        '</b>입니다. 실제 채택 교과서 목차가 확정되면 그에 맞춰 교체됩니다.';
      banner.style.display = 'block';
    }
  }

  if (!C) {
    app.innerHTML = '<div class="provisional">curriculum.js 를 불러오지 못했습니다.</div>';
    return;
  }
  initChrome();
  window.addEventListener('hashchange', route);
  route();
})();
