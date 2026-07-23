// 랜딩 페이지: 학생 입장 + 교사 학급 생성/열기
(function () {
  BQ.buildWorld();

  const $ = (id) => document.getElementById(id);
  let selectedAvatar = localStorage.getItem('bq_avatar') || 'steve';

  // URL에 ?code=XXXXXX 가 있으면(QR 접속) 자동으로 채운다
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) $('join-code').value = urlCode.toUpperCase();
  const savedName = localStorage.getItem('bq_name');
  if (savedName) $('join-name').value = savedName;

  // 정적(서버 없음) 실시간 모드 안내
  if (window.BQ_DEMO) {
    $('join-error').style.color = '#1d1a16';
    $('join-error').textContent = '🌐 선생님이 알려준 코드(또는 QR)로 접속하면 친구들과 같은 공간에서 함께 놀 수 있어요! (코드가 없으면 아무 코드나 입력해 혼자 체험)';
    $('teacher-error').textContent = '🌐 선생님: 학급을 만들면 코드/QR이 나오고, 학생들이 접속해 함께 활동합니다. (AI 문제 생성은 서버 실행이 필요)';
  }

  // 아바타 선택 그리드
  const pick = $('avatar-pick');
  for (const [key, av] of Object.entries(BQ.AVATARS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = av.label;
    if (key === selectedAvatar) btn.classList.add('selected');
    const c = document.createElement('canvas');
    BQ.drawAvatar(c, key, 56);
    btn.appendChild(c);
    btn.addEventListener('click', () => {
      selectedAvatar = key;
      localStorage.setItem('bq_avatar', key);
      pick.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      BQ.sound('click');
    });
    pick.appendChild(btn);
  }

  // ---------- 학생 입장 ----------
  $('btn-join').addEventListener('click', async () => {
    const code = $('join-code').value.trim().toUpperCase();
    const name = $('join-name').value.trim();
    $('join-error').textContent = '';
    if (code.length < 4) return ($('join-error').textContent = '학급 코드를 확인해 주세요.');
    if (!name) return ($('join-error').textContent = '닉네임을 입력해 주세요.');
    try {
      const prev = JSON.parse(localStorage.getItem('bq_student') || 'null');
      const res = await fetch('api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code, name, avatar: selectedAvatar,
          studentId: prev && prev.code === code ? prev.studentId : undefined,
          secret: prev && prev.code === code ? prev.secret : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '입장에 실패했습니다.');
      localStorage.setItem('bq_name', name);
      localStorage.setItem('bq_student', JSON.stringify({
        classId: data.classId, studentId: data.student.id, secret: data.student.secret,
        code, name, avatar: selectedAvatar,
      }));
      BQ.sound('start');
      location.href = 'world.html';
    } catch (err) {
      $('join-error').textContent = err.message;
    }
  });
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-name').focus(); });
  $('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

  // ---------- 교사 ----------
  function teacherClasses() {
    return JSON.parse(localStorage.getItem('bq_teacher_classes') || '[]');
  }

  function renderMyClasses() {
    const list = teacherClasses();
    const box = $('my-classes');
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="muted">내 학급</div>';
    for (const c of list) {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML = `<span class="nm">📚 ${BQ.esc(c.name)} <span class="tag">${BQ.esc(c.code)}</span></span>`;
      const open = document.createElement('button');
      open.className = 'btn small gold';
      open.textContent = '열기';
      open.addEventListener('click', () => {
        location.href = `teacher.html?class=${encodeURIComponent(c.classId)}`;
      });
      row.appendChild(open);
      box.appendChild(row);
    }
  }
  renderMyClasses();

  $('btn-create-class').addEventListener('click', async () => {
    const className = $('new-class-name').value.trim();
    $('teacher-error').textContent = '';
    if (!className) return ($('teacher-error').textContent = '학급 이름을 입력해 주세요.');
    try {
      const res = await fetch('api/teacher/classes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          className,
          teacherName: $('new-teacher-name').value.trim(),
          mapKey: $('new-class-map').value, // 선택한 월드 맵 (기본 classic)
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '학급 생성에 실패했습니다.');
      const list = teacherClasses();
      list.unshift({ classId: data.classId, teacherKey: data.teacherKey, name: data.name, code: data.code });
      localStorage.setItem('bq_teacher_classes', JSON.stringify(list));
      BQ.sound('levelup');
      location.href = `teacher.html?class=${encodeURIComponent(data.classId)}`;
    } catch (err) {
      $('teacher-error').textContent = err.message;
    }
  });
})();
