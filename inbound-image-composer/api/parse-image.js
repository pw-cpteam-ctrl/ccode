// POST /api/parse-image — 원본 그리드 스크린샷을 Claude Vision(claude-haiku-4-5)에게 보내
// 각 칸의 상품명 텍스트를 읽고 IP명/가격/태그/배송비를 구조화된 JSON으로 뽑아온다.
// 지금까지 대화형 AI로 하던 "이미지 넣으면 자동으로 표가 채워지는" 경험을 그대로 재현하되,
// business-rules.md 원칙(IP명이 애매하면 자동 확정 금지)에 따라 결과에는 항상 uncertain
// 플래그를 실어 보낸다 — 프론트는 이걸 절대 자동 확정하지 않고 "확인 필요" 배지로만 쓴다.
//
// 이 엔드포인트가 없어도(백엔드 미배포) 도구는 수동 입력만으로 정상 동작한다 — 이 기능은
// 선택 사항이다. 호출은 사용자가 "AI로 채우기" 버튼을 누를 때만 발생하므로(자동 호출 없음)
// 비용은 누른 만큼만 발생한다.

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawText: { type: 'string', description: '이 칸에서 읽은 원본 텍스트 그대로 (빈 칸이면 빈 문자열)' },
          ip: { type: 'string', description: '추정 IP명 (business-rules.md 표기 가이드 기준으로 축약/정규화)' },
          price: { type: 'string', description: '가격 텍스트 (예: 44,400원). 없으면 빈 문자열' },
          ship: { type: 'string', description: '배송비 텍스트 (예: 무료배송, 3,000원). 없으면 무료배송으로 추정' },
          tag: { type: 'string', description: '화이트리스트 태그 중 하나(룩업/테노히라/메가캣) 또는 빈 문자열. 확실하지 않으면 빈 문자열' },
          uncertain: { type: 'boolean', description: 'IP명 판단이 애매하거나 원문을 명확히 읽지 못했으면 true' },
        },
        required: ['rawText', 'ip', 'price', 'ship', 'tag', 'uncertain'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function buildPrompt({ expectedCount, ipDictHint, tagWhitelist, layout }) {
  const dictLines = Object.entries(ipDictHint || {})
    .slice(0, 60)
    .map(([k, v]) => `- ${k} → ${v}`)
    .join('\n');
  const whitelist = (tagWhitelist && tagWhitelist.length ? tagWhitelist : ['룩업', '테노히라', '메가캣']).join(', ');

  // textStrip: 사진은 빼고 상품명/가격 텍스트 영역만 잘라 세로로 이어붙인 이미지(빨간 테두리 +
  // #1,#2... 번호로 구분됨). 한 번에 너무 많은 항목을 통째로 보내면 항목당 인식 정확도가
  // 급격히 떨어져서(실사용 중 25개 중 4개만 인식되는 문제 발견) 5~6개 단위로 나눠 보낸다.
  const layoutInstruction = layout === 'textStrip'
    ? [
      `이미지는 상품 텍스트(상품명/가격 등) 영역만 잘라서 위에서 아래로 이어붙인 것이다.`,
      `각 항목은 빨간 테두리로 구분되어 있고 왼쪽 위에 #1, #2... 번호가 붙어 있다.`,
      `정확히 ${expectedCount}개의 번호가 있으니, 그 번호 순서대로 정확히 ${expectedCount}개 항목을 출력해라.`,
    ]
    : [
      `이미지는 5열 그리드이고, 위에서 아래로 행 순서, 각 행에서는 왼쪽에서 오른쪽 열 순서로 정확히 ${expectedCount}개의 상품 칸이 있다.`,
      `반드시 ${expectedCount}개 항목을 그 순서 그대로 출력해라 (칸이 비어있어도 빈 항목으로 채워서 개수를 맞출 것).`,
    ];

  return [
    '너는 피규어/굿즈 입고안내 스크린샷에서 상품 정보를 읽어내는 파서야.',
    ...layoutInstruction,
    '',
    '## IP명 판단 규칙',
    '- 상품명 전체가 아니라 IP명(원작명)만 뽑아라. 구구절절한 설명/버전 텍스트는 제거.',
    '- 아래는 지금까지 확정된 표기 사전이다. 여기 있는 원문과 일치하면 그대로 사용해라:',
    dictLines || '(사전 없음)',
    '- 사전에 없는 새 IP거나 판단이 애매하면 절대 임의로 확정하지 말고 "uncertain": true 로 표시해라.',
    '- 단, 이 경우에도 "ip" 필드를 절대 빈 문자열로 남기지 마라. 축약/정규화된 표기를 확신할 수 없다면',
    '  rawText에서 읽은 상품명/캐릭터명 텍스트를 그대로 ip 필드에 복사해 넣어라. 사람이 그 텍스트를 보고',
    '  최종 확정한다 — 빈 칸으로 두면 사람이 사진만 보고 처음부터 다시 입력해야 해서 훨씬 비효율적이다.',
    '- ip를 빈 문자열로 둘 수 있는 경우는 그 칸에 실제로 상품이 없어서 rawText 자체도 빈 문자열일 때뿐이다.',
    '',
    '## 라인업 태그',
    `- 다음 화이트리스트에 정확히 해당할 때만 태그를 채운다: ${whitelist}. 그 외 라인업은 태그를 비워둔다.`,
    '',
    '## 출력',
    '- rawText/ip/price/ship/tag/uncertain 필드를 가진 JSON만 출력. 설명 텍스트 없이.',
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

  const { imageBase64, mediaType, expectedCount, ipDictHint, tagWhitelist, layout } = req.body || {};
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
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: imageBase64 } },
            { type: 'text', text: buildPrompt({ expectedCount, ipDictHint, tagWhitelist, layout }) },
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
    res.status(500).json({ error: `AI 인식 실패: ${err.message}` });
  }
}
