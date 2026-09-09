// POST /api/log-question — 크리에이터가 챗봇에 물어본 질문과 받은 답변을 기록한다.
//
// 왜 필요한가:
//   "어떤 질문이 제일 많이 들어오는지"를 알아야 가이드에서 빠졌거나 설명이 부족한
//   부분을 찾을 수 있다. 특히 챗봇이 답하지 못한 질문(unanswered)이 곧 가이드의
//   구멍이다.
//
// 어디에 쌓이나:
//   비공개 저장소(ccode-private)의  creator-logs/questions-YYYY-MM.jsonl
//   크리에이터가 대화 중에 계정명이나 연락처를 적을 수 있어, 공개 저장소에
//   두지 않는다. 배포 프로젝트가 붙어 있지 않아 배포 횟수도 쓰지 않는다.
//   2026-09-04 이전 기록은 공개 저장소(ccode)의 main·chatbot-logs 브랜치에 남아 있다.
//
// 환경변수(없으면 기록을 조용히 건너뛴다 — 챗봇 기능 자체엔 전혀 영향 없음):
//   GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO / GITHUB_LOG_BRANCH(비공개 저장소의 main)
//
// ⚠️ 개인정보: 크리에이터가 채팅에 계정명·연락처를 적을 수 있다. 비공개 저장소로
//    옮긴 뒤에도 저장 직전에 아래 scrub()로 이메일·전화번호·@아이디·긴 숫자열을
//    가려서(마스킹) 남긴다. 저장 위치와 무관하게, 남길 이유가 없는 값은 애초에
//    남기지 않는 편이 안전하기 때문이다.

import { appendToGithubFile } from '../lib/github.js';

const MAX_LEN = 1000; // 한 건당 저장 길이 상한

// 이 API도 인증 없이 열려 있으므로, 브라우저가 이 사이트에서 보낸 요청만 받는다.
// (api/chat.js의 같은 로직 — 두 파일 모두 독립적으로 갖고 있게 둔다)
function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

// 개인정보로 보이는 부분을 가린다. 완벽한 차단은 불가능하지만,
// 실수로 적은 연락처가 그대로 공개 저장소에 남는 상황은 막는다.
export function scrub(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]')          // 이메일
    .replace(/\b01[0-9][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '[전화번호]') // 휴대폰
    .replace(/(^|\s)@[\w.]{2,}/g, '$1[계정]')                  // @아이디
    .replace(/\b\d{6,}\b/g, '[숫자]')                          // 계좌·주민번호 등 긴 숫자
    .slice(0, MAX_LEN);
}

export default async function handler(req, res) {
  // 기록은 부가 기능이다. 어떤 이유로 실패하든 화면에는 아무 영향이 없어야 하므로
  // 오류를 밖으로 던지지 않고 항상 200으로 응답한다.
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!isSameOrigin(req)) { res.status(403).json({ ok: false }); return; }

  // 로그는 가이드 소스가 있는 공개 저장소가 아니라 비공개 저장소에 쌓는다.
  //
  // 공개 저장소에 두면 크리에이터가 대화에 적은 계정명 같은 값을 주소만 아는
  // 사람이 볼 수 있다. 또 그 저장소에는 배포 프로젝트가 여러 개 붙어 있어서,
  // 커밋 하나가 프로젝트 수만큼 배포를 만든다(대부분 즉시 취소되지만 하루 배포
  // 횟수는 그만큼 소모된다). 문의 한 건마다 커밋이 생기는 이 기능은 사용량에
  // 비례해 그 소모가 늘어나, 문의가 몰리는 날 저장소 전체의 배포를 막을 수 있었다.
  // 비공개 저장소에는 배포 프로젝트가 없어 두 문제가 함께 사라진다.
  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'chatbot-logs',
  };
  if (!gh.token || !gh.owner || !gh.repo) {
    res.status(200).json({ ok: false, skipped: true });
    return;
  }

  const { brand, kind, question, answer, unanswered } = req.body || {};
  const q = scrub(question);
  if (!q.trim()) { res.status(200).json({ ok: false, skipped: true }); return; }

  const now = new Date();
  const month = now.toISOString().slice(0, 7); // YYYY-MM

  const line = JSON.stringify({
    at: now.toISOString(),
    brand: brand === 'brand2' ? 'brand2' : 'megahouse',
    // 'preset' = 자주 묻는 질문 버튼(LLM 호출 없음) / 'llm' = 직접 입력한 질문
    kind: kind === 'preset' ? 'preset' : 'llm',
    question: q,
    answer: scrub(answer),
    unanswered: !!unanswered,
  });

  try {
    await appendToGithubFile({
      ...gh,
      path: `creator-logs/questions-${month}.jsonl`,
      newLine: line,
      message: `creator-guide 문의 로그 (${month})`,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[log-question] 기록 실패(챗봇 동작엔 영향 없음):', err?.message || err);
    res.status(200).json({ ok: false });
  }
}
