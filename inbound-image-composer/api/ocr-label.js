/**
 * POST /api/ocr-label
 *
 * "라벨만 재인식" 전용 — parse-image.js와 달리 상품 사진은 아예 안 보내고 사진 아래
 * IP명/가격/배송비/태그 텍스트 라벨 부분만 잘라서 보낸다. 사진(이미지 데이터)이 빠진
 * 만큼 parse-image.js보다 저렴하다.
 *
 * 처음엔 "이 도구가 이미 만든 결과물(이미 깨끗한 IP명이 렌더링된 카드)을 다시 불러올
 * 때 전용"으로 설계해서 그대로 옮겨 적기만 했는데, 실제로는 원본 매장 스크린샷(상품명이
 * "[예약] GMG 콜렉션 17 지구연방군 세이라 마스 제복 버전ㅣ기동전사 건담"처럼 지저분한
 * 원문 그대로인 경우)에도 이 버튼을 쓰고 싶어했다 — 그대로 옮겨 적기만 하면 IP명이
 * 아니라 상품명 전체가 그대로 ip 필드에 들어가버려서 쓸모가 없었다. 그래서 parse-image.js와
 * 똑같은 IP명 추출 규칙(사전/라인업 태그/분위기 클러스터/성향)을 그대로 가져오되,
 * "글자가 흐리면 사진을 보고 유추해라"는 지시만 뺐다(사진이 없으니까 — 그 대신
 * uncertain으로 표시).
 *
 * 요청: { imageBase64, mediaType, expectedCount, ipDictHint, tagWhitelist, moodClusters, productLineNames }
 * 응답: { items: [{rawText, ip, price, ship, tag, moodCluster, uncertain, genderLean}], usage }
 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawText: { type: 'string', description: '이 칸에서 읽은 원본 텍스트 그대로 (빈 칸이면 빈 문자열)' },
          ip: { type: 'string', description: '추정 IP명 (상품명 전체가 아니라 원작명만 축약/정규화)' },
          price: { type: 'string', description: '가격 텍스트 (예: 44,400원). 없으면 빈 문자열' },
          ship: { type: 'string', description: '배송비 텍스트 (예: 무료배송, 3,000원). 없으면 무료배송으로 추정' },
          tag: { type: 'string', description: 'ip가 "VTuber"면 소속(예: 홀로라이브, 니지산지)을 여기 적는다. 그 외엔 화이트리스트 태그 중 하나 또는 빈 문자열' },
          moodCluster: { type: 'string', description: '아래 분위기 클러스터 목록 중 이 IP와 가장 어울리는 클러스터명. 애매하거나 목록에 없으면 빈 문자열' },
          uncertain: { type: 'boolean', description: 'IP명 판단이 애매하거나 원문을 명확히 읽지 못했으면 true' },
          genderLean: { type: 'string', enum: ['male', 'female', 'unknown'], description: '이 IP/캐릭터의 주 소비층 성향 추측' },
        },
        required: ['rawText', 'ip', 'price', 'ship', 'tag', 'moodCluster', 'uncertain', 'genderLean'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function buildPrompt({ expectedCount, ipDictHint, tagWhitelist, moodClusters, productLineNames }) {
  const dictLines = Object.entries(ipDictHint || {})
    .slice(0, 60)
    .map(([k, v]) => `- ${k} → ${v}`)
    .join('\n');
  const whitelist = (tagWhitelist && tagWhitelist.length ? tagWhitelist : ['룩업', '테노히라', '메가캣']).join(', ');
  const lineNames = (productLineNames && productLineNames.length
    ? productLineNames
    : ['넨도로이드', '피그마', '팝업퍼레이드', '블라인드박스']
  ).join(', ');
  const clusterLines = (moodClusters || [])
    .filter((c) => c.name && (c.members || []).length)
    .map((c) => `- ${c.name}: ${c.members.slice(0, 20).join(', ')}`)
    .join('\n');

  return [
    '너는 피규어/굿즈 입고안내 텍스트 라벨에서 상품 정보를 읽어내는 파서야. 사진은 주지',
    '않는다 — 사진 아래 텍스트(상품명/가격/배송비 등) 부분만 잘라낸 이미지다.',
    `각 칸은 빨간 테두리로 구분되어 있고 왼쪽 위에 #1, #2... 번호가 붙어 있다. 왼쪽에서 오른쪽 순서.`,
    `정확히 ${expectedCount}개의 번호가 있으니, 그 번호 순서대로 정확히 ${expectedCount}개 항목을 출력해라.`,
    '',
    '## IP명 판단 규칙',
    '- 상품명 전체가 아니라 IP명(원작명)만 뽑아라. 구구절절한 설명/버전 텍스트는 제거.',
    '- 상품명은 보통 "상품 라인명 + 캐릭터명(+옵션) | 작품명/소속그룹 (재판 등)" 순서다.',
    '- 규칙 1: "|"(또는 유사 구분자 ㅣ, /) 뒤에 오는 텍스트가 작품명/소속그룹이면 그걸 ip로 써라.',
    '  앞부분(상품 라인명+캐릭터명)은 절대 ip로 쓰지 마라 (예: "팝업퍼레이드SP 키류인 사츠키 | 킬라킬"이면 ip는 "킬라킬").',
    '- 규칙 2: 아래 단어들은 "상품 라인명"이지 IP명이 아니다. 상품명 맨 앞에 있어도 무시해라:',
    `  ${lineNames}.`,
    '- 규칙 3: "|"가 없으면 캐릭터명으로 작품을 역으로 판단해라 (예: "넨도로이드 에반게리온 초호기"면',
    '  ip는 "에반게리온"). 아래 사전에 없는 캐릭터고 확신이 안 서면 규칙 4를 따른다.',
    '- 규칙 4: 확실하지 않으면 절대 지어내지 마라. 글자가 흐리거나 잘려서 확신이 안 서면(사진이 없어서',
    '  캐릭터 그림으로 확인할 방법이 없다), 있는 그대로 읽은 텍스트를 ip에 넣고 "uncertain": true로',
    '  표시해라. 그럴듯하게 들리는 단어를 창작하지 마라.',
    '- 규칙 5 (VTuber): 홀로라이브/니지산지 등 VTuber 소속 상품은 ip를 "VTuber"로 쓰고, 소속사명',
    '  (예: "홀로라이브", "니지산지")은 tag 필드에 넣어라. 소속사명을 ip에 쓰지 마라.',
    '- 아래는 지금까지 확정된 표기 사전이다. 여기 있는 원문과 일치하면 그대로 사용해라:',
    dictLines || '(사전 없음)',
    '- 사전에 없는 새 IP거나 판단이 애매하면 절대 임의로 확정하지 말고 "uncertain": true 로 표시해라.',
    '- 단, 이 경우에도 "ip" 필드를 절대 빈 문자열로 남기지 마라. 축약/정규화된 표기를 확신할 수 없다면',
    '  rawText에서 읽은 상품명/캐릭터명 텍스트를 그대로 ip 필드에 복사해 넣어라.',
    '- ip를 빈 문자열로 둘 수 있는 경우는 그 칸에 실제로 상품이 없어서 rawText 자체도 빈 문자열일 때뿐이다.',
    '',
    '## 라인업 태그',
    `- ip가 "VTuber"가 아닌 경우, 다음 화이트리스트에 정확히 해당할 때만 태그를 채운다: ${whitelist}. 그 외 라인업은 태그를 비워둔다.`,
    '',
    '## 분위기 클러스터',
    '- 아래는 기존에 분류된 클러스터별 소속 IP 예시다. 이 IP가 어느 클러스터와 분위기가',
    '  가장 비슷한지 판단해 그 클러스터명을 moodCluster에 넣어라 (목록에 있는 이름 그대로, 새로 만들지 말 것):',
    clusterLines || '(클러스터 사전 없음 — moodCluster는 항상 빈 문자열)',
    '- 애매하거나 어느 클러스터에도 안 맞으면 moodCluster는 빈 문자열로 둔다. 억지로 끼워맞추지 마라.',
    '',
    '## 성향 추측 (genderLean)',
    '- 이 상품의 IP/캐릭터가 주로 남성 소비자에게 인기 있는지, 여성 소비자에게 인기 있는지',
    '  추측해서 genderLean에 "male" 또는 "female"로 답해라. 정말 판단이 안 서면 "unknown".',
    '',
    '## 출력',
    '- rawText/ip/price/ship/tag/moodCluster/uncertain/genderLean 필드를 가진 JSON만 출력. 설명 텍스트 없이.',
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

  const { imageBase64, mediaType, expectedCount, ipDictHint, tagWhitelist, moodClusters, productLineNames } = req.body || {};
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
        max_tokens: 4096,
        output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: imageBase64 } },
            { type: 'text', text: buildPrompt({ expectedCount, ipDictHint, tagWhitelist, moodClusters, productLineNames }) },
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
