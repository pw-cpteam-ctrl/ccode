/**
 * 로그인 데이터(전용 크롬 프로필)를 저장하는 위치를 정의하는 유일한 곳.
 *
 * 핵심: 이 경로는 **저장소 폴더 밖**이다. 예전엔 b2b-scraper/chrome-profile/ 안에 뒀는데,
 * 이 저장소가 공개(public)라서 "로그인이 유출되지 않는 근거"가 .gitignore 한 줄뿐이었다 —
 * 사람이 한 번 실수로 커밋하면 굿스마일 B2B 로그인이 통째로 전세계에 공개되는 사고이고,
 * git 히스토리에서 지우는 것도 매우 번거롭다. 작업 폴더 밖에 두면 git이 애초에 볼 수 없는
 * 곳이라 그 사고 자체가 물리적으로 불가능해진다.
 *
 * 보너스: 나중에 이 도구를 드라이브 동기화 폴더에 두더라도, 로그인이 팀원 전체에게
 * 동기화되는 사고를 원천 차단한다 (프로필이 동기화 대상 밖이므로).
 *
 * 위치가 숨은 경로라 팀원이 직접 찾아가기 어려운 건 reset-login.bat으로 해결한다.
 */
const os = require('os');
const path = require('path');

// 윈도우: %LOCALAPPDATA%\b2b-scraper (예: C:\Users\<사용자>\AppData\Local\b2b-scraper)
// 그 외(맥/리눅스, 개발용): ~/.b2b-scraper
function appDataRoot() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'b2b-scraper');
  }
  return path.join(os.homedir(), '.b2b-scraper');
}

const PROFILE_ROOT = path.join(appDataRoot(), 'chrome-profile');
const GOODSMILE_PROFILE_DIR = path.join(PROFILE_ROOT, 'goodsmile');

module.exports = { PROFILE_ROOT, GOODSMILE_PROFILE_DIR };
