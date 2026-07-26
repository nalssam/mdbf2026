/* 몽당분필 날쌤 · 초등사회 마무리활동 — 허브 SPA (해시 라우터 + 렌더)
   window.MDBF_CURRICULUM (curriculum.js) 을 읽어 화면을 그린다. 빌드 도구/서버 불필요. */
'use strict';
(function () {
  var C = window.MDBF_CURRICULUM;
  var S = window.MDBF_STANDARDS;               // 2022 개정 사회과 성취기준 참고 데이터 (선택)
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function bandLabel(b) { return b === '3-4' ? '3–4학년군' : b === '5-6' ? '5–6학년군' : (b || ''); }
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

  // 단원별 "관련 성취기준 (2022 개정 · 참고)" — window.MDBF_STANDARDS 가 있고 코드가 있을 때만 표시
  function standardsHTML(unit) {
    if (!S || !S.items || !unit.standards || !unit.standards.length) return '';
    var rows = unit.standards.map(function (code) {
      var it = S.items[code];
      if (!it) return '';
      return '' +
        '<li class="std-item">' +
          '<span class="std-code">' + esc(code) + '</span>' +
          '<span class="std-sum">' + esc(it.summary) + '</span>' +
          '<span class="std-unit">' + esc(bandLabel(it.band)) + ' · ' + esc(it.unit) + '</span>' +
        '</li>';
    }).join('');
    if (!rows) return '';
    return '' +
      '<details class="std">' +
        '<summary><span class="std-badge">📎 관련 성취기준</span>' +
          '<span class="std-meta">2022 개정 · 참고 · ' + unit.standards.length + '개</span></summary>' +
        '<ul class="std-list">' + rows + '</ul>' +
        '<p class="std-cap">※ 요약문은 공식 성취기준 문구가 아닌 <b>참고용 요약</b>이며, 현행 단원과의 연결은 ' +
          '<b>가안(검수 필요)</b>입니다. 출처: 교육부 [별책7] 사회과 교육과정(NCIC) · ' +
          'Korean Elementary Learning Map 데이터셋(© DECK6, MIT).</p>' +
      '</details>';
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
        standardsHTML(unit) +
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
        '</b>입니다. 실제 채택 교과서 목차가 확정되면 그에 맞춰 교체됩니다.' +
        (C.meta.standardsNote ? ' ' + esc(C.meta.standardsNote) : '');
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
