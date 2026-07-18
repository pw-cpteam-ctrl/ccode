// Vercel 서버리스 함수: 참가자 데이터 + 이번 회차 조건을 받아 Claude(Anthropic API)에게 필터링을 맡긴다.
// 배포한 Vercel 프로젝트의 환경변수에 ANTHROPIC_API_KEY를 등록해야 동작한다.
// 최종 당첨자 추첨은 이 함수가 아니라 브라우저 쪽 코드(index.html)가 실제 난수로 처리한다.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = [
  '너는 이벤트 참가자 명단에서 조건에 맞는 사람을 골라내는 심사자야.',
  '참가자 데이터(JSON 배열, 0부터 시작하는 인덱스 기준)와 이번 회차의 필터링 조건을 받는다.',
  '조건을 모두 만족하는 참가자만 골라서 각 참가자별로 판단 근거(reason)를 한 문장으로 적어라.',
  '너는 필터링(후보 선정)만 담당하고 최종 당첨자를 뽑지는 않는다 — 무작위 추첨은 별도로 처리된다.',
].join('\n');

const MATCH_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '참가자의 원본 배열 인덱스' },
            reason: { type: 'string', description: '판단 근거 한 문장' },
          },
          required: ['index', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['matches'],
    additionalProperties: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. Vercel 프로젝트 환경변수에 등록해주세요.' });
    return;
  }

  const { rows, condition } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    res.status(400).json({ error: '참가자 데이터(rows)가 비어 있어요.' });
    return;
  }
  if (!condition || !condition.trim()) {
    res.status(400).json({ error: '조건(condition)이 비어 있어요.' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(rows, condition) }],
      output_config: { format: MATCH_OUTPUT_FORMAT },
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const parsed = textBlock ? JSON.parse(textBlock.text) : { matches: [] };
    res.status(200).json({ matches: Array.isArray(parsed.matches) ? parsed.matches : [] });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY가 유효하지 않아요.' });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: '요청이 몰려서 잠시 후 다시 시도해주세요.' });
    } else {
      res.status(502).json({ error: `필터링 처리 중 오류: ${err.message}` });
    }
  }
}

function buildUserPrompt(rows, condition) {
  return [
    `조건: ${condition}`,
    '',
    `참가자 데이터: ${JSON.stringify(rows)}`,
  ].join('\n');
}
