/**
 * 최신 코드를 받아 이 폴더의 파일을 갱신한다. update.bat이 부른다.
 *
 * 설계 원칙 (팀원이 실사용 중이라는 걸 전제로):
 *   1. **아무것도 지우지 않는다.** 받은 파일만 덮어쓴다. 그래서 output/ 결과물, 설치된
 *      node_modules, 저장된 로그인(애초에 이 폴더 밖 — profile-dir.js 참고)이 절대 사라지지 않는다.
 *   2. **실패해도 도구는 계속 쓸 수 있다.** 업데이트가 안 되는 건 불편이지 업무 중단이
 *      아니어야 한다. 그래서 실패하면 "기존 버전으로 계속 쓸 수 있다"고 명확히 알린다.
 *   3. **부분 적용을 만들지 않는다.** 받은 파일 전체를 검사한 뒤에야 쓰기를 시작한다.
 *      절반만 갱신되면 버전이 섞여서 원인 못 찾는 고장이 난다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { UPDATE_API } = require('./update-source');

const VERSION_FILE = path.join(__dirname, '.local-version');
const TIMEOUT_MS = 30000; // 파일 전체를 받으므로 버전 확인보다 넉넉하게

function fail(message, detail) {
  console.error('');
  console.error('─────────────────────────────────────────────');
  console.error(`업데이트를 하지 못했습니다: ${message}`);
  console.error('');
  console.error('지금 설치된 버전으로 계속 사용할 수 있어요 — run.bat을 그대로 쓰시면 됩니다.');
  console.error('이 화면을 그대로 캡처해서 담당자에게 보내주세요.');
  if (detail) console.error(`\n기술 상세: ${detail}`);
  console.error('─────────────────────────────────────────────');
  process.exit(1);
}

async function fetchPayload() {
  if (!UPDATE_API) {
    // update-source.js의 주소가 아직 채워지지 않은 상태 (배포 준비 미완료)
    fail('업데이트 받아올 주소가 설정되지 않았습니다. 담당자 확인이 필요합니다.', 'UPDATE_API 미설정');
  }
  let res;
  try {
    res = await fetch(UPDATE_API, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // 인터넷이 끊겼거나 사내망에서 막힌 경우가 대부분
    fail('최신 버전을 받아올 수 없습니다. 인터넷 연결을 확인해주세요.', err.message);
  }
  if (!res.ok) {
    let extra = '';
    try { extra = (await res.json()).error || ''; } catch { /* 본문이 JSON이 아니면 무시 */ }
    fail('업데이트 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해주세요.', `HTTP ${res.status} ${extra}`);
  }
  try {
    return await res.json();
  } catch (err) {
    fail('받은 내용을 해석할 수 없습니다.', err.message);
  }
}

// 쓰기 전에 전부 검사 — 여기서 걸리면 파일을 하나도 건드리지 않고 끝낸다.
function validate(payload) {
  if (!payload || typeof payload !== 'object') fail('받은 내용이 비어있습니다.');
  if (!payload.version) fail('받은 내용에 버전 정보가 없습니다.');
  if (!Array.isArray(payload.files) || !payload.files.length) fail('받은 파일 목록이 비어있습니다.');
  for (const f of payload.files) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') {
      fail('받은 파일 목록의 형식이 올바르지 않습니다.');
    }
    // 폴더를 벗어나는 경로가 섞여 들어와 엉뚱한 곳을 덮어쓰는 걸 막는다.
    if (f.name.includes('/') || f.name.includes('\\') || f.name.includes('..') || !f.name.trim()) {
      fail(`허용되지 않는 파일 이름이 포함되어 있습니다: ${f.name}`);
    }
  }
  // 스크래퍼의 진입점이 빠졌다면 뭔가 크게 잘못된 묶음이다.
  if (!payload.files.some(f => f.name === 'scrape.js')) fail('필수 파일(scrape.js)이 빠져있습니다.');
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

async function main() {
  console.log('최신 버전을 확인하는 중...');
  const payload = await fetchPayload();
  validate(payload);

  const local = (readIfExists(VERSION_FILE) || '').trim();
  if (local && local === payload.version) {
    console.log('');
    console.log('이미 최신 버전입니다. 갱신할 게 없어요.');
    return;
  }

  const pkgPath = path.join(__dirname, 'package.json');
  const pkgBefore = readIfExists(pkgPath);

  const changed = [];
  const added = [];
  for (const f of payload.files) {
    const target = path.join(__dirname, f.name);
    const before = readIfExists(target);
    if (before === f.content) continue;      // 내용이 같으면 건드리지 않음(수정 시각도 그대로 유지)
    fs.writeFileSync(target, f.content, 'utf-8');
    (before === null ? added : changed).push(f.name);
  }

  console.log('');
  if (!added.length && !changed.length) {
    console.log('파일 내용은 이미 같았습니다. 버전 기록만 갱신합니다.');
  } else {
    if (added.length) console.log(`새로 추가된 파일 ${added.length}개: ${added.join(', ')}`);
    if (changed.length) console.log(`갱신된 파일 ${changed.length}개: ${changed.join(', ')}`);
  }

  // 새로 필요해진 라이브러리가 있을 수 있으므로 package.json이 바뀐 경우에만 설치한다
  // (매번 돌리면 느리기만 하고 얻는 게 없다).
  const pkgAfter = readIfExists(pkgPath);
  if (pkgBefore !== pkgAfter) {
    console.log('');
    console.log('필요한 라이브러리를 설치하는 중입니다 (1~2분 걸릴 수 있어요)...');
    const r = spawnSync('npm', ['install'], { cwd: __dirname, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      // 파일은 이미 갱신됐으므로 버전을 기록하지 않는다 → 다음 실행 때 다시 시도하게 된다.
      fail('라이브러리 설치가 실패했습니다. 인터넷 연결을 확인하고 update.bat을 다시 실행해주세요.',
        `npm install exit=${r.status}`);
    }
  }

  fs.writeFileSync(VERSION_FILE, payload.version, 'utf-8');
  console.log('');
  console.log('업데이트가 끝났습니다. run.bat으로 평소처럼 사용하시면 됩니다.');
}

main().catch(err => fail('예상하지 못한 문제가 생겼습니다.', err && err.stack ? err.stack : String(err)));
