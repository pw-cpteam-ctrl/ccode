// 매일 밤 23시(한국) 무렵 Vercel이 호출하는 자동 가져오기. 사람이 [메일 가져오기]를 누르는 것과 같은 일을 한다.
// 호출한 쪽이 Vercel인지는 CRON_SECRET으로 확인한다(환경변수에 CRON_SECRET이 있으면 Vercel이 Authorization 헤더로 같이 보내 준다).
// 인플 응대를 하는 기간(스토어 오픈일 D-7 ~ D+5)이 아니면 아무것도 하지 않고 끝낸다(lib/open-window.js).
// CRON_SECRET이 없으면 아무도 호출할 수 없게 막는다 — 비밀번호 없이 메일함을 읽는 문이 열려 있으면 안 되므로.
import { runMailSync } from '../lib/mail-run.js';
import { operatingWindow } from '../lib/open-window.js';
import { readGithubFile } from '../lib/github.js';
import { timingSafeEqual } from 'node:crypto';

const BUDGET_MS = 45000;   // 함수 제한(60초) 안에 끝내려고, 남은 메일이 있어도 이 시간이 지나면 멈춘다(다음 호출·수동 가져오기가 이어서 한다)
const MAX_ROUNDS = 20;

function sameSecret(got, want) {
  const a = Buffer.from(String(got || '')), b = Buffer.from(String(want || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false }); return; }
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(503).json({ ok: false, reason: 'cron-unconfigured' }); return; }
  if (!sameSecret(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret)) { res.status(401).json({ ok: false }); return; }

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_LOG_BRANCH || 'main',
  };
  if (!gh.token || !gh.owner || !gh.repo) { res.status(503).json({ ok: false, reason: 'unconfigured' }); return; }

  try {
    let openDays = {};
    const odf = await readGithubFile({ ...gh, path: 'creator-logs/open-days.json' });
    if (odf) { try { openDays = JSON.parse(odf.content) || {}; } catch { openDays = {}; } }
    if (!operatingWindow(new Date(), openDays).on) { res.status(200).json({ ok: true, skipped: 'rest' }); return; }
    const mail = await import('../lib/mail.js');
    const cfg = mail.configFromEnv();
    if (!cfg) { res.status(503).json({ ok: false, reason: 'mail-unconfigured' }); return; }
    const t0 = Date.now();
    let rounds = 0, kept = 0, more = false;
    do {
      const r = await runMailSync({ gh, cfg, mail });
      rounds++; kept += r.added || 0; more = !!r.more;
      if (more && !(r.stats && r.stats.processed)) break;   // 진전이 없으면 멈춘다
    } while (more && rounds < MAX_ROUNDS && Date.now() - t0 < BUDGET_MS);
    res.status(200).json({ ok: true, rounds, added: kept, more });
  } catch (err) {
    // 비밀번호·메일 내용이 로그에 남지 않게 오류 종류만 기록한다
    console.error('[cron-sync] 실패:', err && err.reason ? err.reason : String(err && err.message || err).slice(0, 120));
    res.status(500).json({ ok: false });
  }
}
