/**
 * 브라우저 확장프로그램(Cookie-Editor 등)으로 내보낸 쿠키 JSON을
 * Playwright storageState 형식으로 변환하는 도구.
 *
 * playwright codegen이 자동화 탐지로 로그인 자체가 막힐 때 쓰는 대안 경로:
 *   1) 평소 쓰는 브라우저에 "Cookie-Editor" 확장 설치
 *   2) x.com / instagram.com에 정상 로그인
 *   3) Cookie-Editor에서 Export → "Export as JSON" (다운로드 또는 클립보드 복사 후 파일로 저장)
 *   4) 아래처럼 실행:
 *        node cookies-to-storage-state.js cookies-x-raw.json x-session.json https://x.com
 *
 * 주의: 이 파일이 다루는 raw 쿠키 JSON, 변환된 세션 파일 모두 로그인된 상태 그 자체다.
 *       .gitignore에 이미 걸려있지만, 컴퓨터 밖으로 절대 유출하지 말 것.
 */
const fs = require('fs');

function mapSameSite(raw) {
  const v = (raw || '').toLowerCase();
  if (v === 'no_restriction' || v === 'none') return 'None';
  if (v === 'strict') return 'Strict';
  return 'Lax'; // 'lax' 및 'unspecified'는 Chrome 기본값인 Lax로 처리
}

function convert(rawCookies, origin) {
  if (!Array.isArray(rawCookies)) {
    throw new Error('입력 파일이 쿠키 배열(JSON array) 형태가 아님 — Cookie-Editor의 "Export as JSON" 결과인지 확인 필요');
  }

  const cookies = rawCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    // session:true(브라우저 종료 시 삭제되는 쿠키)면 playwright 관례상 -1
    expires: c.session ? -1 : Math.floor(c.expirationDate || -1),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: mapSameSite(c.sameSite),
  }));

  return {
    cookies,
    // localStorage는 쿠키 추출 방식으로는 못 가져옴 — 공개 게시물 조회(로그인 세션 유지)엔
    // 보통 쿠키(auth_token/ct0, sessionid/csrftoken)만으로 충분하지만, 만약 로그인이 풀린
    // 것처럼 보이면 이 부분이 원인일 수 있음.
    origins: origin ? [{ origin, localStorage: [] }] : [],
  };
}

function main() {
  const [, , inputPath, outputPath, origin] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('사용법: node cookies-to-storage-state.js <입력 쿠키 JSON> <출력 세션 파일> [origin URL]');
    console.error('예시: node cookies-to-storage-state.js cookies-x-raw.json x-session.json https://x.com');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const storageState = convert(raw, origin);

  fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
  console.log(`✅ 변환 완료: ${outputPath} (쿠키 ${storageState.cookies.length}개)`);

  const essentialNames = storageState.cookies.map(c => c.name);
  console.log(`   포함된 쿠키 이름: ${essentialNames.join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = { convert, mapSameSite };
