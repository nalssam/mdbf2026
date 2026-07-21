// 수업 자료(PPT/PDF/Excel/DOCX/텍스트/URL/유튜브)에서 퀴즈 생성용 텍스트를 뽑아낸다.
const path = require('path');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

const MAX_TEXT_CHARS = 60000; // AI 프롬프트에 넣을 최대 길이

// 422: 자료 내용 문제(사용자가 자료를 바꿔야 함), 502: 외부 페이지 연결 실패
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function clamp(text) {
  const cleaned = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > MAX_TEXT_CHARS ? cleaned.slice(0, MAX_TEXT_CHARS) : cleaned;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)[1]);
      const nb = Number(b.match(/slide(\d+)\.xml/)[1]);
      return na - nb;
    });
  const parts = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const slideNo = name.match(/slide(\d+)\.xml/)[1];
    if (texts.length) parts.push(`[슬라이드 ${slideNo}]\n${texts.join('\n')}`);
  }
  return parts.join('\n\n');
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.files['word/document.xml'];
  if (!doc) return '';
  const xml = await doc.async('string');
  // 문단 경계를 살려서 텍스트를 이어붙인다
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => decodeXmlEntities(t))
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n');
}

// 표를 원시 CSV가 아니라 "머리글: 값" 서술형 문장으로 바꿔서
// AI/휴리스틱 생성기가 자연스러운 문항을 만들 수 있게 한다.
function sheetToProse(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    .map((r) => r.map((c) => String(c).trim()))
    .filter((r) => r.some(Boolean));
  if (!rows.length) return '';
  const header = rows[0];
  const looksLikeHeader =
    rows.length >= 2 && header.filter(Boolean).length >= 2 && header.every((c) => !c || !/^\d+([.,]\d+)?$/.test(c));
  if (!looksLikeHeader) {
    return rows.map((r) => r.filter(Boolean).join(' ')).join('\n');
  }
  const lines = [];
  for (const row of rows.slice(1)) {
    const subject = row[0];
    const rest = header
      .slice(1)
      .map((h, i) => (row[i + 1] ? `${h || '항목'}: ${row[i + 1]}` : ''))
      .filter(Boolean)
      .join(' / ');
    if (subject && rest) lines.push(`${header[0]} '${subject}' — ${rest}`);
    else if (subject || rest) lines.push(subject || rest);
  }
  return lines.join('\n');
}

// 텍스트 계열 파일 인코딩 처리: BOM → UTF-8 → EUC-KR(한국 엑셀 CSV 기본값) 순으로 시도
function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr').decode(buffer);
  } catch {
    return utf8;
  }
}

function extractSpreadsheet(buffer, isCsv) {
  const wb = isCsv
    ? XLSX.read(decodeTextBuffer(buffer), { type: 'string' })
    : XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const prose = sheetToProse(wb.Sheets[sheetName]).trim();
    if (prose) parts.push(`[시트: ${sheetName}]\n${prose}`);
  }
  return parts.join('\n\n');
}

async function extractFromFile(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  let text = '';
  let kind = ext.replace('.', '') || 'file';
  if (ext === '.pdf') {
    const parsed = await pdfParse(buffer);
    // 인쇄 줄바꿈으로 잘린 긴 문장을 이어 붙인다 (짧은 제목 줄은 병합하지 않음)
    text = parsed.text.replace(/([^\n]{25,}[가-힣]) *\n(?=[가-힣])/g, '$1');
  } else if (ext === '.pptx') {
    text = await extractPptx(buffer);
  } else if (ext === '.docx') {
    text = await extractDocx(buffer);
  } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    text = extractSpreadsheet(buffer, ext === '.csv');
  } else if (ext === '.txt' || ext === '.md') {
    text = decodeTextBuffer(buffer);
  } else {
    throw fail(422, `지원하지 않는 파일 형식입니다: ${ext || '(확장자 없음)'} — PDF, PPTX, XLSX, DOCX, TXT를 사용해 주세요.`);
  }
  text = clamp(text);
  if (!text) throw fail(422, '파일에서 텍스트를 추출하지 못했습니다. 텍스트가 포함된 자료인지 확인해 주세요.');
  return { text, kind, title: path.basename(originalName, ext) };
}

function parseYoutubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

async function fetchWithTimeout(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (BlockQuest-Edu material fetcher)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function extractYoutube(url) {
  const parts = [];
  let title = '유튜브 영상';
  try {
    const oembedRes = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (oembedRes.ok) {
      const meta = await oembedRes.json();
      title = meta.title || title;
      parts.push(`영상 제목: ${meta.title}`, `채널: ${meta.author_name}`);
    }
  } catch { /* oEmbed 실패 시 페이지 파싱으로 넘어간다 */ }
  try {
    const pageRes = await fetchWithTimeout(url);
    const html = await pageRes.text();
    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (descMatch) {
      const desc = JSON.parse(`"${descMatch[1]}"`);
      if (desc.trim()) parts.push(`영상 설명:\n${desc}`);
    }
    const kwMatch = html.match(/"keywords":\[((?:"[^"]*",?)+)\]/);
    if (kwMatch) parts.push(`키워드: ${kwMatch[1].replace(/"/g, '')}`);
  } catch { /* 설명 추출은 선택 사항 */ }
  if (!parts.length) {
    throw fail(502, '유튜브 영상 정보를 가져오지 못했습니다. 영상 내용을 텍스트로 붙여넣어 주세요.');
  }
  parts.push('\n(참고: 자막 전문이 아닌 영상 메타데이터 기반입니다. 더 정확한 퀴즈를 원하면 스크립트를 직접 붙여넣어 주세요.)');
  return { text: clamp(parts.join('\n')), kind: 'youtube', title };
}

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');
  // 본문 영역이 있으면 우선 사용
  const article = s.match(/<article[\s\S]*?<\/article>/i) || s.match(/<main[\s\S]*?<\/main>/i);
  if (article) s = article[0];
  s = s
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeXmlEntities(s).replace(/ /g, ' ');
}

async function extractFromUrl(url) {
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) throw fail(422, 'http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.');
  if (parseYoutubeId(trimmed)) return extractYoutube(trimmed);
  let res;
  try {
    res = await fetchWithTimeout(trimmed);
  } catch {
    throw fail(502, '페이지에 연결하지 못했습니다. 주소를 확인하거나 잠시 후 다시 시도해 주세요.');
  }
  if (!res.ok) throw fail(502, `페이지를 불러오지 못했습니다 (HTTP ${res.status}).`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = clamp(htmlToText(html));
  if (text.length < 100) {
    throw fail(422, '페이지에서 충분한 본문을 추출하지 못했습니다. 기사 내용을 직접 붙여넣어 주세요.');
  }
  return {
    text,
    kind: 'article',
    title: titleMatch ? decodeXmlEntities(titleMatch[1]).trim().slice(0, 80) : '웹 문서',
  };
}

function extractFromText(raw, title) {
  const text = clamp(raw);
  if (text.length < 30) throw fail(422, '퀴즈를 만들기에는 내용이 너무 짧습니다. 30자 이상 입력해 주세요.');
  return { text, kind: 'text', title: title || '붙여넣은 자료' };
}

module.exports = { extractFromFile, extractFromUrl, extractFromText, MAX_TEXT_CHARS };
