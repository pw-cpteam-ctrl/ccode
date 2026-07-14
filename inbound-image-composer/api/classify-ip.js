/**
 * POST /api/classify-ip
 *
 * 텍스트 전용 IP 성향/분위기 분류 — parse-image.js와 달리 이미지를 전혀 보내지 않고
 * 이미 확정된 IP명 문자열만 보내는 저비용 분류 API.
 *
 * 쓰임새: "IP명/가격/태그는 이미 다 맞게 입력(또는 텍스트 잠금)돼 있고, 3단계 자동
 * 정렬이 등급표/클러스터에 없는 IP는 전부 '기타'로 묶어버려서 순서가 기대와 다르게
 * 나올 때" — 사진을 다시 인식할 필요 없이, 이미 아는 IP명 텍스트만 보내서
 * genderLean(성향)/moodCluster(분위기 클러스터) 두 개만 판단받는다. 이미지 토큰이
 * 전혀 안 들어서 parse-image.js보다 훨씬 저렴하고, ip/price/tag는 응답에 아예 없으니
 * 실수로 텍스트를 덮어쓸 방법 자체가 없다(텍스트 잠금 모드와 완전히 호환).
 *
 * 요청: { ipNames: string[] (중복 제거된 고유 IP명 목록), moodClusters: [{name, members}] }
 * 응답: { items: [{ip, genderLean, moodCluster}], usage }
 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: '입력받은 IP명 그대로 (순서 확인/매칭용)' },
          genderLean: { type: 'string', enum: ['male', 'female', 'unknown'], description: '이 IP/캐릭터의 주 소비층 성향 추측' },
          moodCluster: { type: 'string', description: '가장 어울리는 분위기 클러스터명. 애매하면 빈 문자열' },
        },
        required: ['ip', 'genderLean', 'moodCluster'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function buildPrompt({ ipNames, moodClusters }) {
  const clusterLines = (moodClusters || [])
    .filter((c) => c.name && (c.members || []).length)
    .map((c) => `- ${c.name}: ${c.members.slice(0, 20).join(', ')}`)
    .join('\n');

  return [
    '너는 피규어/굿즈 IP(작품·캐릭터)의 소비층 성향과 분위기를 분류하는 분류기야.',
    '사진은 주지 않는다 — 아래 IP명 텍스트만 보고 판단해라.',
    '',
    '## IP 목록 (정확히 이 순서·글자 그대로 items에 반환)',
    ipNames.map((n, i) => `${i + 1}. ${n}`).join('\n'),
    '',
    '## genderLean',
    '- 이 IP/캐릭터가 주로 남성 소비자에게 인기 있으면 male, 여성 소비자에게 인기 있으면',
    '  female, 판단이 안 서면 unknown으로 답해라.',
    '',
    '## moodCluster',
    '- 아래는 기존에 분류된 클러스터별 소속 IP 예시다. 이 IP가 어느 클러스터와 분위기가',
    '  가장 비슷한지 판단해 그 클러스터명을 그대로 moodCluster에 넣어라(목록에 없는',
    '  이름을 새로 만들지 마라):',
    clusterLines || '(클러스터 사전 없음 — moodCluster는 항상 빈 문자열)',
    '- 애매하거나 어느 클러스터에도 안 맞으면 moodCluster는 빈 문자열로 둔다.',
    '',
    '## 출력',
    `- 정확히 ${ipNames.length}개 항목을 입력 순서 그대로 출력해라. 설명 텍스트 없이 JSON만.`,
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

  const { ipNames, moodClusters } = req.body || {};
  if (!Array.isArray(ipNames) || !ipNames.length) {
    res.status(400).json({ error: 'ipNames가 필요합니다.' });
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
          content: [{ type: 'text', text: buildPrompt({ ipNames, moodClusters }) }],
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
    res.status(500).json({ error: `AI 분류 실패: ${err.message}` });
  }
}
