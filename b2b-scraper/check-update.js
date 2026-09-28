/**
 * 새 버전이 있는지 확인해서 "알려주기만" 하는 스크립트. 절대 자동으로 적용하지 않는다.
 *
 * 왜 자동 적용을 안 하나:
 *   - 검증 안 된 코드가 팀원에게 즉시 전파되는 걸 막기 위해 (푸시 = 바로 프로덕션이 되면
 *     내가 실수한 게 그날 업무를 그대로 망침). 업데이트 적용은 사람이 update.bat으로 한다.
 *   - run.bat이 실행 중에 자기 자신(run.bat)을 덮어쓰면 CMD가 배치 파일을 줄 단위로 읽는
 *     특성 때문에 오작동한다. 별도 실행(update.bat)이면 이 함정이 아예 없다.
 *
 * 이 스크립트는 무슨 일이 있어도 실행을 막지 않는다 — 인터넷이 끊겼든 API가 막혔든
 * 조용히 넘어가고 항상 정상 종료한다 (스크래핑 자체는 계속 진행돼야 하므로).
 *
 * 사용법:
 *   node check-update.js          새 버전 있으면 안내 문구만 출력 (run.bat이 호출)
 *   node check-update.js --save   현재 원격 버전을 "지금 내가 쓰는 버전"으로 기록
 *                                 (평소엔 update.js가 알아서 기록하므로 쓸 일이 없다.
 *                                  버전 기록이 꼬였을 때 손으로 맞추는 용도로만 남겨둠)
 */
const fs = require('fs');
const path = require('path');

// 주소 파일이 없어도(업데이트 구조로 전환하기 전 상태 등) 절대 시끄럽게 죽지 않는다 —
// 이 스크립트는 run.bat이 매번 부르는 곁가지라, 여기서 스택 트레이스가 뜨면 팀원이
// "도구가 고장났다"고 오해한다.
let UPDATE_API = null;
try { UPDATE_API = require('./update-source').UPDATE_API; } catch { /* 조용히 넘어감 */ }
// 같은 이유로 여기서도 죽지 않게 감싼다. 못 불러오면 버전 계산만 포기한다.
let computeLocalVersion = () => null;
try { ({ computeLocalVersion } = require('./local-version')); } catch { /* 조용히 넘어감 */ }

const VERSION_FILE = path.join(__dirname, '.local-version');
const TIMEOUT_MS = 5000; // 인터넷이 느려도 실행이 오래 붙잡히지 않게

// update.js와 완전히 같은 값을 비교해야 하므로, 버전도 같은 곳에서 받아온다.
// ?meta=1은 파일 내용 없이 버전만 돌려주는 가벼운 응답이다.
async function fetchLatestMeta() {
  if (!UPDATE_API) return null;
  const res = await fetch(`${UPDATE_API}?meta=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body || !body.version) return null;
  return { version: body.version, names: Array.isArray(body.names) ? body.names : [] };
}

/* 업데이트 통로 자체가 망가져 있으면 그것부터 알린다.
   update.bat은 짝인 두 파일이 없으면 아무것도 못 하는데, 그 사실은 update.bat을 눌러봐야
   알 수 있었다. 문제는 아무도 멀쩡해 보이는 도구의 update.bat을 눌러보지 않는다는 것이다.
   실제로 한 팀원은 두 달 동안 업데이트를 한 번도 못 받은 채로 쓰고 있었다.
   그래서 매일 쓰는 run.bat 쪽(이 스크립트를 부른다)에서 대신 알린다. */
function warnIfUpdaterBroken() {
  const missing = ['update.js', 'update-source.js'].filter(n => !fs.existsSync(path.join(__dirname, n)));
  if (!missing.length) return false;
  console.log('');
  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│  ⚠ 이 도구는 지금 업데이트를 받을 수 없는 상태입니다.    │');
  console.log('│                                                          │');
  console.log('│  담당자에게 "업데이트 파일이 없다"고 알려주세요.         │');
  console.log('│  (작업 자체는 지금처럼 그대로 하시면 됩니다)             │');
  console.log('└──────────────────────────────────────────────────────────┘');
  console.log(`   빠진 파일: ${missing.join(', ')}`);
  console.log('');
  return true;
}

async function main() {
  const save = process.argv.includes('--save');
  // 업데이트가 불가능한 상태면 "새 버전 있으니 update.bat 누르세요"는 소용이 없다.
  // 그건 눌러도 안 되는 안내라, 이쪽 경고만 보여주고 끝낸다.
  if (warnIfUpdaterBroken()) return;
  const meta = await fetchLatestMeta();
  if (!meta) return; // 확인 실패 — 조용히 넘어감
  const latest = meta.version;

  if (save) {
    fs.writeFileSync(VERSION_FILE, latest, 'utf-8');
    return;
  }

  /* 여기가 예전에 틀렸던 자리다.
     전에는 .local-version에 적힌 값만 봤고, 기록이 없으면 "설치 직후니까 최신이겠지" 하고
     현재 최신값을 그대로 적어버렸다. 그런데 손으로 복사해 넣은 낡은 폴더에도 똑같이
     도장이 찍혀서, 실제로는 두 달 낡은 도구인데 "이미 최신"이 되어 안내가 한 번도
     뜨지 않았다. 팀원이 계속 낡은 걸 쓰고 있었고 아무도 몰랐다.

     그래서 적어둔 메모 대신 실제 파일을 잰다. 파일이 낡았거나 아예 빠져 있으면
     계산값이 달라지므로 이런 어긋남이 생길 수 없다. 서버가 목록을 안 내려주는
     옛 응답이면 계산이 불가능하니, 그때만 예전처럼 기록값으로 물러선다. */
  const local = computeLocalVersion(__dirname, meta.names)
    || (() => { try { return fs.readFileSync(VERSION_FILE, 'utf-8').trim() || null; } catch { return null; } })();
  if (!local) return;   // 잴 방법이 없으면 조용히 넘어간다 (실행을 막지 않는 게 우선)

  // 실제 파일 기준으로 최신이면 기록도 맞춰둔다 — update.js가 헛돌지 않게.
  if (local === latest) {
    try { fs.writeFileSync(VERSION_FILE, latest, 'utf-8'); } catch { /* 기록 실패는 무시 */ }
  }

  if (local !== latest) {
    console.log('');
    console.log('┌───────────────────────────────────────────────────────┐');
    console.log('│  새 버전이 있습니다.                                  │');
    console.log('│  이 작업이 끝난 뒤 update.bat 을 한 번 실행해주세요.  │');
    console.log('└───────────────────────────────────────────────────────┘');
    console.log('');
  }
}

// 확인 실패가 실행을 막으면 안 되므로 어떤 에러도 조용히 삼킨다.
main().catch(() => {});
