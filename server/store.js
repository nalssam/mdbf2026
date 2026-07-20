// 간단한 JSON 파일 영속화 스토어.
// 교실 규모(수십 명 동시 접속) 트래픽을 가정하므로 메모리 상태 + 디바운스 저장으로 충분하다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const db = { classes: {} };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      Object.assign(db, parsed);
    }
  } catch (err) {
    console.error('[store] DB 로드 실패 — 빈 상태로 시작:', err.message);
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('[store] DB 저장 실패:', err.message);
    }
  }, 300);
}

// 학생이 태블릿에서 입력하기 쉽도록 헷갈리는 글자(0/O, 1/I/L)를 뺀 코드 알파벳
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function newClassCode() {
  let code;
  do {
    code = randomCode(6);
  } while (findClassByCode(code));
  return code;
}

function findClassByCode(code) {
  const norm = String(code || '').trim().toUpperCase();
  return Object.values(db.classes).find((c) => c.code === norm) || null;
}

function getClass(id) {
  return db.classes[id] || null;
}

load();

module.exports = { db, save, randomId, newClassCode, findClassByCode, getClass };
