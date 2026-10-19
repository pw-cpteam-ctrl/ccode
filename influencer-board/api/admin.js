// POST /api/admin — 담당자용. 접수된 진행 정보를 읽고, 확정 표시를 남긴다.
//
// (creator-guide/api/admin.js에서 옮겨 왔다. 담당자 화면을 가이드와 떼어 따로
//  배포하기 위해서다. 크리에이터 제출은 여전히 가이드 쪽 서버가 쓰고, 여기는
//  같은 비공개 저장소의 creator-logs/를 읽고 담당자 표시만 쓴다.)
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

import { readGithubFile, writeGithubFile, repoStatus } from '../lib/github.js';

// 가이드(creator-guide/api/open-days.js)가 크리에이터 화면에 날짜를 보여주려고
// 같은 파일을 읽는다. 경로를 바꾸면 두 곳을 같이 바꿔야 한다.
// (폴더끼리 파일을 불러 쓰지 않으려고 값만 따로 적어 둔다 — CLAUDE.md 3번)
// 가이드 쪽 사본: creator-guide/api/open-days.js의 OPEN_DAYS_PATH (값은 같아야 함)
const OPEN_DAYS_PATH = 'creator-logs/open-days.json';

const CONFIRMED_PATH = 'creator-logs/confirmed.json';
// 다 끝난 건을 담당자가 손으로 내려 두는 목록. 지운 것이 아니라 가려 두는 것이라
// 기록은 그대로 남고, 언제든 되돌릴 수 있다.
const ARCHIVED_PATH = 'creator-logs/archived.json';
// 수령 방식을 담당자가 바꾼 건. 크리에이터가 낸 원래 값은 제출 기록에 그대로
// 두고, 바뀐 값만 여기에 따로 적는다 — 무엇을 골랐고 지금 무엇인지 둘 다 남는다.
const TRACK_PATH = 'creator-logs/track-override.json';
const GUARD_PATH = 'creator-logs/admin-guard.json';
// 노션에서 최종 확정된 후보. 후보 탐색·팀 의견·탈락 기록은 노션에 두고, 여기에는
// 확정된 사람만 담는다(이중 입력을 만들지 않으려고). 기존 파일을 고치지 않고
// 새 파일을 나란히 둔다 — 없으면 빈 목록으로 본다.
const CANDIDATES_PATH = 'creator-logs/candidates.json';
const CAND_NAME_MAX = 40;
const CAND_LINK_MAX = 200;
const CAND_BATCH_MAX = 200;

// 메일 연락 이력. 웍스 메일함에서 읽은 '메타데이터'(시각·방향·주소·활동명·제목)만 쌓는다 — 본문은 저장하지 않는다.
// 접수 기록처럼 달마다 한 파일에 한 줄씩 추가한다. 읽는 규칙은 lib/mail.js에 있다.
const MAIL_EVENTS_PREFIX = 'creator-logs/mail-events-';
const MAIL_SYNC_PATH = 'creator-logs/mail-sync.json';   // 마지막으로 끝까지 가져온 시각
const MAIL_MONTHS = 7;       // 화면에 보여줄 최근 몇 달치
const MAIL_MAX_NEW = 120;    // 한 번에 새로 읽을 최대 메일 수 (서버 함수 시간 제한 때문)
const MAX_MONTHS = 6;   // 최근 몇 달치까지 훑을지
// 확정 표시의 열쇠 길이 상한. 활동명(최대 20자)만 담던 자리였는데, 같은 분이
// 달마다 다시 협업하는 경우가 있어 "활동명 | 차수 시작일" 형태로 바뀌었다.
// 20자로 자르면 열쇠가 잘려 서로 다른 차수가 같은 것으로 뭉친다.
const KEY_MAX = 60;

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

