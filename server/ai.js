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

function splitSentences(text) {
  return text
    .split(/(?<=[.!?다요])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 200 && !/^\[/.test(s));
}

function tokenize(sentence) {
  return (sentence.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter((w) => !STOPWORDS.has(w.toLowerCase()));
}

function keywordFrequency(sentences) {
  const freq = new Map();
  for (const s of sentences) {
    for (const w of tokenize(s)) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return freq;
}

function pickBlankWord(sentence, freq) {
  const words = tokenize(sentence);
  if (!words.length) return null;
  // 자료 전체에서 자주 나오는(=핵심 개념일 확률이 높은) 긴 단어를 빈칸으로 뽑는다
  return words.sort((a, b) => (freq.get(b) || 0) * b.length - (freq.get(a) || 0) * a.length)[0];
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
  const mcqCount = Math.max(1, numQuestions - Math.min(2, Math.floor(numQuestions / 4)));

  for (const { s, i } of scored) {
    if (questions.length >= mcqCount) break;
    if (usedSentences.has(i)) continue;
    const blank = pickBlankWord(s, freq);
    if (!blank) continue;
    const distractorPool = topKeywords.filter((w) => w !== blank && !s.includes(w));
    if (distractorPool.length < 3) continue;
    usedSentences.add(i);
    const distractors = shuffle(distractorPool).slice(0, 3);
    const choices = shuffle([blank, ...distractors]);
    questions.push({
      type: 'mcq',
      prompt: `다음 빈칸에 들어갈 알맞은 말은?\n"${s.replace(blank, '( ____ )')}"`,
      choices,
      answerIndex: choices.indexOf(blank),
      explanation: `자료 원문: "${s}"`,
      objectiveIndex: questions.length % 2,
      difficulty: ['easy', 'medium', 'hard'][questions.length % 3],
    });
  }

  // OX 문항: 원문 그대로(O) 또는 키워드를 바꿔치기한 문장(X)
  for (const { s, i } of scored) {
    if (questions.length >= numQuestions) break;
    if (usedSentences.has(i)) continue;
    usedSentences.add(i);
    const makeFalse = questions.length % 2 === 1;
    let prompt = s;
    if (makeFalse) {
      const blank = pickBlankWord(s, freq);
      const swap = topKeywords.find((w) => w !== blank && !s.includes(w));
      if (!blank || !swap) continue;
      prompt = s.replace(blank, swap);
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
