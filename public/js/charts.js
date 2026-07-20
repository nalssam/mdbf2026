// 교사 인사이트용 경량 SVG 차트 (외부 라이브러리 없음)
// 팔레트는 접근성 검증(색각 이상 대비 포함)을 거친 기본값을 사용한다.
(function () {
  const C = (window.BQCharts = {});

  const PAL = {
    surface: '#fcfcfb',
    inkPrimary: '#0b0b0b',
    inkSecondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    baseline: '#c3c2b7',
    series1: '#2a78d6', // 파랑 (기본 계열색)
    status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', none: '#e1e0d9' },
  };
  C.PAL = PAL;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 가로 막대 차트 (정답률 등 크기 비교) ----------
  // items: [{label, value(0~1|null), display, title}]
  C.hBar = function (el, { items, format }) {
    format = format || ((v) => Math.round(v * 100) + '%');
    const rowH = 30;
    const labelW = 150;
    const valueW = 52;
    const w = Math.max(el.clientWidth || 560, 360);
    const chartW = w - labelW - valueW - 8;
    const h = items.length * rowH + 14;
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" style="background:${PAL.surface};font-family:system-ui,sans-serif">`;
    // 눈금선 25/50/75/100%
    for (const g of [0.25, 0.5, 0.75, 1]) {
      const x = labelW + chartW * g;
      svg += `<line x1="${x}" y1="4" x2="${x}" y2="${h - 10}" stroke="${PAL.grid}" stroke-width="1"/>`;
    }
    items.forEach((it, i) => {
      const y = i * rowH + 8;
      const val = it.value == null ? 0 : Math.max(0, Math.min(1, it.value));
      const bw = Math.max(chartW * val, it.value == null ? 0 : 2);
      svg += `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" font-size="12" fill="${PAL.inkSecondary}">${esc(it.label)}</text>`;
      svg += `<line x1="${labelW}" y1="${y}" x2="${labelW}" y2="${y + 22}" stroke="${PAL.baseline}" stroke-width="1"/>`;
      if (it.value == null) {
        svg += `<text x="${labelW + 6}" y="${y + 15}" font-size="11" fill="${PAL.muted}">응답 없음</text>`;
      } else {
        svg += `<rect x="${labelW}" y="${y + 3}" width="${bw}" height="16" rx="4" fill="${it.color || PAL.series1}"><title>${esc(it.title || it.label)}</title></rect>`;
        svg += `<text x="${labelW + bw + 6}" y="${y + 15}" font-size="12" fill="${PAL.inkPrimary}">${esc(it.display || format(val))}</text>`;
      }
    });
    svg += '</svg>';
    el.innerHTML = svg;
  };

  // ---------- 도넛 차트 (구성 비율) ----------
  // slices: [{label, value, color, symbol}]
  C.donut = function (el, { slices, centerTop, centerBottom }) {
    const total = slices.reduce((t, s) => t + s.value, 0);
    const size = 190, cx = size / 2, cy = size / 2, r = 72, thick = 30;
    let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" style="font-family:system-ui,sans-serif">`;
    if (total === 0) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${r - thick / 2}" fill="none" stroke="${PAL.grid}" stroke-width="${thick}"/>`;
    } else {
      let angle = -Math.PI / 2;
      for (const s of slices) {
        if (!s.value) continue;
        const frac = s.value / total;
        const a2 = angle + frac * Math.PI * 2;
        const large = frac > 0.5 ? 1 : 0;
        const rr = r - thick / 2;
        const x1 = cx + rr * Math.cos(angle), y1 = cy + rr * Math.sin(angle);
        const x2 = cx + rr * Math.cos(a2 - 0.0001), y2 = cy + rr * Math.sin(a2 - 0.0001);
        if (frac >= 0.999) {
          svg += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${s.color}" stroke-width="${thick}"><title>${esc(s.label)}: ${s.value}명</title></circle>`;
        } else {
          svg += `<path d="M ${x1} ${y1} A ${rr} ${rr} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${s.color}" stroke-width="${thick}" stroke-linecap="butt"><title>${esc(s.label)}: ${s.value}명</title></path>`;
        }
        // 조각 사이 2px 간격 (표면색 링)
        svg += `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(angle)}" y2="${cy + r * Math.sin(angle)}" stroke="${PAL.surface}" stroke-width="2"/>`;
        angle = a2;
      }
    }
    svg += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="24" font-weight="700" fill="${PAL.inkPrimary}">${esc(centerTop || total)}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="11" fill="${PAL.inkSecondary}">${esc(centerBottom || '')}</text>`;
    svg += '</svg>';

    // 범례 (아이콘 + 라벨 + 값 — 색만으로 의미를 전달하지 않는다)
    let legend = '<div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:' + PAL.inkSecondary + '">';
    for (const s of slices) {
      legend += `<div style="display:flex;align-items:center;gap:8px">
        <span style="width:12px;height:12px;background:${s.color};border-radius:3px;display:inline-block"></span>
        <span>${esc(s.symbol || '')} ${esc(s.label)}</span>
        <strong style="color:${PAL.inkPrimary}">${s.value}명</strong>
      </div>`;
    }
    legend += '</div>';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">${svg}${legend}</div>`;
  };

  // ---------- 히트맵 (학생 × 문항 풀이 현황) ----------
  // 상태는 색 + 기호(✓/✗/·)로 이중 표기해 색각 이상에도 안전하다.
  C.heatmap = function (el, { rows, cols, cell }) {
    const cellStyle = 'width:34px;height:30px;text-align:center;border:1px solid ' + PAL.grid + ';font-size:13px;';
    let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-family:system-ui,sans-serif;background:${PAL.surface}">`;
    html += `<thead><tr><th style="text-align:left;padding:4px 10px;font-size:12px;color:${PAL.inkSecondary};min-width:110px">학생</th>`;
    cols.forEach((c) => {
      html += `<th style="${cellStyle}color:${PAL.inkSecondary};font-weight:600">${esc(c)}</th>`;
    });
    html += `<th style="${cellStyle}color:${PAL.inkSecondary};font-weight:600;min-width:56px">점수</th></tr></thead><tbody>`;
    rows.forEach((r, ri) => {
      html += `<tr><td style="padding:4px 10px;font-size:13px;color:${PAL.inkPrimary};white-space:nowrap">${r.online ? '🟢' : '⚪'} ${esc(r.label)}</td>`;
      cols.forEach((_, ci) => {
        const info = cell(ri, ci) || { state: 'none' };
        const map = {
          correct: { bg: '#d9f2d9', fg: '#0a5d0a', sym: '✓' },
          wrong: { bg: '#f9dcdc', fg: '#8f2222', sym: '✗' },
          none: { bg: PAL.surface, fg: PAL.muted, sym: '·' },
        };
        const m = map[info.state] || map.none;
        html += `<td style="${cellStyle}background:${m.bg};color:${m.fg};font-weight:700" title="${esc(info.title || '')}">${m.sym}</td>`;
      });
      html += `<td style="${cellStyle}font-weight:700;color:${PAL.inkPrimary}">${esc(r.score ?? '')}</td></tr>`;
    });
    html += '</tbody></table></div>';
    html += `<div style="font-size:12px;color:${PAL.inkSecondary};margin-top:6px">✓ 정답 · ✗ 오답 · <span style="color:${PAL.muted}">·</span> 미응답</div>`;
    el.innerHTML = html;
  };

  // ---------- 스탯 타일 ----------
  C.statTile = function ({ label, value, sub }) {
    return `<div style="background:${PAL.surface};border:1px solid ${PAL.grid};border-radius:10px;padding:14px 16px;min-width:130px;flex:1">
      <div style="font-size:12px;color:${PAL.inkSecondary}">${esc(label)}</div>
      <div style="font-size:28px;font-weight:700;color:${PAL.inkPrimary};margin-top:2px">${esc(value)}</div>
      ${sub ? `<div style="font-size:12px;color:${PAL.muted};margin-top:2px">${esc(sub)}</div>` : ''}
    </div>`;
  };
})();
