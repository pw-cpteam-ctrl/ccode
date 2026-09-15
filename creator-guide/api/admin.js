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
//   GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO / GITHUB_LOG_BRANCH(비공개 저장소의 main)

import { readGithubFile, writeGithubFile } from '../lib/github.js';

const CONFIRMED_PATH = 'creator-logs/confirmed.json';
const GUARD_PATH = 'creator-logs/admin-guard.json';
const MAX_MONTHS = 6;   // 최근 몇 달치까지 훑을지
const NICK_MAX = 20;    // 접수 API와 같은 값 — 두 곳의 이름이 어긋나면 안 된다

// ─── 코드 찔러보기 막기 ──────────────────────────────────────────
// 코드가 틀려도 응답만 돌아오고 끝이라, 자동으로 계속 넣어볼 수 있었다.
// 틀린 횟수를 접속 지점(IP)별로 세어 두 단계로 막는다.
//   5번 틀림  → 잠시 잠금. 시간이 지나면 저절로 풀린다.
//   10번 넘김 → 완전 차단. 시간이 지나도 안 풀리고, 담당자가 직접 풀어야 한다.
// 세어둔 값은 비공개 저장소에 남긴다. 서버는 요청이 끝나면 기억을 잃어서,
// 서버 안에만 두면 껐다 켜는 것만으로 횟수가 초기화되기 때문이다.
const FAIL_SOFT = 5;        // 이만큼 틀리면 잠시 잠금
const FAIL_HARD = 10;       // 이 횟수를 넘기면 완전 차단
const COOL_MIN = 10;        // 잠시 잠금이 풀리기까지 걸리는 시간(분)

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] || '').trim() || 'unknown';
}

async function loadGuard(gh) {
  const f = await readGithubFile({ ...gh, path: GUARD_PATH });
  if (!f) return { map: {}, sha: undefined };
  try { return { map: JSON.parse(f.content) || {}, sha: f.sha }; }
  catch { return { map: {}, sha: f.sha }; }
}

async function saveGuard(gh, map, sha, why) {
  await writeGithubFile({
    ...gh, path: GUARD_PATH,
    content: JSON.stringify(map, null, 2) + '\n',
    message: `creator-guide 관리자 접근 ${why}`,
    sha,
  });
}

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

  const { code, action, nick, ip: targetIp } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    res.status(503).json({ ok: false, reason: 'unconfigured' });
    return;
  }

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'main',
  };
  if (!gh.token || !gh.owner || !gh.repo) {
    res.status(503).json({ ok: false, reason: 'unconfigured' });
    return;
  }

  // ─── 코드 확인 (찔러보기 막기 포함) ────────────────────────────
  const ip = clientIp(req);
  let guard, guardSha;
  try {
    const g = await loadGuard(gh);
    guard = g.map; guardSha = g.sha;
  } catch (err) {
    // 기록을 못 읽는다고 관리자를 막아버리면 정작 필요할 때 못 들어온다.
    // 이 경우엔 횟수 제한 없이 코드만 확인한다.
    console.error('[admin] 접근 기록 조회 실패:', err?.message || err);
    guard = {};
  }
  const entry = guard[ip];

  // 완전 차단된 곳은 코드가 맞아도 들여보내지 않는다. 여기서 아무것도 쓰지
  // 않는 것이 중요하다 — 계속 두드려도 기록만 늘어나지 않게 하기 위해서다.
  if (entry?.blocked) {
    res.status(403).json({ ok: false, reason: 'blocked' });
    return;
  }
  // 잠시 잠금 — 마지막으로 틀린 뒤 COOL_MIN분이 지나야 다시 시도할 수 있다.
  //
  // 잠긴 동안 두드린 것도 실패로 센다. 세지 않으면 "10분 기다렸다 한 번"을
  // 반복하는 식으로 영원히 완전 차단을 피할 수 있기 때문이다. 안내를 따라
  // 기다리는 담당자는 그동안 시도하지 않으므로 늘어날 일이 없다.
  if (entry && entry.fails >= FAIL_SOFT) {
    const left = COOL_MIN * 60000 - (Date.now() - new Date(entry.lastAt).getTime());
    if (left > 0) {
      const fails = entry.fails + 1;
      const blocked = fails > FAIL_HARD;
      guard[ip] = { ...entry, fails, blocked, lastAt: new Date().toISOString() };
      try { await saveGuard(gh, guard, guardSha, blocked ? `차단 (${ip})` : `잠금 중 시도 ${fails}회 (${ip})`); }
      catch (err) { console.error('[admin] 접근 기록 저장 실패:', err?.message || err); }

      if (blocked) { res.status(403).json({ ok: false, reason: 'blocked' }); return; }
      res.status(429).json({ ok: false, reason: 'cooldown', minutes: Math.ceil(left / 60000) });
      return;
    }
  }

  if (!safeEqual(code, process.env.ADMIN_PASSWORD)) {
    const fails = (entry?.fails || 0) + 1;
    const blocked = fails > FAIL_HARD;
    guard[ip] = { fails, blocked, firstAt: entry?.firstAt || new Date().toISOString(), lastAt: new Date().toISOString() };
    try { await saveGuard(gh, guard, guardSha, blocked ? `차단 (${ip})` : `실패 ${fails}회 (${ip})`); }
    catch (err) { console.error('[admin] 접근 기록 저장 실패:', err?.message || err); }

    if (blocked) { res.status(403).json({ ok: false, reason: 'blocked' }); return; }
    if (fails >= FAIL_SOFT) { res.status(429).json({ ok: false, reason: 'cooldown', minutes: COOL_MIN }); return; }
    res.status(401).json({ ok: false, reason: 'code', left: FAIL_SOFT - fails });
    return;
  }

  // 코드가 맞았으면 그동안 쌓인 실패 기록을 지운다.
  if (entry) {
    delete guard[ip];
    try { await saveGuard(gh, guard, guardSha, `정상 접속으로 실패 기록 삭제 (${ip})`); }
    catch (err) { console.error('[admin] 접근 기록 저장 실패:', err?.message || err); }
    guardSha = undefined; // 방금 썼으므로 이 요청 안에서 다시 쓰지 않는다
  }

  try {
    // 완전 차단을 푸는 것은 담당자만 할 수 있다. 시간이 지나도 저절로 풀리지
    // 않으므로, 차단된 곳에서 쓰던 기기가 아닌 다른 곳(예: 휴대폰)에서 들어와
    // 이 버튼을 눌러야 한다.
    if (action === 'unblock') {
      const who = String(targetIp || '').trim();
      if (!who) { res.status(400).json({ ok: false, reason: 'ip' }); return; }
      const g = await loadGuard(gh);
      delete g.map[who];
      await saveGuard(gh, g.map, g.sha, `차단 해제 (${who})`);
      res.status(200).json({ ok: true, blocked: g.map });
      return;
    }

    if (action === 'confirm' || action === 'unconfirm') {
      const name = String(nick || '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
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
    // 차단된 곳이 있으면 화면에 같이 보여준다 — 담당자가 풀어줘야 하기 때문이다.
    const blocked = Object.fromEntries(
      Object.entries(guard).filter(([, v]) => v?.blocked)
    );
    res.status(200).json({ ok: true, rows, confirmed: map, blocked });
  } catch (err) {
    console.error('[admin] 처리 실패:', err?.message || err);
    res.status(502).json({ ok: false, reason: 'io' });
  }
}