// since가 속한 달부터 지금까지의 'YYYY-MM' 목록 (UTC 기준 — 이벤트 파일 이름도 UTC 월이다)
function monthsSince(since, now = new Date()) {
  const out = [];
  const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
  while (d <= now && out.length < 16) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

async function readMailEvents(gh, months) {
  const out = [];
  for (const m of months) {
    const f = await readGithubFile({ ...gh, path: `${MAIL_EVENTS_PREFIX}${m}.jsonl` });
    if (!f) continue;
    for (const line of f.content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch { /* 깨진 줄은 건너뛴다 */ }
    }
  }
  return out;
}

// 달 파일에 새 이벤트만 덧붙인다. 같은 id가 이미 있으면 건너뛰고, 동시에 써서 충돌하면 다시 읽어 재시도한다.
async function appendMailEvents(gh, events) {
  const byMonth = {};
  events.forEach((ev) => { (byMonth[ev.at.slice(0, 7)] = byMonth[ev.at.slice(0, 7)] || []).push(ev); });
  let added = 0;
  for (const month of Object.keys(byMonth)) {
    const path = `${MAIL_EVENTS_PREFIX}${month}.jsonl`;
    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      const f = await readGithubFile({ ...gh, path });
      const have = new Set();
      if (f) f.content.split('\n').forEach((l) => { try { have.add(JSON.parse(l).id); } catch { /* 건너뜀 */ } });
      const fresh = byMonth[month].filter((ev) => !have.has(ev.id));
      if (!fresh.length) { done = true; break; }
      const body = (f ? f.content.replace(/\n*$/, '\n') : '') + fresh.map((ev) => JSON.stringify(ev)).join('\n') + '\n';
      try {
        await writeGithubFile({ ...gh, path, content: body, message: `creator-guide 메일 연락 이력 ${fresh.length}건 (${month})`, sha: f ? f.sha : undefined });
        added += fresh.length; done = true;
      } catch (err) {
        if (!/\((409|422)\)/.test(String(err && err.message))) throw err;   // 충돌이 아니면 그대로 실패
      }
    }
    if (!done) throw new Error('메일 기록 저장 충돌 (재시도 초과)');
  }
  return added;
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

  const { code, action, nick, ip: targetIp, month, day, keys, track } = req.body || {};
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

    // 오픈 날짜 예외 저장. 기본은 매달 첫 목요일이고, 그와 다른 달만 남긴다.
    // day를 비우면 그 달을 목록에서 지워 기본 규칙으로 되돌린다.
    if (action === 'open-day') {
      const key = String(month || '').trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) { res.status(400).json({ ok: false, reason: 'month' }); return; }
      const n = day === '' || day === null || day === undefined ? null : Number(day);
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 31)) {
        res.status(400).json({ ok: false, reason: 'day' }); return;
      }

      const f = await readGithubFile({ ...gh, path: OPEN_DAYS_PATH });
      let days = {};
      if (f) { try { days = JSON.parse(f.content) || {}; } catch { days = {}; } }
      if (n === null) delete days[key]; else days[key] = n;

      // 달 순서대로 적어 둔다. 파일을 직접 열어볼 일이 있을 때 읽기 쉽다.
      const sorted = {};
      Object.keys(days).sort().forEach(function (k) { sorted[k] = days[k]; });

      await writeGithubFile({
        ...gh, path: OPEN_DAYS_PATH,
        content: JSON.stringify(sorted, null, 2) + '\n',
        message: `creator-guide 오픈일 ${n === null ? `해제 (${key})` : `지정 (${key} → ${n}일)`}`,
        sha: f ? f.sha : undefined,
      });
      res.status(200).json({ ok: true, days: sorted });
      return;
    }

    // 보관 / 보관 해제 — 여러 건을 한 번에 처리한다. 한 건씩 누르면 지난 달
    // 것을 정리하는 데만 수십 번을 눌러야 해서다.
    if (action === 'archive' || action === 'unarchive') {
      const list = (Array.isArray(keys) ? keys : [])
        .map((k) => String(k || '').replace(/\s+/g, ' ').trim().slice(0, KEY_MAX))
        .filter(Boolean);
      if (!list.length) { res.status(400).json({ ok: false, reason: 'keys' }); return; }

      const f = await readGithubFile({ ...gh, path: ARCHIVED_PATH });
      let map = {};
      if (f) { try { map = JSON.parse(f.content) || {}; } catch { map = {}; } }
      const at = new Date().toISOString();
      // stage: 'part'는 선지급 1차만 나간 중간 상태, 'full'은 다 나간 상태.
      // 예전에 저장된 { at }만 있는 기록은 'full'로 본다.
      const stage = String(req.body?.stage || 'full') === 'part' ? 'part' : 'full';
      list.forEach((k) => { if (action === 'archive') map[k] = { at, stage }; else delete map[k]; });

      await writeGithubFile({
        ...gh, path: ARCHIVED_PATH,
        content: JSON.stringify(map, null, 2) + '\n',
        message: `creator-guide ${action === 'archive' ? '보관' : '보관 해제'} ${list.length}건`,
        sha: f ? f.sha : undefined,
      });
      res.status(200).json({ ok: true, archived: map });
      return;
    }

    // 수령 방식 바꾸기. track을 비우면 바꾼 기록을 지워 원래 제출값으로 돌아간다.
    if (action === 'track') {
      const key = String(nick || '').replace(/\s+/g, ' ').trim().slice(0, KEY_MAX);
      if (!key) { res.status(400).json({ ok: false, reason: 'nick' }); return; }
      const want = String(track || '');
      if (want && want !== 'split' && want !== 'after') { res.status(400).json({ ok: false, reason: 'track' }); return; }

      const f = await readGithubFile({ ...gh, path: TRACK_PATH });
      let map = {};
      if (f) { try { map = JSON.parse(f.content) || {}; } catch { map = {}; } }
      if (want) map[key] = { track: want, at: new Date().toISOString() };
      else delete map[key];

      await writeGithubFile({
        ...gh, path: TRACK_PATH,
        content: JSON.stringify(map, null, 2) + '\n',
        message: `creator-guide 수령 방식 ${want ? `변경 (${key} → ${want})` : `되돌림 (${key})`}`,
        sha: f ? f.sha : undefined,
      });
      res.status(200).json({ ok: true, trackOverride: map });
      return;
    }

    // 확정 후보 추가 / 삭제. 추가는 여러 건을 한 번에 받는다(노션 표를 붙여넣어 올리므로).
    // 활동명이 열쇠이고, 이미 있는 이름은 새로 쓰지 않고 건너뛴다.
    if (action === 'cand-add' || action === 'cand-remove') {
      const f = await readGithubFile({ ...gh, path: CANDIDATES_PATH });
      let map = {};
      if (f) { try { map = JSON.parse(f.content) || {}; } catch { map = {}; } }
      const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
      let added = 0;
      if (action === 'cand-add') {
        const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, CAND_BATCH_MAX);
        const at = new Date().toISOString();
        items.forEach((it) => {
          const name = clean(it?.name, CAND_NAME_MAX);
          if (!name || map[name]) return;
          const link = clean(it?.link, CAND_LINK_MAX);
          map[name] = { at, ...(/^https?:\/\//.test(link) ? { link } : {}) };
          added++;
        });
        if (!added) { res.status(200).json({ ok: true, candidates: map, added: 0 }); return; }
      } else {
        const name = clean(nick, CAND_NAME_MAX);
        if (!name) { res.status(400).json({ ok: false, reason: 'nick' }); return; }
        delete map[name];
      }
      await writeGithubFile({
        ...gh, path: CANDIDATES_PATH,
        content: JSON.stringify(map, null, 2) + '\n',
        message: `creator-guide 확정 후보 ${action === 'cand-add' ? `추가 ${added}건` : '삭제'}`,
        sha: f ? f.sha : undefined,
      });
      res.status(200).json({ ok: true, candidates: map, added });
      return;
    }

    // ─── 메일 연락 이력 ─────────────────────────────────────────
    // 저장된 이력 읽기. 메일 접속 설정이 없어도 읽을 수 있다(없으면 빈 목록).
    if (action === 'mail-events') {
      const events = await readMailEvents(gh, recentMonths(MAIL_MONTHS));
      const sf = await readGithubFile({ ...gh, path: MAIL_SYNC_PATH });
      let syncedAt = null;
      if (sf) { try { syncedAt = JSON.parse(sf.content).at || null; } catch { /* 없는 것으로 */ } }
      res.status(200).json({ ok: true, events, syncedAt, configured: !!process.env.MAIL_USER && !!process.env.MAIL_APP_PASSWORD && !!process.env.MAIL_FOLDERS });
      return;
    }

    // 폴더 확인 / 지금 가져오기. IMAP 라이브러리는 이 두 동작에서만 불러온다(다른 동작이 느려지지 않게).
    if (action === 'mail-folders' || action === 'mail-sync') {
      const mail = await import('../lib/mail.js');
      const cfg = mail.configFromEnv();
      if (!cfg) { res.status(503).json({ ok: false, reason: 'mail-unconfigured' }); return; }
      try {
        if (action === 'mail-folders') {
          res.status(200).json({ ok: true, ...(await mail.listFolders(cfg)) });
          return;
        }
        // 기본은 지난번에 끝까지 가져온 시각 하루 전부터(없으면 30일 전). days를 주면 그만큼 거슬러 올라간다.
        const daysIn = Number(req.body && req.body.days);
        const backfill = Number.isFinite(daysIn) && daysIn >= 1;
        const sf = await readGithubFile({ ...gh, path: MAIL_SYNC_PATH });
        let last = null;
        if (sf) { try { last = JSON.parse(sf.content).at || null; } catch { /* 없는 것으로 */ } }
        const now = new Date();
        const since = backfill ? new Date(now - Math.min(daysIn, 400) * 864e5)
          : (last ? new Date(new Date(last) - 864e5) : new Date(now - 30 * 864e5));
        const known = new Set((await readMailEvents(gh, monthsSince(since, now))).map((e) => e.id));
        const r = await mail.syncMail(cfg, { since, knownIds: known, maxNew: MAIL_MAX_NEW });
        const added = await appendMailEvents(gh, r.events);
        // 끝까지 가져왔을 때만 '지난번 시각'을 옮긴다. 거슬러 올라가는 실행은 옮기지 않는다(사이 구간을 건너뛰지 않으려고).
        if (!r.more && !backfill) {
          await writeGithubFile({ ...gh, path: MAIL_SYNC_PATH, content: JSON.stringify({ at: now.toISOString() }) + '\n', message: 'creator-guide 메일 가져오기 시각', sha: sf ? sf.sha : undefined });
        }
        res.status(200).json({ ok: true, added, scanned: r.scanned, more: r.more, since: since.toISOString(), folders: r.folders, missing: r.missing, available: r.available });
        return;
      } catch (err) {
        if (err && typeof err.reason === 'string' && err.reason.indexOf('mail-') === 0) {
          console.error('[admin] 메일 접속 실패:', err.reason, err.message);
          res.status(502).json({ ok: false, reason: err.reason });
          return;
        }
        throw err;
      }
    }

    if (action === 'confirm' || action === 'unconfirm') {
      const name = String(nick || '').replace(/\s+/g, ' ').trim().slice(0, KEY_MAX);
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
    // 저장소를 못 보는 키로 목록을 읽으면 '기록 없음'과 구분이 안 돼 빈 화면이 나온다.
    // 먼저 확인해서, 안 되면 빈 목록 대신 이유를 알려준다(코드는 이미 통과한 사용자에게만 보인다).
    const rs = await repoStatus(gh);
    if (rs !== 200) {
      res.status(502).json({ ok: false, reason: rs === 401 ? 'token' : rs === 403 ? 'perm' : 'repo', status: rs });
      return;
    }
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
    // 오픈일도 같이 내려보낸다. 관리자 화면이 따로 한 번 더 부르지 않게 한다.
    let trackOverride = {};
    try {
      const tf = await readGithubFile({ ...gh, path: TRACK_PATH });
      if (tf) trackOverride = JSON.parse(tf.content) || {};
    } catch (err) { console.error('[admin] 수령 방식 변경 목록 조회 실패:', err?.message || err); }

    let archived = {};
    try {
      const ar = await readGithubFile({ ...gh, path: ARCHIVED_PATH });
      if (ar) archived = JSON.parse(ar.content) || {};
    } catch (err) { console.error('[admin] 보관 목록 조회 실패:', err?.message || err); }

    let openDays = {};
    try {
      const od = await readGithubFile({ ...gh, path: OPEN_DAYS_PATH });
      if (od) openDays = JSON.parse(od.content) || {};
    } catch (err) { console.error('[admin] 오픈일 조회 실패:', err?.message || err); }
    // 차단된 곳이 있으면 화면에 같이 보여준다 — 담당자가 풀어줘야 하기 때문이다.
    const blocked = Object.fromEntries(
      Object.entries(guard).filter(([, v]) => v?.blocked)
    );
    let candidates = {};
    try {
      const cf = await readGithubFile({ ...gh, path: CANDIDATES_PATH });
      if (cf) candidates = JSON.parse(cf.content) || {};
    } catch (err) { console.error('[admin] 확정 후보 조회 실패:', err?.message || err); }
    res.status(200).json({ ok: true, rows, confirmed: map, blocked, openDays, archived, trackOverride, candidates });
  } catch (err) {
    console.error('[admin] 처리 실패:', err?.message || err);
    res.status(502).json({ ok: false, reason: 'io' });
  }
}
