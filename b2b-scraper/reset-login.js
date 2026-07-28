/**
 * 저장된 굿스마일 로그인(전용 크롬 프로필)을 지운다. 로그인이 꼬여서 스크래핑이 계속
 * 실패할 때 쓰는 초기화 버튼 — 실행 후 run.bat을 다시 돌리면 로그인 창이 새로 뜬다.
 *
 * 프로필이 저장소 밖(숨은 경로)에 있어서 팀원이 직접 찾아가 지우기 어렵기 때문에 이
 * 스크립트가 필요하다 (profile-dir.js의 주석 참고).
 */
const fs = require('fs');
const { PROFILE_ROOT } = require('./profile-dir');

if (!fs.existsSync(PROFILE_ROOT)) {
  console.log('저장된 로그인이 없습니다 — 이미 초기화된 상태예요.');
  console.log(`(확인한 위치: ${PROFILE_ROOT})`);
} else {
  try {
    fs.rmSync(PROFILE_ROOT, { recursive: true, force: true });
    console.log('저장된 로그인을 지웠습니다.');
    console.log(`(지운 위치: ${PROFILE_ROOT})`);
    console.log('');
    console.log('이제 run.bat을 다시 실행하면 크롬 창이 뜨니 거기서 다시 로그인해주세요.');
  } catch (err) {
    console.error('로그인 초기화 실패:', err.message);
    console.error('크롬 창이 아직 열려 있으면 모두 닫고 다시 시도해주세요.');
    process.exit(1);
  }
}
