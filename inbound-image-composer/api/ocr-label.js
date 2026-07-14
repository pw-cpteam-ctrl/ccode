/**
 * POST /api/ocr-label
 *
 * "라벨만 재인식" 전용 — parse-image.js와 달리 상품 사진은 아예 안 보내고, 이미
 * 이 도구가 만든 결과물(사진 아래 IP명/가격/배송비/태그 글자가 이미 깨끗하게
 * 렌더링돼 있는 카드)을 다시 소스로 올렸을 때, 그 텍스트 라벨 부분만 오려서 그대로
 * 읽어오는 저비용 OCR.
 *
 * parse-image.js와의 차이:
 * - parse-image.js: 사진+텍스트를 함께 보내고, 글자가 흐리면 사진(캐릭터 그림체/피규어
 *   형태)을 보고 IP를 추측해야 하는 "인식" 작업 — 원본 스크린샷(첫 입고) 전용.
 * - ocr-label.js: 사진 없이 이미 깨끗하게 렌더링된 글자만 있으니 "그대로 옮겨 적기"만
 *   하면 됨 — 사전 매칭/성향 추측/분위기 클러스터 판단 같은 추가 추론이 필요 없어서
 *   프롬프트도 짧고 이미지도 작아 훨씬 저렴하다.
 *
 * 요청: { imageBase64, mediaType, expectedCount }
 * 응답: { items: [{ip, price, ship, tag}], usage }
 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IP명 줄에 보이는 글자 그대로 (해석하지 말고 그대로 옮겨 적기)' },
          price: { type: 'string', description: '가격 줄에 보이는 글자 그대로. 없으면 빈 문자열' },
          ship: { type: 'string', description: '배송비 줄에 보이는 글자 그대로. 없으면 빈 문자열' },
          tag: { type: 'string', description: 'IP명 옆에 붙은 태그 배지 글자. 없으면 빈 문자열' },
        },
        required: ['ip', 'price', 'ship', 'tag'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function buildPrompt(expectedCount) {
  return [
    '너는 이미 완성된 카드에서 텍스트 라벨만 그대로 옮겨 적는 OCR이다. 상품 사진은 없고,',
    'IP명/가격/배송비/태그 글자만 있는 좁은 띠 이미지다.',
    `각 칸은 빨간 테두리로 구분되어 있고 왼쪽 위에 #1, #2... 번호가 붙어 있다.`,
    `정확히 ${expectedCount}개의 번호가 있으니, 그 순서대로 정확히 ${expectedCount}개 항목을 출력해라.`,
    '',
    '- 이미 깨끗하게 렌더링된 글자이므로 해석하거나 축약하지 말고 보이는 그대로 옮겨 적어라.',
    '- 칸이 비어있으면 모든 필드를 빈 문자열로 둔다.',
    '- 설명 텍스트 없이 JSON만 출력해라.',
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수에 등록해주세요.' });
    return;
  }

  const { imageBase64, mediaType, expectedCount } = req.body || {};
  if (!imageBase64 || !expectedCount) {
    res.status(400).json({ error: 'imageBase64와 expectedCount가 필요합니다.' });
    return;
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: imageBase64 } },
            { type: 'text', text: buildPrompt(expectedCount) },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `Claude API 오류 (${r.status})`);

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) throw new Error('AI 응답에 텍스트가 없습니다.');
    const parsed = JSON.parse(textBlock.text);

    res.status(200).json({ items: parsed.items || [], usage: data.usage });
  } catch (err) {
    res.status(500).json({ error: `라벨 인식 실패: ${err.message}` });
  }
}
