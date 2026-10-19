// 웍스 메일함(IMAP)의 정해진 폴더만 읽기 전용으로 읽어, 연락 이력에 필요한 '메타데이터'만 뽑는다.
//
// 지키는 것:
//   · 읽기 전용 — 폴더를 EXAMINE으로 열고 BODY.PEEK로 가져와서 읽음 표시·이동·삭제가 일어나지 않는다.
//   · 본문은 저장하지 않는다 — 인사말·자기소개를 읽기 위해 앞부분만 보고, 남기는 것은
//     시각·방향·주소·활동명·제목뿐이다.
//   · 읽을 폴더는 환경변수 MAIL_FOLDERS에 적은 것만이다. (웍스가 강제하는 제한이 아니라 이 코드의 제한이다 —
//     외부 앱 비밀번호 자체는 메일함 전체를 열 수 있다.)
//
// 인사말·자기소개를 읽는 규칙(greetName / introName)은 index.html의 연락 이력 코드
// (mailGreetName / mailIntroName)와 같아야 한다. 한 파일에서 불러다 쓸 수 없는 구조(화면은
// 번들 없이 한 파일)라 복사해 두었으니, 한쪽을 고치면 다른 쪽도 같이 고친다.
//
// 환경변수(없으면 메일 가져오기를 건너뛴다):
//   MAIL_USER          웍스 메일 주소
//   MAIL_APP_PASSWORD  웍스 '외부 앱 비밀번호' (주 비밀번호가 아니다)
//   MAIL_FOLDERS       읽을 폴더 이름. 여러 개면 쉼표로 구분 (예: Megahouse 협업)
//   MAIL_HOST / MAIL_PORT / MAIL_SECURE  — 기본 imap.worksmobile.com / 993 / true. 시험할 때만 바꾼다.

import crypto from 'node:crypto';

export const MY_MAIL_RE = /@presenceworld\.co\.kr$/i;
const GREET_RE = /안녕하세요[,.!]?\s*([^\s,!.]{1,12}(?: [^\s,!.]{1,12})?)\s*님/;
const INTRO_STOP = { '것': 1, '저': 1, '제': 1, '점': 1, '때': 1, '이': 1 };
const SOURCE_BYTES = 12000;     // 메일마다 앞쪽 이만큼만 가져온다 (첨부가 큰 메일을 통째로 받지 않으려고). 인사말은 맨 위에 있다
const SUBJECT_MAX = 200;

export class MailError extends Error {
  constructor(reason, detail) { super(detail || reason); this.reason = reason; }
}

export function configFromEnv(env = process.env) {
  const user = String(env.MAIL_USER || '').trim();
  const pass = String(env.MAIL_APP_PASSWORD || '');
  const folders = String(env.MAIL_FOLDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!user || !pass || !folders.length) return null;
  return {
    host: env.MAIL_HOST || 'imap.worksmobile.com',
    port: Number(env.MAIL_PORT) || 993,
    secure: env.MAIL_SECURE !== 'false',
    user, pass, folders,
  };
}

// ─── 규칙 (index.html과 같은 규칙) ─────────────────────────────
function firstLines(t, n) {
  return String(t || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, n).join('\n');
}
export function greetName(text) { const m = GREET_RE.exec(firstLines(text, 4)); return m ? m[1].trim() : null; }
export function introName(text) {
  const h = firstLines(text, 6);
  const m = /안녕하세요[,.!]?\s*([^\s,!.]{1,12}(?: [^\s,!.]{1,12})?)입니다/.exec(h) || /([^\s,!.<>]{1,12})입니다/.exec(h);
  const n = m && m[1].trim();
  return n && !INTRO_STOP[n] ? n : null;
}

// ─── 폴더 이름 맞추기 ─────────────────────────────────────────
// 한글은 같은 글자라도 완성형(NFC)과 분해형(NFD)이 달라 === 로는 다르다고 나올 수 있다.
// 대소문자·앞뒤 공백까지 맞춰서 비교하고, 전체 경로("INBOX/폴더")와 이름("폴더") 둘 다 본다.
export const normName = (s) => String(s || '').normalize('NFC').trim().toLowerCase();

