/**
 * 업데이트를 받아오는 주소를 정의하는 **유일한 곳**. update.js와 check-update.js가 함께 쓴다.
 *
 * 이 주소가 바뀌면(예: Vercel 프로젝트 이름 변경) 팀원 PC에 이미 깔린 파일은 옛 주소를
 * 들고 있어서 스스로 갱신할 수 없다 — 즉 주소 변경은 팀원 파일 수동 교체를 다시 유발한다.
 * 그러니 프로젝트 이름/도메인은 되도록 건드리지 말 것.
 */

// ↓ 배포 주소. 아직 채워지지 않았으면 아래 PLACEHOLDER 검사에 걸려 UPDATE_API가 null이 된다.
const CONFIGURED = 'https://b2b-scraper-kappa.vercel.app/api/files';

// 주소를 채우지 않은 채로 배포되는 사고를 대비한 안전장치. 채워지지 않았으면 null을 넘겨서
// update.js가 "주소가 설정되지 않았다"고 명확히 말하고 멈추게 한다 — 안 그러면 팀원이
// 알 수 없는 네트워크 오류만 보고 원인을 못 찾는다.
const UPDATE_API = CONFIGURED.includes('__VERCEL_DOMAIN__') ? null : CONFIGURED;

module.exports = { UPDATE_API };
