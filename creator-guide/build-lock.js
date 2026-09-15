#!/usr/bin/env node
// 배포할 때 가이드 본문을 '접속 코드가 있어야 읽을 수 있는 형태'로 잠근다.
//
// ─── 언제 실행되나 ───────────────────────────────────────────────
// Vercel이 배포할 때 자동으로 실행된다(vercel.json의 buildCommand).
// 손으로 실행할 일은 없다. 확인만 하고 싶다면:
//   GUIDE_PASSWORD=아무값 node build-lock.js
//
// ─── 왜 dist 폴더로 내보내나 ─────────────────────────────────────
// 예전에는 파일을 '제자리에서' 잠그고 폴더 전체를 그대로 올렸다. 그랬더니
// .jsx만 지워질 뿐, 그 폴더의 나머지 파일이 전부 웹에 열려 있었다.
// 특히 챗봇이 쓰는 knowledge-*.md — 가이드 알맹이가 그대로 적힌 파일이
// 주소만 치면 열려서, 본문을 암호로 잠근 의미가 없었다. 설계 문서와 작업
// 기록(PLAN.md, WORKLOG 등), 서버 코드까지 같이 열려 있었다.
//
// 그래서 방식을 뒤집었다. "위험한 걸 골라 지운다"가 아니라 **"올려도 되는
// 것만 골라 담는다"**. 아래 PUBLIC 목록에 없는 파일은 배포되지 않는다.
// 새 파일을 만들었는데 화면에 안 나온다면 이 목록에 넣는 것을 잊은 것이다.
//
// 챗봇 서버(api/chat.js)는 knowledge-*.md를 계속 읽는다 — 서버 코드는 dist가
// 아니라 저장소의 api/ 폴더에서 따로 빌드되고, 필요한 파일은 vercel.json의
// functions.includeFiles로 딸려 간다. 즉 서버는 읽고 브라우저는 못 받는다.
//
// ─── ⚠️ 중요: 저장소의 원본 파일은 바뀌지 않는다 ─────────────────
// 여기서 만드는 건 Vercel이 배포용으로 따로 복사해 간 사본이다. 판님 컴퓨터나
// GitHub의 원본은 그대로다. 가이드 내용을 고칠 땐 지금까지와 똑같이 .jsx 파일만
// 고치면 되고, 잠그는 일은 신경 쓸 필요가 없다.
//
// ─── 무슨 일을 하나 ──────────────────────────────────────────────
// 1. index.html이 불러오는 jsx 코드를 전부 모은다
// 2. 접속 코드(GUIDE_PASSWORD)로 읽을 수 없게 변환해 dist/locked/*.enc 로 저장
// 3. jsx를 부르는 부분을 지우고 gate.js(코드 입력 화면)를 넣어 dist에 쓴다
// 4. 공개해도 되는 파일만 dist로 복사한다  ← 이게 빠지면 잠그는 의미가 없다
//
// ─── 접속 코드를 바꾸려면 ────────────────────────────────────────
// ACCESS-creator-guide.md 참고. 요약하면 Vercel 대시보드에서 GUIDE_PASSWORD 값을
// 바꾼 뒤, 이 폴더의 파일을 한 줄이라도 고쳐서 push 해야 한다
// (vercel.json의 ignoreCommand 때문에 폴더에 변경이 없으면 배포가 건너뛰어진다).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'dist');          // 실제로 배포되는 폴더
const LOCK_DIR = path.join(OUT, 'locked');

// 브라우저가 받아도 되는 것만 여기 적는다. 폴더 이름을 적으면 통째로 복사된다.
// ⚠️ 여기에 없는 파일은 배포되지 않는다. 특히 다음은 절대 넣지 말 것:
//    knowledge-*.md(가이드 알맹이) · *.jsx(본문 원본) · PLAN/WORKLOG 등 내부 문서
const PUBLIC = [
  'styles.css', 'styles-brand2.css', 'chat.css',
  'gate.js',
  'robots.txt',
  'reward-view-admin.html',
  'assets',
];

// gate.js와 반드시 같은 값이어야 한다. 한쪽만 바꾸면 열리지 않는다.
const PBKDF2_ITERATIONS = 200000;

// [원본 HTML, 잠근 본문을 저장할 이름]
const TARGETS = [
  ['index.html', 'megahouse.enc'],
  ['brand2.html', 'brand2.enc'],
];

const password = process.env.GUIDE_PASSWORD;
if (!password) {
  // 여기서 조용히 넘어가면 '잠기지 않은 가이드'가 그대로 배포된다.
  // 그건 사고이므로 빌드를 실패시킨다.
  console.error(
    '\n[중단] 접속 코드가 설정되어 있지 않습니다.\n' +
    '       Vercel 대시보드 → Settings → Environment Variables 에서\n' +
    '       GUIDE_PASSWORD 를 등록한 뒤 다시 배포해 주세요.\n'
  );
  process.exit(1);
}

