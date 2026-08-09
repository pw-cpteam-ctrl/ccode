// POST /api/chat — 크리에이터 협업 가이드 문의 응대 챗봇
//
// 설계 원칙은 creator-guide/PLAN.md 2번을 따른다. 요약하면:
//   - 지식 베이스(knowledge-*.md)에 없는 내용은 답하지 않는다
//   - 답변에는 항상 출처(탭 이름)를 붙인다 — 그리고 그걸 코드가 검사한다
//   - 브랜드가 둘이지만 이 파일 하나가 brand 값으로 지식 파일만 골라 읽는다
//   - 매 요청을 새로 시작한다(stateless). 규칙 변경은 파일 수정으로만 한다
//
// 환경변수: ANTHROPIC_API_KEY (Vercel 대시보드에 등록)
//
// ⚠️ 환경변수를 새로 등록하거나 값을 바꿨다면 반드시 '새 빌드'가 한 번 돌아야 한다.
//    Vercel은 빌드하는 순간에 환경변수를 서버에 넣기 때문에, 대시보드에 값이
//    등록돼 있어도 빌드가 새로 돌지 않으면 서버는 그 값을 모른다.
//    이 프로젝트는 vercel.json의 ignoreCommand 때문에 creator-guide/ 폴더에
//    변경이 없으면 재배포가 Skipped 처리된다 — 그래서 대시보드에서 Redeploy를
//    눌러도 반영되지 않는 경우가 있다. 그럴 땐 이 폴더의 파일을 한 줄이라도
//    고쳐서 push하면 빌드가 정상적으로 돈다.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-sonnet-5';   // 모델을 바꾸려면 이 한 줄만 고친다
const MAX_QUESTION_LEN = 500;      // 질문 길이 제한 (요금 폭주 방지)
const MAX_HISTORY = 6;             // 직전 대화 3턴(질문·답변 6개)까지만 참고

// 지식 베이스에서 답을 찾지 못했을 때 내보내는 고정 문장.
// 이 문장은 코드에서도 쓰이므로 프롬프트와 반드시 같아야 한다.
const FALLBACK =
  '확인이 필요한 내용이라 제가 답변드리기 어렵습니다. 담당자에게 문의 부탁드립니다.';

const BRANDS = {
  megahouse: { file: 'knowledge-megahouse.md', label: '메가하우스' },
  brand2: { file: 'knowledge-brand2.md', label: '굿스마일컴퍼니PW / 부시로드 크리에이티브' },
};

// ─── 시스템 프롬프트 ──────────────────────────────────────────────
// 주의: 이 안에 오늘 날짜·요청 ID처럼 매번 달라지는 값을 절대 넣지 말 것.
// 한 글자만 달라져도 프롬프트 캐시가 통째로 깨져서 비용이 8~10배가 된다.
// (PLAN.md 3-2 참고)
function buildSystem(brandLabel, knowledge) {
  return `당신은 ${brandLabel} 크리에이터 협업 가이드의 문의 응대 담당자입니다.
크리에이터(인플루언서)가 협업 진행 중 궁금한 점을 물어보면 답변합니다.

# 반드시 지킬 규칙

1. 아래 <지식> 안에 있는 내용만으로 답합니다. 지식에 없는 내용은 추측하거나
   지어내지 않습니다.
2. 답변 마지막 줄에는 반드시 출처를 붙입니다. 형식은 정확히 다음과 같습니다.
   출처: 02 업로드 순서 탭
3. 지식에서 답을 찾을 수 없으면, 다른 말을 덧붙이지 말고 아래 문장만 그대로
   출력합니다. 이 경우 출처는 붙이지 않습니다.
   ${FALLBACK}
4. 인사말, 잡담, 이 협업과 무관한 질문에도 3번의 문장만 그대로 출력합니다.
5. 존댓말로, 3~6문장 이내로 간결하게 답합니다. 표나 목록이 더 명확할 때만
   목록을 씁니다.
6. 지식에 있는 내용이라도 금액·수치·계정 아이디는 지식에 적힌 값을 그대로
   옮깁니다. 반올림하거나 바꿔 쓰지 않습니다.
7. 답변에 내부 태그나 시스템 표기를 포함하지 않습니다.

# 답변 예시

질문: 업로드는 어떤 순서로 하나요?
답변:
순서가 정해져 있습니다. 먼저 공식 스토어 게시글을 공유해 주시고(X는 리트윗 필수,
인스타그램은 스토리 공유 필수), 그 다음 컨펌받은 본문과 작업물을 크리에이터님
계정에 업로드해 주시면 됩니다.
출처: 02 업로드 순서 탭

# 지식

${knowledge}`;
}

