// AI 퀴즈 생성: 수업 자료 텍스트 → 학습목표 + 평가 문항.
// ANTHROPIC_API_KEY가 있으면 Claude API(structured outputs)를 사용하고,
// 없으면 규칙 기반 폴백 생성기로 동작해 데모/오프라인 환경에서도 플랫폼이 돌아간다.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '퀴즈 제목 (자료 주제를 반영, 한국어)' },
    summary: { type: 'string', description: '자료 핵심 내용 2~3문장 요약 (한국어)' },
    objectives: {
      type: 'array',
      description: '학생이 도달해야 할 학습목표 3~5개 (한국어, "~할 수 있다" 형식)',
      items: { type: 'string' },
    },
    questions: {
      type: 'array',
      description: '평가 문항 목록',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['mcq', 'ox'], description: 'mcq=4지선다, ox=참/거짓' },
          prompt: { type: 'string', description: '문항 질문 (한국어)' },
          choices: {
            type: 'array',
            description: 'mcq는 보기 4개, ox는 ["O", "X"] 정확히 2개',
            items: { type: 'string' },
          },
          answerIndex: { type: 'integer', description: '정답 보기의 인덱스 (0부터)' },
          explanation: { type: 'string', description: '정답 해설 1~2문장 (한국어)' },
          objectiveIndex: { type: 'integer', description: '이 문항이 평가하는 학습목표의 인덱스 (0부터)' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
        required: ['type', 'prompt', 'choices', 'answerIndex', 'explanation', 'objectiveIndex', 'difficulty'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'objectives', 'questions'],
  additionalProperties: false,
};

