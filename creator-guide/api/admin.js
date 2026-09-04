// POST /api/admin — 담당자용. 접수된 진행 정보를 읽고, 확정 표시를 남긴다.
//
// 왜 하나로 묶었나:
//   목록 조회·확정·확정 취소가 모두 "관리자 코드를 확인한 뒤 저장소를 다룬다"는
//   같은 절차를 거친다. 파일을 나누면 그 절차를 세 번 복사해야 하고, 한 곳만
//   고치는 실수가 생긴다. action 하나로 갈라 쓴다.
//
// 인증:
//   관리자 코드(ADMIN_PASSWORD)를 서버에서 대조한다. 가이드 본문 잠금과 달리
//   여기는 서버가 있으므로 브라우저에 정답을 내려보낼 이유가 없다.
//   ⚠️ 코드 값 자체는 저장소 어디에도 적지 않는다. Vercel 환경변수에만 둔다.
//
// 환경변수:
//   ADMIN_PASSWORD  — 담당자용 접속 코드 (가이드 접속 코드와 다른 값이어야 한다)
//   GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO / GITHUB_LOG_BRANCH(기본 chatbot-logs)

import { readGithubFile, writeGithubFile } from '../lib/github.js';

const CONFIRMED_PATH = 'creator-logs/confirmed.json';
const MAX_MONTHS = 6;   // 최근 몇 달치까지 훑을지

function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

// 코드를 글자 하나하나 비교하면 "몇 글자까지 맞았는지"가 응답 시간에 드러날 수
// 있다. 길이와 무관하게 항상 끝까지 비교해서 그 단서를 없앤다.
function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!x || !y) return false;
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function recentMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

async function loadConfirmed(gh) {
  const f = await readGithubFile({ ...gh, path: CONFIRMED_PATH });
  if (!f) return { map: {}, sha: undefined };
  try {
    return { map: JSON.parse(f.content) || {}, sha: f.sha };
  } catch {
    // 파일이 깨져 있어도 조회는 되어야 한다. 빈 값으로 보고 계속 진행한다.
    return { map: {}, sha: f.sha };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!isSameOrigin(req)) { res.status(403).json({ ok: false }); return; }

  const { code, action, nick } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    res.status(503).json({ ok: false, reason: 'unconfigured' });
    return;
  }
  if (!safeEqual(code, process.env.ADMIN_PASSWORD)) {
    res.status(401).json({ ok: false, reason: 'code' });
    return;
  }

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'chatbot-logs',
  };
  if (!gh.token || !gh.owner || !gh.repo) {
    res.status(503).json({ ok: false, reason: 'unconfigured' });
    return;
  }

  try {
    if (action === 'confirm' || action === 'unconfirm') {
      const name = String(nick || '').trim();
      if (!name) { res.status(400).json({ ok: false, reason: 'nick' }); return; }

      const { map, sha } = await loadConfirmed(gh);
      if (action === 'confirm') map[name] = { at: new Date().toISOString() };
      else delete map[name];

      await writeGithubFile({
        ...gh,
        path: CONFIRMED_PATH,
        content: JSON.stringify(map, null, 2) + '\n',
        message: `creator-guide 확정 ${action === 'confirm' ? '표시' : '해제'} (${name})`,
        sha,
      });
      res.status(200).json({ ok: true, confirmed: map });
      return;
    }

    // 기본 동작: 목록 조회
    const rows = [];
    for (const m of recentMonths(MAX_MONTHS)) {
      const f = await readGithubFile({ ...gh, path: `creator-logs/rewards-${m}.jsonl` });
      if (!f) continue;
      for (const line of f.content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { rows.push(JSON.parse(t)); } catch { /* 깨진 줄은 건너뛴다 */ }
      }
    }
    const { map } = await loadConfirmed(gh);
    res.status(200).json({ ok: true, rows, confirmed: map });
  } catch (err) {
    console.error('[admin] 처리 실패:', err?.message || err);
    res.status(502).json({ ok: false, reason: 'io' });
  }
}
