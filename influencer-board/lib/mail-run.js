// 메일함 → 비공개 저장소 이력 가져오기의 본체. 관리 화면의 [메일 가져오기]와 매일 밤 자동 실행(api/cron-sync.js)이 같이 쓴다.
import { readGithubFile, writeGithubFile } from './github.js';

const MAIL_EVENTS_PREFIX = 'creator-logs/mail-events-';
export const MAIL_SYNC_PATH = 'creator-logs/mail-sync.json';   // 마지막으로 끝까지 가져온 시각
export const MAIL_MONTHS = 7;       // 화면에 보여줄 최근 몇 달치
const MAIL_MAX_NEW = 150;           // 한 번에 새로 읽을 최대 메일 수 (서버 함수 시간 제한 때문)

export function recentMonths(n) {
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

export async function readMailEvents(gh, months) {
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

// 달 파일에 이벤트를 기록한다. 같은 id가 이미 있으면 새 기록으로 바꿔 쓴다(기록 형식이 올라갈 때 옛 기록을 갈아끼우려고).
// 동시에 써서 충돌하면 다시 읽어 재시도한다.
export async function appendMailEvents(gh, events) {
  const byMonth = {};
  // 달 파일은 '도착 시각(ia)' 기준이다. 이미 봤는지 찾을 때도 같은 기준(since)으로 달을 고르므로, 기록과 찾기가 어긋나지 않는다.
  events.forEach((ev) => { const m = (ev.ia || ev.at).slice(0, 7); (byMonth[m] = byMonth[m] || []).push(ev); });
  let added = 0;
  for (const month of Object.keys(byMonth)) {
    const path = `${MAIL_EVENTS_PREFIX}${month}.jsonl`;
    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      const f = await readGithubFile({ ...gh, path });
      const lines = f ? f.content.split('\n').filter((l) => l.trim()) : [];
      const index = {};   // id → 줄 번호
      lines.forEach((l, n) => { try { index[JSON.parse(l).id] = n; } catch { /* 건너뜀 */ } });
      let changed = 0;
      byMonth[month].forEach((ev) => {
        const line = JSON.stringify(ev);
        if (index[ev.id] === undefined) { index[ev.id] = lines.length; lines.push(line); changed++; }
        else if (lines[index[ev.id]] !== line) { lines[index[ev.id]] = line; changed++; }
      });
      if (!changed) { done = true; break; }
      try {
        await writeGithubFile({ ...gh, path, content: lines.join('\n') + '\n', message: `creator-guide 메일 연락 이력 ${changed}건 (${month})`, sha: f ? f.sha : undefined });
        added += changed; done = true;
      } catch (err) {
        if (!/\((409|422)\)/.test(String(err && err.message))) throw err;   // 충돌이 아니면 그대로 실패
      }
    }
    if (!done) throw new Error('메일 기록 저장 충돌 (재시도 초과)');
  }
  return added;
}


// days를 주면 그만큼 거슬러 올라간다(없으면 지난번 이후). mail은 lib/mail.js 모듈, cfg는 mail.configFromEnv() 결과.
export async function runMailSync({ gh, cfg, mail, days }) {
  const daysIn = Number(days);
  // 기본은 지난번에 끝까지 가져온 시각 하루 전부터. 처음이면 지난 50일을 가져온다(끝난 협업까지 한꺼번에 끌어오지 않으려고).
  // days를 주면 그만큼 거슬러 올라간다.
  const backfill = Number.isFinite(daysIn) && daysIn >= 1;
  const sf = await readGithubFile({ ...gh, path: MAIL_SYNC_PATH });
  let last = null;
  if (sf) { try { last = JSON.parse(sf.content).at || null; } catch { /* 없는 것으로 */ } }
  const now = new Date();
  let since = backfill ? new Date(now - Math.min(daysIn, 400) * 864e5)
    : (last ? new Date(new Date(last) - 864e5) : new Date(now - 50 * 864e5));
  // 기록 형식이 올라가기 전에 쌓은 이력(버전이 낮은 것)은 새 형식으로 한 번 다시 읽어 바꿔 쓴다.
  // 사람이 따로 누르지 않아도 되게, 그 기록들이 있는 날짜까지 자동으로 거슬러 올라간다.
  const recent = await readMailEvents(gh, recentMonths(MAIL_MONTHS));
  const legacy = recent.filter((e) => (e.v || 1) < mail.MAIL_SCHEMA);
  if (!backfill && legacy.length) {
    const oldest = Math.min(...legacy.map((e) => new Date(e.ia || e.at).getTime()));
    if (Number.isFinite(oldest)) since = new Date(Math.min(since.getTime(), oldest - 864e5));
  }
  // 이미 본 메일(이력으로 쓴 것과 건너뛴 것 모두)의 열쇠 — 같은 메일을 다시 읽지 않으려고
  const haveMonths = recentMonths(MAIL_MONTHS);
  const extra = monthsSince(since, now).filter((m) => !haveMonths.includes(m));
  const all = recent.concat(await readMailEvents(gh, extra));
  const known = new Set(all.filter((e) => e.uid != null && e.folder && (e.v || 1) >= mail.MAIL_SCHEMA).map((e) => mail.mailKey(e.folder, e.uidv || '', e.uid)));
  const r = await mail.syncMail(cfg, { since, knownKeys: known, maxNew: MAIL_MAX_NEW });
  await appendMailEvents(gh, r.records);
  // 끝까지 가져왔을 때만 '지난번 시각'을 옮긴다. 거슬러 올라가는 실행은 옮기지 않는다(사이 구간을 건너뛰지 않으려고).
  if (!r.more && !backfill) {
    await writeGithubFile({ ...gh, path: MAIL_SYNC_PATH, content: JSON.stringify({ at: now.toISOString() }) + '\n', message: 'creator-guide 메일 가져오기 시각', sha: sf ? sf.sha : undefined });
  }
  return { added: r.stats.kept, stats: r.stats, ms: r.ms, more: r.more, since: since.toISOString(), folders: r.folders, missing: r.missing, available: r.available };
}