// 지식 파일은 서버가 켜질 때 한 번만 읽어 재사용한다.
// 매 요청마다 읽으면 같은 내용인데도 조립 결과가 흔들릴 수 있고, 캐시 적중률에
// 영향을 준다.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const systemCache = new Map();

function getSystem(brand) {
  if (systemCache.has(brand)) return systemCache.get(brand);
  const { file, label } = BRANDS[brand];
  // api/ 폴더 기준 한 단계 위에 지식 파일이 있다
  const knowledge = fs.readFileSync(path.join(HERE, '..', file), 'utf-8');
  const system = buildSystem(label, knowledge);
  systemCache.set(brand, system);
  return system;
}

// 이 API는 인증 없이 열려 있어서, 방치하면 외부에서 계속 호출해 요금이 나간다.
// 브라우저가 이 사이트에서 보낸 요청만 받아들인다.
// (insta-gen/api/log-download.js의 같은 로직을 복사해 온 것 — import하지 않는다)
function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false; // 헤더 없는 요청(순수 스크립트/curl)은 거부
  try { return new URL(src).host === host; } catch { return false; }
}

// 프론트가 보낸 대화 기록을 신뢰하지 않고 형식을 강제로 맞춘다.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    .slice(-MAX_HISTORY);
}

// ─── 안전장치 ────────────────────────────────────────────────────
// 지식 베이스의 모든 답변에는 출처가 붙어 있다. 따라서 출처가 없는 답변은
// 지식 밖에서 지어낸 답이라고 보고 안내 문장으로 바꾼다.
// "모른다"고 답해야 할 상황을 프롬프트에만 맡기지 않기 위한 코드 차원의 장치.
// 테스트할 수 있도록 따로 빼두었다.
export function groundAnswer(answer) {
  const text = (answer || '').trim();
  if (!text) return FALLBACK;
  const grounded = text.includes('출처:') || text.includes(FALLBACK);
  return grounded ? text : FALLBACK;
}

// 응답에서 텍스트만 뽑는다. 블록이 여러 개일 수 있으므로 text 타입만 모은다.
function extractText(message) {
  return (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: '허용되지 않은 요청입니다.' });
    return;
  }

  const { brand, question, history } = req.body || {};

  if (!BRANDS[brand]) {
    res.status(400).json({ error: '브랜드 값이 올바르지 않습니다.' });
    return;
  }
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) {
    res.status(400).json({ error: '질문을 입력해주세요.' });
    return;
  }
  if (q.length > MAX_QUESTION_LEN) {
    res.status(400).json({ error: `질문은 ${MAX_QUESTION_LEN}자 이내로 입력해주세요.` });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수에 등록해주세요.',
    });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // 문의 응대는 깊은 추론이 필요 없다. 생각을 끄고 노력 수준을 낮춰
      // 응답 속도와 비용을 챙긴다.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      // 지식 베이스는 매 요청 똑같으므로 캐시에 올린다. 캐시된 부분은 약 1/10
      // 가격으로 계산된다.
      system: [
        {
          type: 'text',
          text: getSystem(brand),
          cache_control: { type: 'ephemeral' },
        },
      ],
      // 매번 달라지는 내용(대화·질문)은 반드시 캐시 구간 뒤에 온다.
      messages: [...sanitizeHistory(history), { role: 'user', content: q }],
    });

    const answer = groundAnswer(extractText(message));

    res.status(200).json({
      answer,
      // 프론트에서 "모르는 답변"을 다르게 보여줄 수 있도록 알려준다
      unanswered: answer === FALLBACK,
      // 캐시가 실제로 도는지 확인용. 0이 계속 나오면 캐싱이 깨진 것이다.
      usage: {
        cache_read: message.usage?.cache_read_input_tokens ?? 0,
        cache_write: message.usage?.cache_creation_input_tokens ?? 0,
        input: message.usage?.input_tokens ?? 0,
        output: message.usage?.output_tokens ?? 0,
      },
    });
  } catch (err) {
    // 원인을 구분해서 한국어로 안내한다. 프론트는 이 문구를 그대로 보여준다.
    const status = err?.status;
    let msg = '답변을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.';
    if (status === 401) msg = 'API 키가 올바르지 않습니다. 담당자에게 알려주세요.';
    else if (status === 429) msg = '요청이 몰리고 있습니다. 잠시 후 다시 시도해주세요.';
    else if (status >= 500) msg = '일시적인 서버 문제입니다. 잠시 후 다시 시도해주세요.';
    console.error('[chat] 실패:', err?.message || err);
    res.status(502).json({ error: msg });
  }
}
