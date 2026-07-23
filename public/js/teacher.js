// 교사(관리자) 대시보드
(function () {
  const classId = new URLSearchParams(location.search).get('class');
  const saved = JSON.parse(localStorage.getItem('bq_teacher_classes') || '[]');
  const session = saved.find((c) => c.classId === classId);
  if (!session) { alert('학급 정보를 찾을 수 없습니다. 첫 화면에서 학급을 만들거나 열어 주세요.'); location.href = './'; return; }

  const $ = (id) => document.getElementById(id);

  // 맵(테마) 라벨 — engine.js MAP_DEFS와 같은 키를 쓴다
  const MAP_LABELS = {
    classic: '초원 왕국', desert: '사막 대탐험', snow: '눈의 왕국',
    volcano: '화산 모험', sky: '하늘 섬', ocean: '바다 마을',
  };

  let cls = null;              // GET /api/teacher/classes/:id 결과
  let editingQuiz = null;      // 편집 중인 퀴즈
  let currentMaterial = null;  // 추출된 자료 텍스트
  let liveReloadTimer = null;

  async function api(path, opts = {}) {
    opts.headers = Object.assign({ 'x-teacher-key': session.teacherKey }, opts.headers || {});
    const res = await fetch(`api/teacher/classes/${encodeURIComponent(classId)}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    return data;
  }

  // ---------- 탭 ----------
  const tabs = ['dash', 'quiz', 'live', 'insight'];
  document.querySelectorAll('.t-nav button').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(tab) {
    tabs.forEach((t) => {
      $(`tab-${t}`).classList.toggle('hidden', t !== tab);
      document.querySelector(`.t-nav button[data-tab="${t}"]`).classList.toggle('active', t === tab);
    });
    if (tab === 'live') loadLive();
    if (tab === 'insight') loadInsights();
  }

  // ---------- 대시보드 ----------
  function joinUrl() {
    return `${location.origin}/?code=${cls.code}`;
  }

  function renderDash() {
    $('side-class-name').textContent = cls.name;
    $('dash-teacher').textContent = `${cls.teacherName} 선생님`;
    $('dash-code').textContent = cls.code;
    $('dash-url').value = joinUrl();
    $('dash-qr').src = `api/qr?text=${encodeURIComponent(joinUrl())}`;
    $('dash-map-label').textContent = MAP_LABELS[cls.mapKey] || MAP_LABELS.classic;
    $('map-select').value = MAP_LABELS[cls.mapKey] ? cls.mapKey : 'classic';
    renderStudents();
  }

  function renderStudents() {
    const rows = cls.leaderboard.rankings;
    $('dash-count').textContent = `${rows.length}명`;
    $('dash-total').textContent = BQ.fmt(cls.leaderboard.classTotal);
    $('dash-students').innerHTML = rows.length
      ? rows.map((r) => `
        <div class="lb-row r${r.rank}">
          <span class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
          <img src="${BQ.avatarDataURL(r.avatar, 30)}" width="30" height="30" style="border:2px solid var(--ink)" alt="" />
          <span class="nm">${BQ.esc(r.name)} <span class="dot ${r.online ? 'on' : ''}" title="${r.online ? '접속 중' : '오프라인'}"></span></span>
          <span class="muted" style="font-size:12px">정답 ${r.correct}/${r.answered}</span>
          <span class="pts">${BQ.fmt(r.points)}P</span>
        </div>`).join('')
      : '<div class="muted">아직 입장한 학생이 없습니다. 코드나 QR을 공유해 주세요!</div>';
  }

  $('btn-copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(joinUrl()); $('btn-copy-url').textContent = '복사 완료!'; }
    catch { $('dash-url').select(); document.execCommand('copy'); }
    setTimeout(() => ($('btn-copy-url').textContent = '주소 복사'), 1500);
  });

  // ---------- 맵(테마) 변경 ----------
  $('btn-change-map').addEventListener('click', async () => {
    const mapKey = $('map-select').value;
    const label = MAP_LABELS[mapKey] || mapKey;
    if (cls && (cls.mapKey || 'classic') === mapKey) return alert(`이미 「${label}」 맵을 사용 중이에요.`);
    if (!confirm(`맵을 「${label}」(으)로 변경할까요?\n\n· 학생들이 설치한 블록은 초기화됩니다.\n· 접속 중인 학생 화면은 자동으로 새로고침됩니다.`)) return;
    try {
      await api('/map', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapKey }),
      });
      await loadClass();
      BQ.sound('levelup');
      alert(`맵이 「${label}」(으)로 변경되었습니다. 접속 중인 학생 화면은 자동으로 새로고침돼요.`);
    } catch (err) { alert(err.message); }
  });

  // ---------- QR 전체화면 모달 (프로젝터용) ----------
  function openQrModal() {
    if (!cls) return;
    // 기존 /api/qr 라우트 재사용 (서버가 480px PNG 반환 — CSS로 크게 표시)
    $('qr-modal-img').src = `api/qr?text=${encodeURIComponent(joinUrl())}`;
    $('qr-modal-code').textContent = cls.code;
    $('qr-modal').classList.remove('hidden');
  }
  function closeQrModal() { $('qr-modal').classList.add('hidden'); }
  $('btn-qr-full').addEventListener('click', openQrModal);
  $('qr-modal-close').addEventListener('click', closeQrModal);
  $('qr-modal').addEventListener('click', (e) => { if (e.target === $('qr-modal')) closeQrModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQrModal(); });

  // ---------- 자료 입력 탭 ----------
  document.querySelectorAll('.material-tabs .btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.material-tabs .btn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      ['file', 'url', 'text'].forEach((m) => $(`mtab-${m}`).classList.toggle('hidden', m !== btn.dataset.mtab));
    });
  });

  async function extractMaterial() {
    const active = document.querySelector('.material-tabs .btn.on').dataset.mtab;
    if (active === 'file') {
      const file = $('material-file').files[0];
      if (!file) throw new Error('파일을 선택해 주세요.');
      const fd = new FormData();
      fd.append('file', file);
      return api('/material', { method: 'POST', body: fd });
    }
    if (active === 'url') {
      const url = $('material-url').value.trim();
      if (!url) throw new Error('URL을 입력해 주세요.');
      return api('/material', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    }
    const text = $('material-text').value.trim();
    if (!text) throw new Error('내용을 붙여넣어 주세요.');
    return api('/material', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  // 추출된 자료를 접이식 패널로 보여줘 교사가 AI에 전달될 내용을 확인할 수 있게 한다
  function showMaterialPreview(mat) {
    const status = $('gen-status');
    let pv = document.getElementById('material-preview');
    if (!pv) {
      pv = document.createElement('details');
      pv.id = 'material-preview';
      pv.className = 'muted mt8';
      status.parentNode.insertBefore(pv, status.nextSibling);
    }
    pv.innerHTML =
      `<summary>📄 추출된 자료 확인 — 「${BQ.esc(mat.title)}」 · ${BQ.esc(mat.kind)} · ${BQ.fmt(mat.chars)}자</summary>` +
      `<pre style="white-space:pre-wrap;max-height:180px;overflow:auto;margin-top:6px">${BQ.esc(mat.preview || '')}${mat.chars > (mat.preview || '').length ? '\n…(이하 생략)' : ''}</pre>`;
  }

  $('btn-generate').addEventListener('click', async () => {
    const btn = $('btn-generate');
    const status = $('gen-status');
    btn.disabled = true;
    try {
      status.innerHTML = '<span class="spinner">⛏</span> 자료에서 텍스트를 추출하는 중...';
      currentMaterial = await extractMaterial();
      showMaterialPreview(currentMaterial);
      status.innerHTML = `<span class="spinner">🤖</span> AI가 「${BQ.esc(currentMaterial.title)}」(${BQ.fmt(currentMaterial.chars)}자)를 분석해 학습목표와 문항을 만드는 중...`;
      const { quiz, engine } = await api('/quizzes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceText: currentMaterial.sourceText,
          sourceTitle: currentMaterial.title,
          sourceKind: currentMaterial.kind,
          numQuestions: Number($('num-questions').value),
        }),
      });
      status.textContent = `✅ 퀴즈 생성 완료! (${engine === 'claude' ? 'Claude AI' : '규칙 기반 생성기'}) 아래에서 검토 후 시작하세요.`;
      await loadClass();
      openEditor(quiz);
    } catch (err) {
      status.textContent = '⚠️ ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 퀴즈 편집기 ----------
  function openEditor(quiz) {
    editingQuiz = JSON.parse(JSON.stringify(quiz));
    $('quiz-editor-panel').classList.remove('hidden');
    $('editor-engine').textContent = quiz.engine === 'claude' ? '🤖 Claude AI 생성' : '⚙️ 규칙 기반 생성';
    $('edit-title').value = editingQuiz.title;
    renderObjectiveEditor();
    renderQuestionEditor();
    $('quiz-editor-panel').scrollIntoView({ behavior: 'smooth' });
  }

  function renderObjectiveEditor() {
    $('edit-objectives').innerHTML = editingQuiz.objectives.map((o, i) =>
      `<input class="input mt8 obj-input" data-i="${i}" value="${BQ.esc(o)}" />`).join('');
  }

  function renderQuestionEditor() {
    $('edit-qcount').textContent = `총 ${editingQuiz.questions.length}문항`;
    $('edit-questions').innerHTML = editingQuiz.questions.map((q, qi) => `
      <div class="q-editor" data-qi="${qi}">
        <div class="row">
          <b>${qi + 1}번</b>
          <span class="tag">${q.type === 'ox' ? 'OX' : '4지선다'}</span>
          <span class="tag">${{ easy: '쉬움', medium: '보통', hard: '어려움' }[q.difficulty] || '보통'}</span>
          <span class="grow"></span>
          <button class="btn small danger q-del">삭제</button>
        </div>
        <textarea class="input mt8 q-prompt" rows="2">${BQ.esc(q.prompt)}</textarea>
        <div class="choices">
          ${q.choices.map((c, ci) => `
            <div class="row-choice">
              <input type="radio" name="ans-${qi}" ${ci === q.answerIndex ? 'checked' : ''} value="${ci}" title="정답으로 표시" />
              <input type="text" class="input q-choice" data-ci="${ci}" value="${BQ.esc(c)}" ${q.type === 'ox' ? 'readonly' : ''} />
            </div>`).join('')}
        </div>
        <input type="text" class="input mt8 q-explain" placeholder="해설 (선택)" value="${BQ.esc(q.explanation || '')}" />
      </div>`).join('');
    document.querySelectorAll('.q-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qi = Number(btn.closest('.q-editor').dataset.qi);
        collectEditor();
        editingQuiz.questions.splice(qi, 1);
        renderQuestionEditor();
      });
    });
  }

  function collectEditor() {
    editingQuiz.title = $('edit-title').value.trim() || editingQuiz.title;
    editingQuiz.objectives = [...document.querySelectorAll('.obj-input')].map((i) => i.value.trim()).filter(Boolean);
    document.querySelectorAll('.q-editor').forEach((box) => {
      const qi = Number(box.dataset.qi);
      const q = editingQuiz.questions[qi];
      if (!q) return;
      q.prompt = box.querySelector('.q-prompt').value.trim();
      q.choices = [...box.querySelectorAll('.q-choice')].map((i) => i.value.trim());
      const checked = box.querySelector(`input[name="ans-${qi}"]:checked`);
      q.answerIndex = checked ? Number(checked.value) : q.answerIndex;
      q.explanation = box.querySelector('.q-explain').value.trim();
    });
  }

  async function saveQuiz() {
    collectEditor();
    const { quiz } = await api(`/quizzes/${editingQuiz.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: editingQuiz.title,
        objectives: editingQuiz.objectives,
        questions: editingQuiz.questions,
      }),
    });
    editingQuiz = JSON.parse(JSON.stringify(quiz));
    await loadClass();
    return quiz;
  }

  $('btn-save-quiz').addEventListener('click', async () => {
    try { await saveQuiz(); $('gen-status').textContent = '💾 저장했습니다.'; }
    catch (err) { alert(err.message); }
  });

  $('btn-launch-quiz').addEventListener('click', async () => {
    try {
      const quiz = await saveQuiz();
      await api(`/quizzes/${quiz.id}/launch`, { method: 'POST' });
      await loadClass();
      BQ.sound('start');
      switchTab('live');
    } catch (err) { alert(err.message); }
  });

  // ---------- 퀴즈 목록 ----------
  function renderQuizList() {
    const list = cls.quizzes;
    $('quiz-list').innerHTML = list.length
      ? list.map((q) => `
        <div class="quiz-item" data-id="${q.id}">
          <span class="tag ${q.status === 'live' ? 'live' : q.status}">${{ live: 'LIVE', draft: '준비', closed: '종료' }[q.status]}</span>
          <span class="ttl"><b>${BQ.esc(q.title)}</b> <span class="muted">· ${q.questions.length}문항 · ${q.engine === 'claude' ? 'AI' : '자동'} 생성</span></span>
          <button class="btn small q-edit">편집</button>
          ${q.status === 'live'
            ? '<button class="btn small danger q-close">종료</button>'
            : '<button class="btn small grass q-launch">시작</button>'}
          <button class="btn small stone q-remove">삭제</button>
        </div>`).join('')
      : '<div class="muted">아직 만든 퀴즈가 없습니다. 위에서 자료를 올려 첫 퀴즈를 만들어 보세요!</div>';

    document.querySelectorAll('.quiz-item').forEach((item) => {
      const id = item.dataset.id;
      const quiz = cls.quizzes.find((q) => q.id === id);
      item.querySelector('.q-edit').addEventListener('click', () => openEditor(quiz));
      const launchBtn = item.querySelector('.q-launch');
      if (launchBtn) launchBtn.addEventListener('click', async () => {
        try { await api(`/quizzes/${id}/launch`, { method: 'POST' }); await loadClass(); BQ.sound('start'); switchTab('live'); }
        catch (err) { alert(err.message); }
      });
      const closeBtn = item.querySelector('.q-close');
      if (closeBtn) closeBtn.addEventListener('click', async () => {
        try { await api(`/quizzes/${id}/close`, { method: 'POST' }); await loadClass(); switchTab('insight'); }
        catch (err) { alert(err.message); }
      });
      item.querySelector('.q-remove').addEventListener('click', async () => {
        if (!confirm('이 퀴즈를 삭제할까요? 풀이 기록도 함께 삭제됩니다.')) return;
        try { await api(`/quizzes/${id}`, { method: 'DELETE' }); await loadClass(); }
        catch (err) { alert(err.message); }
      });
    });
  }

  // ---------- 실시간 현황 ----------
  async function loadLive() {
    const data = await api('/live');
    const hasQuiz = Boolean(data.quiz);
    $('live-badge').classList.toggle('hidden', !hasQuiz || data.quiz.status !== 'live');
    $('btn-close-quiz').classList.toggle('hidden', !hasQuiz || data.quiz.status !== 'live');
    $('btn-close-quiz').dataset.quizId = hasQuiz ? data.quiz.id : '';
    if (!hasQuiz) {
      $('live-stats').innerHTML = '';
      $('live-matrix').innerHTML = '';
      $('live-empty').textContent = '진행 중인 퀴즈가 없습니다. [AI 퀴즈] 탭에서 퀴즈를 시작해 보세요.';
      renderLiveBoard();
      return;
    }
    $('live-empty').textContent = '';
    const participated = data.students.filter((s) => s.answers.some(Boolean));
    const completed = data.students.filter((s) => s.completedAt);
    const answeredCells = data.students.flatMap((s) => s.answers.filter(Boolean));
    const correctCells = answeredCells.filter((a) => a.correct);
    $('live-stats').innerHTML =
      BQCharts.statTile({ label: '진행 중인 퀴즈', value: data.quiz.title, sub: `${data.quiz.questionCount}문항` }) +
      BQCharts.statTile({ label: '참여 학생', value: `${participated.length} / ${data.students.length}명` }) +
      BQCharts.statTile({ label: '완료', value: `${completed.length}명` }) +
      BQCharts.statTile({
        label: '실시간 정답률',
        value: answeredCells.length ? Math.round((correctCells.length / answeredCells.length) * 100) + '%' : '-',
        sub: `응답 ${answeredCells.length}건`,
      });

    BQCharts.heatmap($('live-matrix'), {
      rows: data.students.map((s) => ({ label: s.name, online: s.online, score: s.score ? BQ.fmt(s.score) + 'P' : '' })),
      cols: data.students.length ? Array.from({ length: data.quiz.questionCount }, (_, i) => `${i + 1}번`) : [],
      cell: (ri, ci) => {
        const a = data.students[ri].answers[ci];
        if (!a) return { state: 'none', title: '미응답' };
        return {
          state: a.correct ? 'correct' : 'wrong',
          title: `${data.students[ri].name} · ${ci + 1}번 ${a.correct ? '정답' : '오답'} (${(a.timeMs / 1000).toFixed(1)}초)`,
        };
      },
    });
    renderLiveBoard();
  }

  function renderLiveBoard() {
    const rows = cls ? cls.leaderboard.rankings : [];
    $('live-board').innerHTML = rows.length
      ? rows.slice(0, 15).map((r) => `
        <div class="lb-row r${r.rank}">
          <span class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
          <img src="${BQ.avatarDataURL(r.avatar, 30)}" width="30" height="30" style="border:2px solid var(--ink)" alt="" />
          <span class="nm">${BQ.esc(r.name)}</span>
          <span class="pts">${BQ.fmt(r.points)}P</span>
        </div>`).join('')
      : '<div class="muted">아직 학생이 없습니다.</div>';
  }

  $('btn-close-quiz').addEventListener('click', async () => {
    const id = $('btn-close-quiz').dataset.quizId;
    if (!id || !confirm('퀴즈를 종료할까요? 학생들에게 결과 화면이 표시됩니다.')) return;
    try { await api(`/quizzes/${id}/close`, { method: 'POST' }); await loadClass(); switchTab('insight'); }
    catch (err) { alert(err.message); }
  });

  function scheduleLiveReload() {
    if (liveReloadTimer) return;
    liveReloadTimer = setTimeout(() => {
      liveReloadTimer = null;
      if (!$('tab-live').classList.contains('hidden')) loadLive().catch(() => {});
    }, 600);
  }

  // ---------- 인사이트 ----------
  async function loadInsights(quizId) {
    const data = await api(`/insights${quizId ? `?quizId=${encodeURIComponent(quizId)}` : ''}`);
    const sel = $('insight-quiz-select');
    if (!data.quiz) {
      sel.innerHTML = '<option>퀴즈 없음</option>';
      $('insight-stats').innerHTML = '';
      $('insight-notes').innerHTML = '<div class="muted">아직 분석할 퀴즈가 없습니다. 퀴즈를 만들어 진행해 보세요.</div>';
      ['chart-questions', 'chart-objectives', 'chart-mastery', 'insight-matrix'].forEach((id) => ($(id).innerHTML = '<div class="muted">데이터 없음</div>'));
      return;
    }
    sel.innerHTML = data.quizzes.map((q) =>
      `<option value="${q.id}" ${q.id === data.quiz.id ? 'selected' : ''}>${BQ.esc(q.title)} (${{ live: '진행중', draft: '준비', closed: '종료' }[q.status]})</option>`).join('');
    sel.onchange = () => loadInsights(sel.value);

    const acc = data.avgAccuracy;
    $('insight-stats').innerHTML =
      BQCharts.statTile({ label: '참여율', value: data.participation.joined ? `${Math.round((data.participation.participated / data.participation.joined) * 100)}%` : '-', sub: `${data.participation.participated}/${data.participation.joined}명 참여` }) +
      BQCharts.statTile({ label: '평균 정답률', value: acc == null ? '-' : Math.round(acc * 100) + '%', sub: `총 응답 ${data.totalAnswered}건` }) +
      BQCharts.statTile({ label: '완료 학생', value: `${data.participation.completed}명` }) +
      BQCharts.statTile({ label: '보충 필요', value: `${data.masteryCounts.low}명`, sub: '정답률 50% 미만' });

    $('insight-notes').innerHTML = data.notes.length
      ? '<h3 class="mt16">💡 자동 분석</h3>' + data.notes.map((n) => `<div class="note-item">${BQ.esc(n)}</div>`).join('')
      : '';

    BQCharts.hBar($('chart-questions'), {
      items: data.perQuestion.map((q) => ({
        label: `${q.index + 1}번 (${{ easy: '쉬움', medium: '보통', hard: '어려움' }[q.difficulty]})`,
        value: q.correctRate,
        title: `${q.prompt}\n정답률 ${q.correctRate == null ? '-' : Math.round(q.correctRate * 100) + '%'} · 평균 ${q.avgTimeMs ? (q.avgTimeMs / 1000).toFixed(1) + '초' : '-'}`,
      })),
    });

    BQCharts.hBar($('chart-objectives'), {
      items: data.perObjective.map((o, i) => ({
        label: `목표 ${i + 1}`,
        value: o.correctRate,
        title: `${o.objective}\n정답 ${o.correct}/${o.answered}`,
      })),
    });
    $('chart-objectives').insertAdjacentHTML('beforeend',
      '<ol style="font-size:13px;color:#52514e;margin:8px 0 0;padding-left:22px">' +
      data.perObjective.map((o) => `<li>${BQ.esc(o.objective)}</li>`).join('') + '</ol>');

    const m = data.masteryCounts;
    BQCharts.donut($('chart-mastery'), {
      slices: [
        { label: '완전 학습 (80%↑)', value: m.high, color: BQCharts.PAL.status.good, symbol: '✓' },
        { label: '보통 (50~79%)', value: m.mid, color: BQCharts.PAL.status.warning, symbol: '△' },
        { label: '보충 필요 (50%↓)', value: m.low, color: BQCharts.PAL.status.serious, symbol: '!' },
        { label: '미참여', value: m.none, color: BQCharts.PAL.status.none, symbol: '–' },
      ],
      centerTop: `${data.participation.joined}명`,
      centerBottom: '전체 학생',
    });

    // 학생×문항 상세는 live 엔드포인트에서 가져온다
    let liveDetail = null;
    try { liveDetail = await api(`/live?quizId=${encodeURIComponent(data.quiz.id)}`); } catch { /* 무시 */ }
    if (liveDetail && liveDetail.quiz) {
      const byId = Object.fromEntries(liveDetail.students.map((s) => [s.id, s]));
      BQCharts.heatmap($('insight-matrix'), {
        rows: data.perStudent.map((s) => ({ label: s.name, online: Boolean(byId[s.id] && byId[s.id].online), score: `${BQ.fmt(s.score)}P` })),
        cols: Array.from({ length: data.quiz.questionCount }, (_, i) => `${i + 1}번`),
        cell: (ri, ci) => {
          const s = byId[data.perStudent[ri].id];
          const a = s && s.answers[ci];
          if (!a) return { state: 'none', title: '미응답' };
          return { state: a.correct ? 'correct' : 'wrong', title: `${a.correct ? '정답' : '오답'} (${(a.timeMs / 1000).toFixed(1)}초)` };
        },
      });
    } else {
      $('insight-matrix').innerHTML = '<div class="muted">풀이 데이터가 없습니다.</div>';
    }
  }

  // ---------- 데이터 로드 + 소켓 ----------
  let lbUpdatedAt = 0; // 소켓 리더보드가 마지막으로 갱신된 시각

  async function loadClass() {
    const startedAt = Date.now();
    const fresh = await api('');
    // 조회가 진행되는 사이 소켓으로 더 새로운 리더보드가 도착했다면,
    // 오래된 스냅숏이 최신 점수를 덮어쓰지 않게 유지한다 (동시 입장·제출 경쟁 상태 방지)
    if (cls && lbUpdatedAt > startedAt) fresh.leaderboard = cls.leaderboard;
    cls = fresh;
    renderDash();
    renderQuizList();
  }

  // ---------- 정적(서버 없음) 모드: Supabase 실시간으로 학생들과 같은 방을 공유 ----------
  // 서버가 없으므로 AI 생성·자료 업로드는 불가하지만, 학급 코드/QR로 학생들을 한 월드에 모으고
  // 실시간 랭킹을 보며 퀴즈를 시작할 수 있다.
  if (window.BQ_DEMO && window.bqConnectRealtime) {
    cls = {
      id: classId, code: session.code, name: session.name,
      teacherName: session.teacherName || '', mapKey: 'classic', activeQuizId: null,
      students: [], quizzes: [],
      leaderboard: { rankings: [], classTotal: 0, studentCount: 0 },
    };
    renderDash();
    renderQuizList();

    const rnet = window.bqConnectRealtime(
      session.code,
      { studentId: 'teacher-' + Math.random().toString(36).slice(2, 8), name: cls.teacherName || '선생님', avatar: 'robot' },
      true
    );
    if (rnet) {
      rnet.socket.on('leaderboard:update', (data) => {
        cls.leaderboard = data;
        renderStudents();
        if (!$('tab-live').classList.contains('hidden')) renderLiveBoard();
      });
      window.__bqTeacherNet = rnet;
    }

    // 실시간 퀴즈 시작 버튼 (데모 광합성 퀴즈를 모든 접속 학생에게 배포)
    const startBtn = $('btn-rt-quiz');
    if (startBtn) {
      startBtn.classList.remove('hidden');
      startBtn.addEventListener('click', () => {
        if (!rnet) return alert('실시간 연결이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
        const quiz = window.BQ_DEMO_QUIZ;
        rnet.pushQuiz(quiz);
        cls.activeQuizId = quiz.id;
        BQ.sound('start');
        alert('🎮 실시간 퀴즈를 시작했어요!\n접속한 학생들의 월드에 황금 문제 블록이 나타납니다.');
      });
    }
    // 정적 모드 안내
    const note = $('rt-note');
    if (note) note.classList.remove('hidden');
    return; // 서버 소켓/AI 경로는 사용하지 않는다
  }

  const socket = io();
  socket.on('connect', () => {
    socket.emit('join', { classId, role: 'teacher', teacherKey: session.teacherKey });
  });
  socket.on('student:joined', () => loadClass().catch(() => {}));
  socket.on('student:presence', () => loadClass().catch(() => {}));
  socket.on('leaderboard:update', (data) => {
    lbUpdatedAt = Date.now();
    if (cls) { cls.leaderboard = data; renderStudents(); renderLiveBoard(); }
  });
  socket.on('progress:update', () => scheduleLiveReload());
  socket.on('quiz:launched', () => loadClass().catch(() => {}));
  socket.on('quiz:closed', () => loadClass().catch(() => {}));

  loadClass().catch((err) => {
    alert(err.message);
    location.href = './';
  });
})();
