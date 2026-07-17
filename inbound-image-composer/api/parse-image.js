/**
 * POST /api/parse-image
 *
 * Claude Vision(claude-sonnet-5)을 이용한 이미지 기반 상품정보 자동 인식
 *
 * 기본 원칙:
 * - 원본 그리드 스크린샷에서 상품명/가격/배송비 텍스트를 OCR하여 구조화된 JSON 반환
 * - "이미지 넣으면 자동으로 표가 채워지는" UX 제공 (대화형 AI와 동일)
 * - business-rules.md 준수: IP명 판단이 애매하면 uncertain=true, 절대 자동 확정 금지
 * - 프론트엔드는 결과를 항상 "⚠ 확인 필요" 배지로만 표시
 *
 * 성능 최적화 (배치 방식):
 * - 한 번에 모든 항목을 보내면 인식 정확도가 급격히 저하 (25개 중 4개만 인식 실제 사례)
 * - 따라서 프론트에서 원본 그리드 1개 행(보통 5개) 단위로 나눠서 여러 번 호출
 * - 이미지 레이아웃이 cardStrip(원본 레이아웃을 그대로 유지한 채 행 단위로 자름)일 때
 *   특히 효과적 — 항목별로 오려서 재조합하면 좌표 계산이 조금만 어긋나도 엉뚱한 크롭이
 *   만들어지는 문제가 있어, 원본을 그대로 잘라 재조합 버그 자체를 없앰
 *
 * 배포 선택사항:
 * - 백엔드가 없으면(파일 더블클릭으로 열었을 때) 도구는 수동 입력만으로 정상 동작
 * - 호출은 사용자가 "AI로 채우기" 버튼 클릭시만 발생 (자동 호출 없음)
 * - API 비용(claude-sonnet-5, haiku 대비 2배 단가지만 인식 정확도 개선)은 사용한 만큼만 발생
 *
 * 요청 파라미터:
 * - imageBase64: 이미지 base64 인코딩
 * - mediaType: 이미지 MIME 타입 (기본값 image/png)
 * - expectedCount: 이 배치의 상품 개수 (AI가 정확히 이 개수를 반환하도록 지시)
 * - ipDictHint: {원문→정규화명} 매핑 사전 (최대 60개, AI 판단 지원용)
 * - tagWhitelist: 허용된 라인업 태그 목록
 * - moodClusters: [{name, members}] 분위기 클러스터 사전 (신규 IP를 어느 클러스터에 넣을지 판단용)
 * - layout: 이미지 레이아웃 타입 (기본 그리드 또는 cardStrip)
 * - productLineNames: IP명이 아닌 "상품 라인명" 목록 (넨도로이드/피그마 등, 오인식 방지용)
 *
 * 응답: { items: [{rawText, ip, price, ship, tag, moodCluster, uncertain}], usage }
 */