export function matchFolders(list, wanted) {
  const usable = list.filter((l) => !(l.flags && l.flags.has && l.flags.has('\\Noselect')));
  const found = [], missing = [];
  wanted.forEach((w) => {
    const n = normName(w);
    const hit = usable.find((l) => normName(l.path) === n) || usable.find((l) => normName(l.name) === n);
    if (hit) found.push({ want: w, path: hit.path }); else missing.push(w);
  });
  return { found, missing };
}

// ─── 메일 한 통 → 이벤트 ──────────────────────────────────────
const addrList = (x) => {
  const arr = Array.isArray(x) ? x : (x ? [x] : []);
  return arr.flatMap((o) => (o.value || [])).map((v) => String(v.address || '').toLowerCase()).filter(Boolean);
};
const textOf = (parsed) => {
  if (parsed.text) return parsed.text;
  if (parsed.html) return String(parsed.html).replace(/<(br|\/p|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return '';
};

export function eventId(messageId, folder, uid) {
  return crypto.createHash('sha1').update(String(messageId || folder + ':' + uid)).digest('hex').slice(0, 16);
}

// parsed: mailparser의 결과. 우리가 보낸 'FW:' 메일은 전달한 것이라 이력에서 뺀다(null).
export function eventFromParsed(parsed, { folder, uid, messageId, date }) {
  const at = parsed.date || date;
  if (!at || isNaN(at)) return null;
  const sender = addrList(parsed.from)[0] || null;
  if (!sender) return null;   // 보낸 사람이 없으면 누구와의 연락인지 알 수 없다 — 빈 이력을 만들지 않는다
  const mine = MY_MAIL_RE.test(sender);
  const subject = String(parsed.subject || '').trim();
  if (mine && /^\s*(fw|fwd)\s*:/i.test(subject)) return null;
  const tos = [...addrList(parsed.to), ...addrList(parsed.cc)];
  const addr = mine ? (tos.find((a) => !MY_MAIL_RE.test(a)) || null) : sender;
  const text = textOf(parsed);
  return {
    id: eventId(messageId || parsed.messageId, folder, uid),
    at: new Date(at).toISOString(),
    dir: mine ? '보냄' : '받음',
    addr,
    name: mine ? greetName(text) : introName(text),
    subject: subject.slice(0, SUBJECT_MAX),
    folder,
  };
}

// ─── IMAP ────────────────────────────────────────────────────
async function connect(cfg) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  client.on('error', () => { /* 연결이 끊기면 아래 호출에서 오류로 드러난다 */ });
  try { await client.connect(); }
  catch (err) { throw toMailError(err); }
  return client;
}
function toMailError(err) {
  if (err instanceof MailError) return err;
  if (err && err.authenticationFailed) return new MailError('mail-auth');
  const code = err && (err.code || (err.cause && err.cause.code));
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) return new MailError('mail-connect');
  return new MailError('mail-imap', String(err && err.message || err).slice(0, 120));
}

// 폴더 목록과 설정한 폴더가 맞는지만 본다(메일은 읽지 않는다).
export async function listFolders(cfg) {
  const client = await connect(cfg);
  try {
    const list = await client.list();
    const { found, missing } = matchFolders(list, cfg.folders);
    return { available: list.filter((l) => !(l.flags && l.flags.has('\\Noselect'))).map((l) => l.path), found, missing };
  } catch (err) { throw toMailError(err); }
  finally { try { await client.logout(); } catch { /* 이미 끊김 */ } }
}

// 메일 한 통을 '봤다'는 표시의 열쇠. 폴더 + UIDVALIDITY(폴더가 다시 만들어지면 바뀜) + UID.
export const mailKey = (folder, uidv, uid) => `${folder}\u0000${uidv}\u0000${uid}`;

const CHUNK = 15;   // 한 번에 가져오는 묶음. 시간 확인은 묶음 사이에서만 한다 — 첫 묶음은 항상 끝낸다.

