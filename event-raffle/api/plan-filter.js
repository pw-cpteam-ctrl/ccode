// Vercel 서버리스 함수: 이번 회차 조건 텍스트를 "코드로 판단 가능한 규칙"과
// "AI 판단이 필요한 주관적 조건"으로 나눠준다 (참가자 데이터 전체는 보내지 않음 —
// 컬럼명 + 예시 몇 개만 사용). 실제 대량 데이터 필터링은 이 결과를 받은 브라우저가
// 코드로 처리하므로, 조건이 전부 객관적이면 이 호출 하나로 필터링이 끝나고
// LLM 비용이 전혀 들지 않는다.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = [
  '너는 이벤트 참가자 필터링 조건을 분석해서, 자바스크립트 코드로 정확히 판단 가능한',
  '부분과 AI의 주관적 판단이 필요한 부분으로 나누는 역할이야.',
  '입력으로 참가자 데이터의 컬럼명(항상 "본문" 하나 — 참가자가 실제로 남긴 댓글/후기',
  '텍스트를 사용자가 직접 지정해서 넘긴 컬럼이다), 예시 데이터 몇 개, 이번 회차',
  '조건 텍스트를 받는다.',
  '',
  '조건 텍스트가 여러 개일 때는 사용자가 화면에서 각 조건 사이의 관계(그리고/또는)를',
  '직접 골라서 "(조건A) AND (조건B) OR (조건C)" 같은 형식으로 이미 명확하게 조합해',
  '보낸다. AND는 두 조건 모두 만족, OR는 둘 중 하나만 만족해도 통과라는 뜻이며,',
  '왼쪽부터 순서대로 묶인 것이다(뒤 연산자가 앞 전체 결과와 다음 조건을 묶는다).',
  '이 논리 구조를 절대 임의로 바꾸지 말고 그대로 반영해서 codeRule을 만들거나,',
  '코드로 다 표현 못하면 그 구조를 유지한 채 subjectiveCondition으로 넘겨라.',
  '',
  '1. 조건(또는 조건 일부) 중 정규식/문자열 비교/단순 논리만으로 "본문" 컬럼 값만',
  '   보고 정확히 판단 가능한 부분이 있다면, 그 부분을 자바스크립트 화살표 함수',
  '   표현식 문자열로 만들어라. 형식은 반드시 "(row) => <boolean 표현식>" 이어야',
  '   하고, row["본문"] 값만 참조할 수 있다. 오타·표기 변형(예: 사스케/사수케/사스께/',
  '   サスケ 등)까지 정규식으로 최대한 넓게 잡아라. 여러 조건이 AND/OR로 묶여있으면',
  '   각 조건의 코드 판단 가능 여부를 따로 본 뒤 &&/||로 결합해라. 외부 라이브러리,',
  '   async, 변수 선언, 세미콜론으로 여러 문장 쓰기는 금지 — 순수 표현식 하나만',
  '   작성한다.',
  '2. 코드로는 판단할 수 없는 주관적 판단(글의 정성스러움, 진정성, 재미, 어투 등',
  '   뉘앙스 판단)이 남아있다면 그 부분만(AND/OR 구조 포함) 한국어 문장으로 정리해라.',
  '3. 조건 전체가 코드로 판단 가능하면 subjectiveCondition은 빈 문자열로 답하고,',
  '   조건 전체가 주관적이라 코드로 전혀 나눌 수 없으면 codeRule은 빈 문자열로 답하라.',
  '   일부 조건은 코드로, 일부는 AND/OR로 얽혀 있어 깔끔히 분리가 안 되면 무리하게',
  '   나누지 말고 codeRule을 비우고 조건 전체를 subjectiveCondition으로 넘겨라 —',
  '   잘못 나눈 codeRule은 후보를 엉뚱하게 0명으로 만들 수 있으니 확신 없을 땐',
  '   비워두는 쪽이 안전하다.',
].join('\n');

const PLAN_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      codeRule: {
        type: 'string',
        description: '"(row) => boolean" 형태의 JS 표현식 문자열. 코드로 판단 불가능하면 빈 문자열.',
      },
      subjectiveCondition: {
        type: 'string',
        description: 'AI가 별도로 판단해야 할 나머지 조건(한국어 문장). 없으면 빈 문자열.',
      },
    },
    required: ['codeRule', 'subjectiveCondition'],
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

  const { columns, sampleRows, condition } = req.body || {};
  if (!Array.isArray(columns) || !columns.length) {
    res.status(400).json({ error: '컬럼 정보(columns)가 비어 있어요.' });
    return;
  }
  if (!condition || !condition.trim()) {
    res.status(400).json({ error: '조건(condition)이 비어 있어요.' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `컬럼명: ${JSON.stringify(columns)}`,
            `예시 데이터: ${JSON.stringify((sampleRows || []).slice(0, 8))}`,
            `조건: ${condition}`,
          ].join('\n'),
        },
      ],
      output_config: { effort: 'medium', format: PLAN_OUTPUT_FORMAT },
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const parsed = textBlock ? JSON.parse(textBlock.text) : { codeRule: '', subjectiveCondition: condition };
    res.status(200).json({
      codeRule: typeof parsed.codeRule === 'string' ? parsed.codeRule : '',
      subjectiveCondition: typeof parsed.subjectiveCondition === 'string' ? parsed.subjectiveCondition : condition,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY가 유효하지 않아요.' });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: '요청이 몰려서 잠시 후 다시 시도해주세요.' });
    } else {
      res.status(502).json({ error: `조건 분석 중 오류: ${err.message}` });
    }
  }
}
