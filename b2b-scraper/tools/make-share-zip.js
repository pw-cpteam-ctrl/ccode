/**
 * 팀원에게 처음 나눠줄 배포용 압축을 만든다.
 *
 * 왜 이게 필요한가 (실제로 겪은 사고):
 *   처음 나눠준 압축을 사람이 손으로 골라 담았고, 그때 update.js와 update-source.js가
 *   빠졌다. update.bat은 그 둘이 있어야만 동작하므로, 받은 팀원은 처음부터 업데이트를
 *   단 한 번도 받을 수 없는 상태였다. 두 달 뒤 지난 날짜 기능을 쓰라고 안내했을 때
 *   "그런 파일이 없다"는 답이 와서야 드러났다.
 *
 *   손으로 고르는 한 언제든 다시 일어난다. 그래서 배포 통로(api/files.js)가 실제로
 *   내려보내는 목록을 그대로 받아서 담는다 — 팀원 PC가 update.bat으로 받게 될 것과
 *   글자 하나까지 같은 묶음이 나온다.
 *
 * 이 파일은 b2b-scraper/tools/ 안에 둔다. api/files.js는 폴더 맨 위 파일만 내려보내므로
 * 여기 있는 것은 팀원에게 가지 않는다(개발용 도구라 갈 이유도 없다).
 *
 * 사용법:
 *   node tools/make-share-zip.js            → b2b-scraper-공유용.zip 생성
 *   node tools/make-share-zip.js --out 경로  → 저장 위치 지정
 *
 * zip 명령이 없는 환경이면 폴더만 만들고 알려준다(그 폴더를 직접 압축하면 된다).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { UPDATE_API } = require('../update-source');

// update.bat은 배포 통로에서 일부러 빠져 있다(실행 중 자기 자신을 덮어쓰면 CMD가
// 오작동해서 제외해둔 것 — api/files.js 주석 참고). 하지만 처음 나눠주는 압축에는
// 반드시 들어가야 한다. 이번 사고가 정확히 "짝이 안 맞게 들어간" 경우였으므로,
// 여기서 빠지면 아예 만들지 않고 멈춘다.
const EXTRA_FROM_REPO = ['update.bat'];

const READ_ME = `[굿스마일 상품 가져오기 - 설치]

1. 이 압축을 풀면 b2b-scraper 폴더가 나옵니다.
2. 그 폴더를 바탕화면 등 원하는 곳에 두세요.
3. 폴더 안의 run.bat 을 더블클릭하면 시작합니다.
   (처음 한 번은 필요한 것들을 설치하느라 1~2분 걸릴 수 있어요)

자세한 사용법은 폴더 안의 "사용법.md" 를 열어보세요.

- run.bat            평소 작업 (가장 최신 발표분을 받음)
- run-pick-date.bat  지난 날짜 상품이 필요할 때
- update.bat         "새 버전이 있습니다" 안내가 떴을 때
- reset-login.bat    로그인이 꼬였을 때

Node.js 가 설치되어 있어야 합니다. 없으면 https://nodejs.org 에서
LTS 버전을 설치한 뒤 run.bat 을 다시 눌러주세요.
`;

function fail(msg) {
  console.error(`\n만들지 못했습니다: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const outArgIdx = process.argv.indexOf('--out');
  const outZip = path.resolve(outArgIdx > -1 ? process.argv[outArgIdx + 1] : 'b2b-scraper-공유용.zip');

  if (!UPDATE_API) fail('배포 주소(update-source.js)가 설정되어 있지 않습니다.');
  console.log(`배포 통로에서 파일 목록을 받는 중... (${UPDATE_API})`);

  let payload;
  try {
    const res = await fetch(UPDATE_API, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) fail(`배포 통로가 ${res.status}을(를) 돌려줬습니다.`);
    payload = await res.json();
  } catch (err) {
    fail(`배포 통로에 연결하지 못했습니다: ${err.message}`);
  }
  if (payload.error) fail(payload.error);
  if (!Array.isArray(payload.files) || !payload.files.length) fail('받은 파일 목록이 비어 있습니다.');

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'share-zip-'));
  const folder = path.join(stage, 'b2b-scraper');
  fs.mkdirSync(folder, { recursive: true });

  for (const f of payload.files) fs.writeFileSync(path.join(folder, f.name), f.content, 'utf-8');

  // 배포 통로에서 일부러 빼둔 것들을 저장소에서 직접 채운다.
  for (const name of EXTRA_FROM_REPO) {
    const src = path.join(__dirname, '..', name);
    if (!fs.existsSync(src)) fail(`저장소에 ${name}이(가) 없습니다.`);
    fs.copyFileSync(src, path.join(folder, name));
  }

  /* 나가기 전 마지막 점검. 셋 중 하나라도 빠지면 받는 사람은 영영 업데이트를 못 받는데,
     그 사실이 몇 달 뒤에야 드러난다. 그럴 바엔 여기서 만들기를 실패시킨다. */
  const MUST_HAVE = ['update.bat', 'update.js', 'update-source.js', 'run.bat', 'scrape.js', '사용법.md'];
  const missing = MUST_HAVE.filter(n => !fs.existsSync(path.join(folder, n)));
  if (missing.length) fail(`꼭 있어야 할 파일이 빠졌습니다: ${missing.join(', ')}`);

  fs.writeFileSync(path.join(stage, '읽어주세요.txt'), READ_ME, 'utf-8');

  const names = fs.readdirSync(folder).sort();
  console.log(`\n담은 파일 ${names.length}개 (버전 ${payload.version}):`);
  console.log('  ' + names.join(', '));

  fs.rmSync(outZip, { force: true });
  const r = spawnSync('zip', ['-q', '-r', outZip, '.'], { cwd: stage });
  if (r.error || r.status !== 0) {
    console.log(`\nzip 명령을 쓸 수 없어 폴더만 만들었습니다. 이 폴더를 직접 압축하세요:\n  ${stage}`);
    return;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`\n완료: ${outZip}`);
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