// since 이후 메일 중 knownKeys에 없는 것만 최신순으로 읽는다.
//
// 진전이 없을 수 없게 만든 구조다(예전에는 247통을 한꺼번에 받다가 시간이 다 돼 한 통도 못 쓰고 끝나,
// 누를 때마다 같은 자리에서 다시 시작했다):
//   · 1단계는 UID 목록만 받는다(검색 한 번). 헤더를 전부 받지 않는다.
//   · 새 메일을 CHUNK통씩 끊어 처리하고, 한 묶음이 끝날 때마다 시간을 본다. 첫 묶음은 시간과 상관없이 끝낸다.
//   · 전달(FW) 메일·읽지 못한 메일도 '봤음' 기록(skip)으로 남겨 다음에 또 읽지 않게 한다.
// 시간이 모자라면 more=true — 한 번 더 누르면 이어서 한다.
export async function syncMail(cfg, { since, knownKeys, maxNew = 150, deadlineMs = 6000 }) {
  const { simpleParser } = await import('mailparser');
  const started = Date.now();
  const client = await connect(cfg);
  const records = [];            // 이력(또는 skip 기록)
  const stats = { found: 0, fresh: 0, processed: 0, kept: 0, skipped: 0, failed: 0 };
  let more = false;
  try {
    const list = await client.list();
    const { found, missing } = matchFolders(list, cfg.folders);
    const available = list.filter((l) => !(l.flags && l.flags.has('\\Noselect'))).map((l) => l.path);

    for (const f of found) {
      const lock = await client.getMailboxLock(f.path, { readOnly: true });   // EXAMINE: 아무것도 바꾸지 않는다
      try {
        const uidv = String(client.mailbox && client.mailbox.uidValidity || '');
        const uids = (await client.search({ since }, { uid: true })) || [];
        stats.found += uids.length;
        const fresh = uids.filter((u) => !knownKeys.has(mailKey(f.path, uidv, u))).sort((a, b) => b - a);   // 최신(큰 UID)부터
        stats.fresh += fresh.length;
        const todo = fresh.slice(0, Math.max(0, maxNew - stats.processed));
        if (fresh.length > todo.length) more = true;

        for (let i = 0; i < todo.length; i += CHUNK) {
          if (stats.processed > 0 && Date.now() - started > deadlineMs) { more = true; break; }
          const chunk = todo.slice(i, i + CHUNK);
          for await (const m of client.fetch(chunk.join(','), { uid: true, envelope: true, internalDate: true, source: { start: 0, maxLength: SOURCE_BYTES } }, { uid: true })) {
            const messageId = m.envelope && m.envelope.messageId;
            const base = { folder: f.path, uid: m.uid, uidv };
            let rec = null;
            try {
              const parsed = await simpleParser(m.source);
              rec = eventFromParsed(parsed, { ...base, messageId, date: m.internalDate });
              if (rec) stats.kept++; else { stats.skipped++; }
            } catch { stats.failed++; }
            if (!rec) {
              // 이력으로 안 쓰는 메일(전달 메일 등)·읽지 못한 메일: '봤음'만 남긴다
              rec = { id: eventId(messageId, f.path, m.uid), at: new Date(m.internalDate || Date.now()).toISOString(), skip: 1 };
            }
            // ia: 메일함에 도착한 시각. 어느 달 파일에 기록할지·이미 봤는지 찾을 달을 정하는 기준이다 —
            // 메일 머리글의 날짜(at)와 도착 날짜가 다를 수 있어, 둘을 섞으면 같은 메일을 계속 새 메일로 착각한다.
            records.push({ ...rec, ...base, ia: new Date(m.internalDate || Date.now()).toISOString() });
            stats.processed++;
          }
        }
      } finally { lock.release(); }
      if (more) break;
    }
    return { records, stats, more, folders: found.map((x) => x.path), missing, available, ms: Date.now() - started };
  } catch (err) { throw toMailError(err); }
  finally { try { await client.logout(); } catch { /* 이미 끊김 */ } }
}