// ─── 잠그기 ──────────────────────────────────────────────────────
// 코드 → PBKDF2로 열쇠를 만들고 → AES-GCM으로 본문을 변환한다.
// salt(소금)와 iv는 매번 새로 만든다. 같은 코드로 잠가도 결과가 매번 달라져서,
// 잠긴 파일끼리 비교해도 아무것도 알아낼 수 없다.
async function lock(text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)
  );

  const b64 = (buf) => Buffer.from(buf).toString('base64');
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

// ─── HTML에서 본문 코드만 뽑아내기 ───────────────────────────────
// <script type="text/babel" src="shared.jsx?v=140"></script>  → 그 파일 내용
// <script type="text/babel" data-presets="react"> ... </script> → 그 안의 코드
// 두 종류를 등장 순서대로 모은다(순서가 바뀌면 실행이 깨진다).
const BABEL_TAG = /<script\b[^>]*type=["']text\/babel["'][^>]*>[\s\S]*?<\/script>/gi;
const SRC_ATTR = /\bsrc=["']([^"']+)["']/i;

// React·Babel을 불러오는 태그(약 3MB)도 걷어낸다. 코드를 맞힌 뒤에 gate.js가
// 그때 불러오기 때문이다. 남겨두면 코드를 모르는 사람에게도 3MB를 내려주게 되고,
// gate.js가 또 불러서 같은 걸 두 번 받는다.
const VENDOR_TAG = /<script\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi;

function extract(html) {
  const used = [];
  const chunks = [];

  const stripped = html.replace(VENDOR_TAG, '').replace(BABEL_TAG, (tag) => {
    const src = tag.match(SRC_ATTR);
    if (src) {
      const file = src[1].split('?')[0];           // ?v=140 같은 캐시 표시 제거
      chunks.push(fs.readFileSync(path.join(DIR, file), 'utf-8'));
      used.push(file);
    } else {
      // 태그 안에 직접 적힌 코드(보통 화면에 그리라는 마지막 한 줄)
      chunks.push(tag.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''));
    }
    return '';
  });

  // 파일마다 세미콜론으로 끊어준다. 한 파일이 세미콜론 없이 끝나면 다음 파일과
  // 이어붙어 문법 오류가 나기 때문이다.
  return { code: chunks.join('\n;\n'), html: stripped, used };
}

// ─── 실행 ────────────────────────────────────────────────────────
// 지난 배포의 찌꺼기가 섞이지 않도록 매번 새로 만든다.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(LOCK_DIR, { recursive: true });

for (const [srcName, lockName] of TARGETS) {
  const html = fs.readFileSync(path.join(DIR, srcName), 'utf-8');
  const { code, html: stripped, used } = extract(html);

  if (!code.trim()) {
    console.error(`[중단] ${srcName} 에서 본문 코드를 찾지 못했습니다.`);
    process.exit(1);
  }

  fs.writeFileSync(path.join(LOCK_DIR, lockName), await lock(code), 'utf-8');

  // 본문을 걷어낸 자리에 코드 입력 화면을 넣는다
  const gateTag =
    `<script src="gate.js?v=5" data-locked="locked/${lockName}"></script>\n`;
  fs.writeFileSync(
    path.join(OUT, srcName),
    stripped.replace(/<\/body>/i, `${gateTag}</body>`),
    'utf-8'
  );

  const kb = (fs.statSync(path.join(LOCK_DIR, lockName)).size / 1024).toFixed(0);
  console.log(`[잠금] ${srcName} → locked/${lockName} (${kb}KB, 원본 ${used.length}개)`);
}

// 공개해도 되는 파일만 골라 담는다.
for (const name of PUBLIC) {
  const from = path.join(DIR, name);
  if (!fs.existsSync(from)) {
    console.error(`[중단] 공개 목록에 적힌 ${name} 을(를) 찾을 수 없습니다.`);
    process.exit(1);
  }
  fs.cpSync(from, path.join(OUT, name), { recursive: true });
  console.log(`[복사] ${name}`);
}

// 마지막 확인 — 배포 폴더에 새어 나가면 안 되는 것이 섞였는지 본다.
// 목록 방식이라 원래는 섞일 수 없지만, 나중에 누가 PUBLIC에 폴더를 통째로
// 추가했을 때 그 안에 딸려 들어오는 경우를 잡는다.
const BANNED = /\.(jsx|md)$/i;
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? walk(path.join(dir, e.name), `${base}${e.name}/`)
    : [`${base}${e.name}`]));
const leaked = walk(OUT).filter((f) => BANNED.test(f));
if (leaked.length) {
  console.error(`\n[중단] 배포하면 안 되는 파일이 섞였습니다: ${leaked.join(', ')}`);
  process.exit(1);
}

console.log(`\n잠금 완료 — dist/ 에 ${walk(OUT).length}개 파일. 접속 코드 없이는 본문을 읽을 수 없습니다.`);