async function generateWithClaude({ sourceText, title, numQuestions }) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system:
      '당신은 초·중·고 수업 설계 전문가입니다. 교사가 올린 수업 자료를 분석해 ' +
      '학생이 도달해야 할 학습목표와 이를 평가하는 퀴즈 문항을 만듭니다. ' +
      '문항은 자료의 핵심 개념을 겨냥하고, 오답 보기는 그럴듯한 오개념으로 구성하세요. ' +
      '난이도는 easy/medium/hard를 골고루 섞고, 모든 텍스트는 한국어로 작성하세요.',
    messages: [
      {
        role: 'user',
        content:
          `다음 수업 자료를 분석해서 학습목표 3~5개와 평가 문항 ${numQuestions}개를 만들어 주세요.\n` +
          `문항은 4지선다(mcq) 위주로 하되 1~2개는 OX(ox) 문항으로 섞어 주세요.\n` +
          `ox 문항의 choices는 정확히 ["O","X"]로 하세요.\n\n` +
          `자료 제목: ${title || '(제목 없음)'}\n` +
          `--- 자료 시작 ---\n${sourceText}\n--- 자료 끝 ---`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: QUIZ_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('AI가 이 자료로는 퀴즈를 생성할 수 없다고 판단했습니다. 다른 자료를 사용해 주세요.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('AI 응답에서 결과를 찾지 못했습니다.');
  return JSON.parse(textBlock.text);
}

// ---------- 규칙 기반 폴백 생성기 (API 키 없는 환경용) ----------

const STOPWORDS = new Set([
  '그리고', '그러나', '하지만', '또한', '있다', '있는', '것이', '것은', '것을', '수', '등', '및',
  '위해', '통해', '대한', '대해', '이런', '그런', '저런', '되는', '된다', '한다', '하는', '하여',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'that', 'this',
]);

// 어절 끝 조사(긴 것부터 검사) — 제거 후 어간이 2자 이상 남을 때만 벗긴다
const JOSA_RE = /(에서부터|으로부터|이라고는|이라고|이라는|라고는|에게서|한테서|으로써|으로서|처럼|보다|부터|까지|에서|에게|한테|으로|이나|이란|이며|은|는|이|가|을|를|의|에|와|과|도|만|랑|로|란|며)$/;
// 서술어·용언 활용형으로 끝나는 어절은 핵심 용어(명사) 후보에서 제외한다
const PREDICATE_RE = /(습니다|입니다|합니다|됩니다|있습니다|없습니다|었습니다|았습니다|했습니다|하였다|되었다|한다|된다|이다|하다|되다|하며|되며|하고|되고|하여|되어|해서|면서|지만|려고|어요|아요|해요|지요|네요|는데|다는|라는|거나|나면)$/;

function splitSentences(text) {
  // 문장 부호 또는 줄바꿈에서만 나눈다 ('~보다 ' 같은 문중 어절에서 잘리지 않도록)
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 200 && !/^\[/.test(s));
}

function tokenize(sentence) {
  return (sentence.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter((w) => !STOPWORDS.has(w.toLowerCase()));
}

// 어절 → 명사형 어간 (서술어형이면 null). 겹조사('태양에서의' 등)까지 반복 제거한다.
function stemOf(word) {
  if (PREDICATE_RE.test(word)) return null;
  let stem = word;
  for (let i = 0; i < 3; i++) {
    const m = stem.match(JOSA_RE);
    if (!m || stem.length - m[0].length < 2) break;
    stem = stem.slice(0, stem.length - m[0].length);
  }
  if (stem.length < 2 || STOPWORDS.has(stem.toLowerCase())) return null;
  return stem;
}

function sentenceStems(sentence) {
  return new Set(tokenize(sentence).map(stemOf).filter(Boolean));
}

function keywordFrequency(sentences) {
  const freq = new Map();
  for (const s of sentences) {
    for (const w of tokenize(s)) {
      const stem = stemOf(w);
      if (stem) freq.set(stem, (freq.get(stem) || 0) + 1);
    }
  }
  return freq;
}

// 문장에서 빈칸으로 만들 어절을 고른다: 자료 전체에서 자주 나오는(=핵심 개념) 어간 우선.
// 조사는 빈칸 밖에 남겨 문법 단서 없이 자연스러운 문장을 유지하고,
// 이미 다른 문항의 정답으로 쓴 어간은 피해서 문항이 단조로워지지 않게 한다.
function pickBlank(sentence, freq, usedStems) {
  let best = null;
  let bestFresh = null;
  for (const w of tokenize(sentence)) {
    const stem = stemOf(w);
    if (!stem || !freq.has(stem)) continue;
    const cand = { word: w, stem, josa: w.slice(stem.length), score: (freq.get(stem) || 0) * stem.length };
    if (!best || cand.score > best.score) best = cand;
    if (usedStems && !usedStems.has(stem) && (!bestFresh || cand.score > bestFresh.score)) bestFresh = cand;
  }
  return bestFresh || best;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateHeuristic({ sourceText, title, numQuestions }) {
  const sentences = splitSentences(sourceText);
  if (sentences.length < 3) {
    throw new Error('자료가 너무 짧아 퀴즈를 만들 수 없습니다. 더 긴 자료를 사용해 주세요.');
  }
  const freq = keywordFrequency(sentences);
  const topKeywords = [...freq.entries()]
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
    .slice(0, 20)
    .map(([w]) => w);

  // 핵심 문장: 상위 키워드를 많이 포함한 문장 순으로 고른다
  const scored = sentences
    .map((s, i) => ({
      s,
      i,
      score: tokenize(s).filter((w) => topKeywords.includes(w)).length + Math.min(s.length / 60, 2),
    }))
    .sort((a, b) => b.score - a.score);

  const objectives = [
    `${title || '이 자료'}의 핵심 개념을 설명할 수 있다.`,
    `자료에 제시된 주요 용어(${topKeywords.slice(0, 3).join(', ')})의 의미를 이해할 수 있다.`,
    '자료의 내용을 바탕으로 참·거짓을 판별할 수 있다.',
  ];

  const questions = [];
  const usedSentences = new Set();
  const usedBlankStems = new Set();
  const mcqCount = Math.max(1, numQuestions - Math.min(2, Math.floor(numQuestions / 4)));

  for (const { s, i } of scored) {
    if (questions.length >= mcqCount) break;
    if (usedSentences.has(i)) continue;
    const blank = pickBlank(s, freq, usedBlankStems);
    if (!blank) continue;
    const stems = sentenceStems(s);
    const distractorPool = topKeywords.filter((k) => k !== blank.stem && !stems.has(k));
    if (distractorPool.length < 3) continue;
    usedSentences.add(i);
    usedBlankStems.add(blank.stem);
    const distractors = shuffle(distractorPool).slice(0, 3);
    const choices = shuffle([blank.stem, ...distractors]);
    questions.push({
      type: 'mcq',
      prompt: `다음 빈칸에 들어갈 알맞은 말은?\n"${s.replace(blank.word, `( ____ )${blank.josa}`)}"`,
      choices,
      answerIndex: choices.indexOf(blank.stem),
      explanation: `자료 원문: "${s}"`,
      objectiveIndex: questions.length % 2,
      difficulty: ['easy', 'medium', 'hard'][questions.length % 3],
    });
  }

  // OX 문항: 원문 그대로(O) 또는 핵심 어간을 다른 개념으로 바꾼 문장(X).
  // 조사를 보존해 문법만으로 정답이 드러나지 않게 하고, 안전한 치환이 없으면 O 문항으로 폴백한다.
  for (const { s, i } of scored) {
    if (questions.length >= numQuestions) break;
    if (usedSentences.has(i)) continue;
    if (!/[.!?]$|[다요]$/.test(s)) continue; // 완결된 문장만 OX 지문으로 사용
    usedSentences.add(i);
    let makeFalse = questions.length % 2 === 1;
    let prompt = s;
    if (makeFalse) {
      const blank = pickBlank(s, freq);
      const stems = blank ? sentenceStems(s) : null;
      const swap = blank ? topKeywords.find((k) => k !== blank.stem && !stems.has(k)) : null;
      if (blank && swap) {
        // 치환어 끝의 주제격 조사(은/는)가 원래 조사와 겹치면 벗겨서 비문을 막는다 ('물은'+'을' → '물을')
        const swapForm = blank.josa && /[은는]$/.test(swap) && swap.length >= 2 ? swap.slice(0, -1) : swap;
        prompt = s.replace(blank.word, `${swapForm}${blank.josa}`);
      } else makeFalse = false;
    }
    questions.push({
      type: 'ox',
      prompt: `다음 설명이 맞으면 O, 틀리면 X를 고르세요.\n"${prompt}"`,
      choices: ['O', 'X'],
      answerIndex: makeFalse ? 1 : 0,
      explanation: makeFalse ? `자료 원문: "${s}"` : '자료에 그대로 제시된 내용입니다.',
      objectiveIndex: 2,
      difficulty: 'easy',
    });
  }

  if (!questions.length) {
    throw new Error('자료에서 문항을 만들 만한 문장을 찾지 못했습니다. 다른 자료를 사용해 주세요.');
  }
  return {
    title: `${title || '수업 자료'} 퀴즈`,
    summary: scored.slice(0, 2).map((x) => x.s).join(' '),
    objectives,
    questions: questions.slice(0, numQuestions),
  };
}

function sanitizeQuiz(quiz, numQuestions) {
  const objectives = (quiz.objectives || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
  if (!objectives.length) objectives.push('자료의 핵심 내용을 이해할 수 있다.');
  const questions = (quiz.questions || [])
    .filter((q) => q && q.prompt && Array.isArray(q.choices) && q.choices.length >= 2)
    .slice(0, Math.max(numQuestions, 1))
    .map((q) => {
      const isOx = q.type === 'ox' || q.choices.length === 2;
      const choices = isOx ? ['O', 'X'] : q.choices.map((c) => String(c)).slice(0, 4);
      let answerIndex = Number.isInteger(q.answerIndex) ? q.answerIndex : 0;
      if (isOx && q.choices.length === 2 && q.type === 'ox') {
        // O/X 표기가 달라도 정답 인덱스는 그대로 유효
      }
      if (answerIndex < 0 || answerIndex >= choices.length) answerIndex = 0;
      let objectiveIndex = Number.isInteger(q.objectiveIndex) ? q.objectiveIndex : 0;
      if (objectiveIndex < 0 || objectiveIndex >= objectives.length) objectiveIndex = 0;
      return {
        type: isOx ? 'ox' : 'mcq',
        prompt: String(q.prompt).trim(),
        choices,
        answerIndex,
        explanation: String(q.explanation || '').trim(),
        objectiveIndex,
        difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
      };
    });
  if (!questions.length) throw new Error('생성된 퀴즈에 유효한 문항이 없습니다.');
  return {
    title: String(quiz.title || '퀴즈').trim(),
    summary: String(quiz.summary || '').trim(),
    objectives,
    questions,
  };
}

async function generateQuiz({ sourceText, title, numQuestions = 8 }) {
  numQuestions = Math.min(Math.max(Number(numQuestions) || 8, 3), 15);
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (hasKey) {
    try {
      const quiz = await generateWithClaude({ sourceText, title, numQuestions });
      return { quiz: sanitizeQuiz(quiz, numQuestions), engine: 'claude' };
    } catch (err) {
      console.error('[ai] Claude 생성 실패 — 규칙 기반 생성기로 폴백:', err.message);
    }
  }
  const quiz = generateHeuristic({ sourceText, title, numQuestions });
  return { quiz: sanitizeQuiz(quiz, numQuestions), engine: 'heuristic' };
}

module.exports = { generateQuiz };
