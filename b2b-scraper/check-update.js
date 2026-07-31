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

const VERSION_FILE = path.join(__dirname, '.local-version');
const TIMEOUT_MS = 5000; // 인터넷이 느려도 실행이 오래 붙잡히지 않게

// update.js와 완전히 같은 값을 비교해야 하므로, 버전도 같은 곳에서 받아온다.
// ?meta=1은 파일 내용 없이 버전만 돌려주는 가벼운 응답이다.
async function fetchLatestVersion() {
  if (!UPDATE_API) return null;
  const res = await fetch(`${UPDATE_API}?meta=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return (body && body.version) || null;
}

function readLocalVersion() {
  try { return fs.readFileSync(VERSION_FILE, 'utf-8').trim() || null; } catch { return null; }
}

async function main() {
  const save = process.argv.includes('--save');
  const latest = await fetchLatestVersion();
  if (!latest) return; // 확인 실패 — 조용히 넘어감

  if (save) {
    fs.writeFileSync(VERSION_FILE, latest, 'utf-8');
    return;
  }

  const local = readLocalVersion();
  // 처음 실행이라 기록이 없으면 잔소리하지 않고 현재 버전을 기준으로 삼는다
  // (안 그러면 설치 직후부터 "업데이트하세요"가 떠서 혼란만 준다).
  if (!local) { fs.writeFileSync(VERSION_FILE, latest, 'utf-8'); return; }

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
