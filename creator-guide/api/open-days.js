// GET /api/open-days — 그 달의 오픈 날짜가 기본 규칙(첫 목요일)과 다른 달 목록.
//
// 왜 따로 두나:
//   오픈 날짜는 메가하우스 쪽 사정으로 그때그때 정해져서 계산으로 알 수 없다.
//   예전에는 코드 안에 한 줄씩 적어 두고 담당자가 알려줄 때마다 개발 쪽에서
//   고쳐 올렸는데, 그러면 날짜 하나 바꾸는 데도 배포가 필요했다.
//   이제는 관리자 화면에서 넣으면 비공개 저장소의 파일에 저장되고,
//   가이드 페이지가 이 주소로 읽어 간다.
//
// 읽기 전용이다. 값을 바꾸는 것은 관리자 코드를 확인하는 /api/admin 쪽이다.
// 날짜는 가이드를 보는 분들에게 보여줄 정보라 코드 확인 없이 내려보낸다.
// (대신 같은 사이트에서 온 요청만 받는다)
//
// 환경변수: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO / GITHUB_LOG_BRANCH

import { readGithubFile } from '../lib/github.js';

export const OPEN_DAYS_PATH = 'creator-logs/open-days.json';

function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false }); return; }
  if (!isSameOrigin(req)) { res.status(403).json({ ok: false }); return; }

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'main',
  };
  // 설정이 없거나 읽기에 실패해도 화면이 멈추면 안 된다. 빈 목록을 돌려주면
  // 가이드 페이지는 코드에 적힌 기본 규칙(첫 목요일)으로 그대로 돌아간다.
  if (!gh.token || !gh.owner || !gh.repo) { res.status(200).json({ ok: true, days: {} }); return; }

  try {
    const f = await readGithubFile({ ...gh, path: OPEN_DAYS_PATH });
    const days = f ? (JSON.parse(f.content) || {}) : {};
    // 같은 달에 여러 번 열어보는 화면이라 잠깐 묶어 둔다. 날짜를 바꾸면
    // 길어야 1분 뒤에는 모두에게 반영된다.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ ok: true, days });
  } catch (err) {
    console.error('[open-days] 조회 실패:', err?.message || err);
    res.status(200).json({ ok: true, days: {} });
  }
}
