/**
 * scrape.js가 완전히 실패했을 때 팀원(비개발자)이 봐도 뭘 해야 할지 알 수 있게
 * 흔한 실패 원인 몇 가지만 사람 말로 먼저 번역해준다. 여기 안 걸리는 나머지 전부는
 * "원인 특정 불가 — 캡처해서 담당자에게" 문구로 통일한다(추측성 안내를 지어내지 않기 위해).
 * 기술 상세(err.message)는 어느 경우든 항상 같이 보여준다 — 담당자가 캡처만으로 진단할 수 있게.
 */
const PATTERNS = [
  {
    test: /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|ENOTFOUND/i,
    message: '인터넷 연결에 문제가 있는 것 같아요. 와이파이/랜선 상태를 확인한 뒤 다시 실행해주세요.',
  },
  {
    test: /waitForURL.*Timeout|Timeout.*waitForURL/i,
    message: '5분 안에 로그인이 확인되지 않았어요. 다시 실행해서 로그인해주세요.',
  },
  {
    test: /Timeout\s+\d+ms\s+exceeded|Timeout.*exceeded/i,
    message: '사이트 응답이 너무 느리거나 응답이 없어요. 인터넷 상태를 확인하고 잠시 후 다시 시도해주세요.',
  },
  {
    test: /Chromium distribution.*not found|executable doesn't exist|unable to find.*chrome/i,
    message: '이 컴퓨터에 크롬(Chrome) 브라우저가 설치되어 있지 않은 것 같아요. 크롬을 설치한 뒤 다시 실행해주세요.',
  },
  {
    test: /Target (page, context or browser )?has been closed|Target closed/i,
    message: '브라우저 창이 예기치 않게 닫혔어요. 창을 전부 닫고 다시 실행해주세요.',
  },
  {
    test: /ProcessSingleton|SingletonLock|already running/i,
    message: '이미 실행 중인 창이 있을 수 있어요. 열려있는 크롬 창과 이전 실행 창을 모두 닫고 다시 시도해주세요.',
  },
  {
    test: /EACCES|EPERM|EBUSY/i,
    message: '결과 파일을 저장하는 중 문제가 생겼어요. 엑셀 등 다른 프로그램이 관련 파일을 열어놓지 않았는지 확인해주세요.',
  },
  {
    test: /ENOSPC/i,
    message: '저장 공간(디스크 용량)이 부족해요. 여유 공간을 확보한 뒤 다시 시도해주세요.',
  },
];

function friendlyErrorMessage(err) {
  const raw = (err && err.message) || String(err);
  const matched = PATTERNS.find(p => p.test.test(raw));
  const friendly = matched ? matched.message : '원인을 정확히 알 수 없는 오류예요.';
  return [
    `❌ 작업이 중단됐어요. ${friendly}`,
    '',
    '(위 문구로 원인 파악이 안 되면 이 화면을 그대로 캡처해서 담당자에게 보내주세요)',
    `기술 상세: ${raw}`,
  ].join('\n');
}

module.exports = { friendlyErrorMessage };