// Claude가 반드시 따라야 할 응답 구조. JSON Schema를 통해 구조 강제 → 파싱 안정성 확보
// 각 필드의 의미: rawText(원본), ip(정규화된 IP명), price(가격 문자열),
// ship(배송비), tag(라인업 분류), moodCluster(분위기 클러스터), uncertain(확신도 플래그)
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
          tag: { type: 'string', description: 'ip가 "VTuber"면 소속(예: 홀로라이브, 니지산지)을 여기 적는다. 그 외엔 화이트리스트 태그 중 하나(테노히라/메가캣/GEM) 또는 빈 문자열. 확실하지 않으면 빈 문자열' },
          moodCluster: { type: 'string', description: '아래 분위기 클러스터 목록 중 이 IP와 가장 어울리는 클러스터명. 애매하거나 목록에 없으면 빈 문자열' },
          uncertain: { type: 'boolean', description: 'IP명 판단이 애매하거나 원문을 명확히 읽지 못했으면 true' },
          genderLean: { type: 'string', enum: ['male', 'female', 'unknown'], description: '이 IP/캐릭터의 주 소비층 성향 추측. 남성향이면 male, 여성향이면 female, 판단이 애매하면 unknown. S/A급으로 이미 유명한 IP라도 상관없이 항상 추측해서 채워라(클라이언트가 필요할 때만 사용한다).' },
        },
        required: ['rawText', 'ip', 'price', 'ship', 'tag', 'moodCluster', 'uncertain', 'genderLean'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// 프롬프트 엔지니어링: Claude Vision에게 정확한 인식을 유도하기 위한 상세 지시
// - 이미지 형식 설명 (cardStrip vs 그리드): 레이아웃 인식 오류 방지
// - IP명 판단 규칙: 사전 활용 → 새로운 항목은 uncertain 표시
// - 배송비/태그 규칙: 화이트리스트 기반, 불확실하면 빈 값
// - expectedCount 강제: AI가 정확히 N개 항목을 반환하도록
function buildPrompt({ expectedCount, ipDictHint, tagWhitelist, moodClusters, layout, productLineNames }) {
  const dictLines = Object.entries(ipDictHint || {})
    .slice(0, 60)
    .map(([k, v]) => `- ${k} → ${v}`)
    .join('\n');
  const whitelist = (tagWhitelist && tagWhitelist.length ? tagWhitelist : ['테노히라', '메가캣', 'GEM']).join(', ');
  // "⚙ 사전 관리 → 상품 라인명" 탭에서 사용자가 계속 늘려나가는 목록. 프론트가 안 보내면
  // (배포 전 구버전 등) 기본값으로 최소한의 대표 단어만 사용한다.
  const lineNames = (productLineNames && productLineNames.length
    ? productLineNames
    : ['넨도로이드', '피그마', '팝업퍼레이드', '블라인드박스']
  ).join(', ');

  // 클러스터별 기존 소속 IP 목록을 예시로 주고, 새 IP가 어느 클러스터와 "분위기"가
  // 비슷한지 판단하게 한다. 목록이 없으면 클러스터 판단 자체를 건너뛴다.
  const clusterLines = (moodClusters || [])
    .filter((c) => c.name && (c.members || []).length)
    .map((c) => `- ${c.name}: ${c.members.slice(0, 20).join(', ')}`)
    .join('\n');

  // cardStrip: 원본 그리드에서 1개 행(보통 5개 상품)을 항목별로 자르지 않고 원본 레이아웃
  // 그대로 통째로 잘라 보낸 이미지. 항목별로 오려서 재조합하면 좌표 계산이 조금만 어긋나도
  // 엉뚱한 크롭이 만들어지는 문제가 있어, 원본을 그대로 유지한 채 순서 확인용 #1,#2...
  // 번호만 각 칸 위에 덧그렸다. 한 번에 너무 많은 항목을 보내면 인식 정확도가 급격히
  // 떨어져서(실사용 중 25개 중 4개만 인식되는 문제 발견) 한 행씩만 나눠 보낸다.
  const layoutInstruction = layout === 'cardStrip'
    ? [
      `이미지는 원본 상품 목록 그리드에서 일부 행을 그대로 잘라낸 것이다(사진+상품명+가격 등 원본 레이아웃 그대로).`,
      `각 상품 칸은 빨간 테두리로 구분되어 있고 왼쪽 위에 #1, #2... 번호가 붙어 있다. 왼쪽에서 오른쪽 순서.`,
      `텍스트가 흐리거나 일부 잘려 있으면, 같이 보이는 사진(캐릭터/작품 그림체, 피규어 형태)을 보고 어떤 IP/캐릭터인지 유추해서 채워라.`,
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
    '- 상품명은 보통 "상품 라인명 + 캐릭터명(+옵션) | 작품명/소속그룹 (재판 등)" 순서다.',
    '- 규칙 1: "|"(또는 유사 구분자 ㅣ, /) 뒤에 오는 텍스트가 작품명/소속그룹이면 그걸 ip로 써라.',
    '  앞부분(상품 라인명+캐릭터명)은 절대 ip로 쓰지 마라 (예: "팝업퍼레이드SP 키류인 사츠키 | 킬라킬"이면 ip는 "킬라킬").',
    '- 규칙 2: 아래 단어들은 "상품 라인명"이지 IP명이 아니다. 상품명 맨 앞에 있어도 무시해라:',
    `  ${lineNames}.`,
    '- 규칙 2-1 (중요): "팝업퍼레이드"는 특히 자주 흐릿하게 찍혀서 다른 단어로 잘못 읽기 쉽다.',
    '  상품명 맨 앞부분에 애매하게 흐린 글자가 있으면, 정확히 못 읽었어도 그건 "팝업퍼레이드"',
    '  같은 상품 라인명일 가능성이 높다고 가정해라. 그 부분을 억지로 정확히 읽어내려고 다른',
    '  단어로 지어내지 말고, 바로 무시한 뒤 "|" 뒤 작품명이나 캐릭터명으로 IP를 판단해라.',
    '- 규칙 3: "|"가 없으면 캐릭터명으로 작품을 역으로 판단해라 (예: "넨도로이드 에반게리온 초호기"면',
    '  ip는 "에반게리온"). 아래 사전에 없는 캐릭터고 확신이 안 서면 규칙 4를 따른다.',
    '- 규칙 4: 확실하지 않으면 절대 지어내지 마라. 글자가 흐리거나 잘려서 확신이 안 서면, 있는 그대로',
    '  읽은 텍스트를 ip에 넣고 "uncertain": true로 표시해라. 그럴듯하게 들리는 단어를 창작하지 마라.',
    '- 규칙 5 (VTuber): 홀로라이브/니지산지 등 VTuber 소속 상품은 ip를 "VTuber"로 쓰고, 소속사명',
    '  (예: "홀로라이브", "니지산지")은 tag 필드에 넣어라. 소속사명을 ip에 쓰지 마라 (예:',
    '  "팝업퍼레이드SP 호시자키 신세이 | 홀로라이브"면 ip는 "VTuber", tag는 "홀로라이브").',
    '- 아래는 지금까지 확정된 표기 사전이다. 여기 있는 원문과 일치하면 그대로 사용해라:',
    dictLines || '(사전 없음)',
    '- 사전에 없는 새 IP거나 판단이 애매하면 절대 임의로 확정하지 말고 "uncertain": true 로 표시해라.',
    '- 단, 이 경우에도 "ip" 필드를 절대 빈 문자열로 남기지 마라. 축약/정규화된 표기를 확신할 수 없다면',
    '  rawText에서 읽은 상품명/캐릭터명 텍스트를 그대로 ip 필드에 복사해 넣어라. 사람이 그 텍스트를 보고',
    '  최종 확정한다 — 빈 칸으로 두면 사람이 사진만 보고 처음부터 다시 입력해야 해서 훨씬 비효율적이다.',
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
    '- 이 상품의 IP/캐릭터가 주로 남성 소비자에게 인기 있는지(예: 미소녀 피규어 단품, 밀리터리물),',
    '  여성 소비자에게 인기 있는지(예: 아이돌/밴드 육성물, 순정만화, 잘생긴 남성 캐릭터 중심 작품)',
    '  추측해서 genderLean에 "male" 또는 "female"로 답해라. 정말 판단이 안 서면 "unknown".',
    '- 이미 유명해서 사전/등급표에 있을 법한 IP라도 상관없이 매번 채워라 — 실제로 등급표에',
    '  있는지는 클라이언트가 별도로 확인하고, 사전에 없는 IP에 대해서만 이 값을 실제로 사용한다.',
    '',
    '## 출력',
    '- rawText/ip/price/ship/tag/moodCluster/uncertain/genderLean 필드를 가진 JSON만 출력. 설명 텍스트 없이.',
  ].join('\n');
}

/**
 * Vercel 서버리스 함수: 이미지 인식 요청 처리
 *
 * 요청 흐름:
 * 1. 환경변수 검증: ANTHROPIC_API_KEY 필수
 * 2. 파라미터 검증: imageBase64, expectedCount
 * 3. 프롬프트 생성: buildPrompt()로 상세 지시 작성
 * 4. Claude API 호출: vision + JSON Schema 포맷 강제
 * 5. 응답 파싱 및 검증: textBlock 추출 → JSON 파싱
 * 6. 결과 반환: items[] + usage 정보
 *
 * 에러 처리:
 * - 프론트가 캐치: "백엔드 없음 → 수동 입력 진행" 안내로 변환
 * - 따라서 이 함수는 에러시 명확한 메시지만 반환하면 됨
 */
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

  const { imageBase64, mediaType, expectedCount, ipDictHint, tagWhitelist, moodClusters, layout, productLineNames } = req.body || {};
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
            { type: 'text', text: buildPrompt({ expectedCount, ipDictHint, tagWhitelist, moodClusters, layout, productLineNames }) },
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
