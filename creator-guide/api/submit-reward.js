// POST /api/submit-reward — 크리에이터가 고른 협업 진행 정보를 접수한다.
//
// 왜 필요한가:
//   예전에는 화면에서 "복사해서 담당자에게 보내주세요"로 끝났다. 복사만 하고
//   안 보내는 경우가 생겨도 담당자는 알 수 없었고, 받은 뒤에도 노션에 손으로
//   옮겨 적어야 했다. 사이트가 직접 접수하면 누가 아직 안 냈는지 바로 보이고,
//   담당자는 타이핑 없이 옮기기만 하면 된다.
//
// 어디에 쌓이나:
//   같은 GitHub 저장소의  chatbot-logs 브랜치  →  creator-logs/rewards-YYYY-MM.jsonl
//   main이 아닌 브랜치에 쌓는 이유는 log-question.js와 같다 — main에 커밋이
//   올라가면 이 저장소에 붙은 배포 프로젝트가 전부 배포를 만들어 하루 배포
//   횟수를 소모하기 때문이다.
//
// 덮어쓰지 않고 계속 쌓는다:
//   "잘못 눌렀어요", "생각이 바뀌었어요" 같은 상황을 다시 제출 한 번으로
//   끝내기 위해서다. 같은 사람이 여러 번 내면 여러 줄이 남고, 가장 마지막 것이
//   유효한 값이다. 지운 기록이 없어야 나중에 확인할 수 있다.
//
//   담당자가 확정 표시를 해도 다시 내는 것을 막지 않는다. 확정은 담당자가
//   "여기까지 확인했다"고 표시해 두는 용도이지, 크리에이터를 잠그는 장치가
//   아니다. 몇 분 차이로 문이 닫히면 결국 담당자에게 문의가 들어와 일만
//   늘어난다. 확정 뒤에 새로 들어온 건은 담당자 화면에서 눈에 띄게 보여준다.
//
// 환경변수(없으면 접수를 건너뛰고 화면은 복사 안내로 되돌아간다):
//   GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO / GITHUB_LOG_BRANCH(기본 chatbot-logs)
//
// ⚠️ 개인정보: 활동명은 크리에이터가 직접 적은 값이라 연락처를 적을 수도 있다.
//    지금은 공개 저장소에 쌓이므로 저장 직전에 scrub()으로 가린다.

import { appendToGithubFile } from '../lib/github.js';

const NICK_MAX = 20;
const WISH_MAX = 60;
const MAX_LEN = 200;

// 화면에서 고를 수 있는 값만 받는다. 여기 없는 값이 오면 접수하지 않는다 —
// 화면을 거치지 않고 아무 값이나 밀어 넣는 것을 막기 위해서다.
const TRACKS = ['split', 'after'];
const REWARDS = ['coupon', 'goods'];
const BRANDS = ['megahouse', 'brand2'];

// 개인정보로 보이는 부분을 가린다.
// (log-question.js의 같은 로직 — 두 파일 모두 독립적으로 갖고 있게 둔다)
function scrub(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]')
    .replace(/\b01[0-9][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '[전화번호]')
    .replace(/(^|\s)@[\w.]{2,}/g, '$1[계정]')
    .replace(/\b\d{6,}\b/g, '[숫자]')
    .slice(0, MAX_LEN);
}

function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

// 'YYYY-MM-DD' 형태이고 실제로 존재하는 날짜인지 확인한다.
function isDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!isSameOrigin(req)) { res.status(403).json({ ok: false }); return; }

  const { brand, nick, draftDate, trackId, rewardId, wish } = req.body || {};

  const name = scrub(nick).replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
  if (!name) { res.status(400).json({ ok: false, reason: 'nick' }); return; }
  if (!isDate(draftDate)) { res.status(400).json({ ok: false, reason: 'date' }); return; }
  if (!TRACKS.includes(trackId)) { res.status(400).json({ ok: false, reason: 'track' }); return; }
  if (!REWARDS.includes(rewardId)) { res.status(400).json({ ok: false, reason: 'reward' }); return; }
  // 상품 쿠폰을 고르면 어떤 룩업인지까지 받아야 한다. 이게 없으면 담당자가
  // 결국 따로 물어보게 되어, 폼으로 받는 의미가 사라진다.
  const want = scrub(wish).replace(/\s+/g, ' ').trim().slice(0, WISH_MAX);
  if (rewardId === 'goods' && !want) { res.status(400).json({ ok: false, reason: 'wish' }); return; }

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'chatbot-logs',
  };
  // 접수할 곳이 없으면 성공했다고 말하지 않는다. 화면은 이 응답을 보고
  // 예전처럼 "복사해서 보내주세요" 안내로 되돌아간다.
  if (!gh.token || !gh.owner || !gh.repo) {
    res.status(503).json({ ok: false, reason: 'unconfigured' });
    return;
  }

  const now = new Date();
  const month = now.toISOString().slice(0, 7); // YYYY-MM

  const line = JSON.stringify({
    at: now.toISOString(),
    brand: BRANDS.includes(brand) ? brand : 'megahouse',
    nick: name,
    draftDate,
    track: trackId,
    reward: rewardId,
    wish: want,
  });

  try {
    await appendToGithubFile({
      ...gh,
      path: `creator-logs/rewards-${month}.jsonl`,
      newLine: line,
      message: `creator-guide 진행 정보 접수 (${month})`,
    });
    res.status(200).json({ ok: true, at: now.toISOString() });
  } catch (err) {
    console.error('[submit-reward] 접수 실패:', err?.message || err);
    res.status(502).json({ ok: false, reason: 'write' });
  }
}
