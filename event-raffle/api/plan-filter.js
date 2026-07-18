// Vercel 서버리스 함수: 이번 회차 조건 텍스트를 "코드로 판단 가능한 규칙"과
// "AI 판단이 필요한 주관적 조건"으로 나눠준다 (참가자 데이터 전체는 보내지 않음 —
// 컬럼명 + 예시 몇 개만 사용). 실제 대량 데이터 필터링은 이 결과를 받은 브라우저가
// 코드로 처리하므로, 조건이 전부 객관적이면 이 호출 하나로 필터링이 끝나고
// LLM 비용이 전혀 들지 않는다.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = [
  '너는 이벤트 참가자 필터링 조건을 분석해서, 자바스크립트 코드로 정확히 판단 가능한',
  '부분과 AI의 주관적 판단이 필요한 부분으로 나누는 역할이야.',
  '입력으로 참가자 데이터의 컬럼명, 예시 데이터 몇 개, 이번 회차 조건 텍스트를 받는다.',
  '컬럼명은 스크래퍼(자동 수집 도구)가 만든 원본 데이터라 css-1jxf684, __EMPTY,',
  '__EMPTY_1 같이 의미 없는 문자열일 수 있다. 이럴 땐 컬럼명 자체가 아니라',
  '예시 데이터에 실제로 들어있는 값(문장인지/닉네임인지/날짜인지/숫자인지 등)을 보고',
  '그 컬럼이 조건과 관련된 컬럼인지 판단해라. 예시 데이터만으로 어떤 컬럼이',
  '조건에서 말하는 내용(예: 댓글/닉네임/사진 첨부 여부)에 해당하는지 확신할 수 없다면',
  '무리하게 codeRule을 만들지 말고, 그 부분은 subjectiveCondition으로 넘겨서',
  'AI가 직접 원본 행을 보고 판단하게 하라 — 틀린 컬럼을 가정한 codeRule은',
  '후보를 엉뚱하게 0명으로 만들 수 있으니, 확신 없을 땐 비워두는 쪽이 안전하다.',
  '',
  '1. 조건 중 정규식/문자열 비교/단순 논리만으로 정확히 판단 가능한 부분이 있다면,',
  '   그 부분을 자바스크립트 화살표 함수 표현식 문자열로 만들어라.',
  '   형식은 반드시 "(row) => <boolean 표현식>" 이어야 한다. row는 참가자 한 명의',
  '   데이터 객체이고, 주어진 컬럼명을 키로 사용한다. 오타·표기 변형(예: 사스케/사수케/',
  '   사스께/サスケ 등)까지 정규식으로 최대한 넓게 잡아라. 외부 라이브러리, async,',
  '   변수 선언, 세미콜론으로 여러 문장 쓰기는 금지 — 순수 표현식 하나만 작성한다.',
  '2. 코드로는 판단할 수 없는 주관적 판단(글의 정성스러움, 진정성, 재미, 어투 등',
  '   뉘앙스 판단)이 남아있다면 그 부분만 한국어 문장으로 정리해라.',
  '3. 조건 전체가 코드로 판단 가능하면 subjectiveCondition은 빈 문자열로 답하고,',
  '   조건 전체가 주관적이라 코드로 전혀 나눌 수 없으면 codeRule은 빈 문자열로 답하라.',
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
