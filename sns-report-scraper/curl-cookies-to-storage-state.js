/**
 * 크롬 개발자도구(F12) → Network 탭 → 요청 우클릭 → "Copy as cURL"로 복사한
 * 텍스트에서 Cookie 헤더만 뽑아 Playwright storageState 형식으로 변환하는 도구.
 * 확장프로그램 설치 없이 세션 파일을 만들 수 있는 방법.
 *
 * 사용법:
 *   node curl-cookies-to-storage-state.js curl-x.txt x-session.json https://x.com
 *
 * curl-x.txt 안에는 "Copy as cURL"로 복사한 텍스트 전체를 그대로 붙여넣으면 됨
 * (bash 형식 `-H 'cookie: ...'`, cmd 형식 `-H "cookie: ..."` 둘 다 지원).
 *
 * httpOnly/secure/sameSite/만료일은 쿠키 헤더 문자열만으론 알 수 없어서 안전한 기본값으로
 * 채움(secure:true, httpOnly:true, sameSite:'Lax', 1년 후 만료) — 실제 요청 전송에는
 * 지장 없지만, 브라우저에서 다시 그 쿠키를 JS로 읽는 등의 동작과는 100% 동일하지 않을 수 있음.
 */
const fs = require('fs');

function extractCookieHeader(curlText) {
  const m = curlText.match(/-H\s*(['"])\s*cookie:\s*(.*?)\1/is);
  if (!m) {
    throw new Error('cURL 텍스트에서 cookie 헤더를 못 찾음 — "Copy as cURL"로 복사한 전체 텍스트를 그대로 붙여넣었는지 확인 필요');
  }
  return m[2];
}

function parseCookieHeader(header) {
  return header.split(';').map(pair => pair.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf('=');
    return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
  });
}

function convert(curlText, origin) {
  const header = extractCookieHeader(curlText);
  const pairs = parseCookieHeader(header);
  const hostname = new URL(origin).hostname;
  const oneYearLater = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;

  const cookies = pairs.map(({ name, value }) => ({
    name,
    value,
    domain: `.${hostname}`,
    path: '/',
    expires: oneYearLater,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }));

  return { cookies, origins: [{ origin, localStorage: [] }] };
}

function main() {
  const [, , inputPath, outputPath, origin] = process.argv;
  if (!inputPath || !outputPath || !origin) {
    console.error('사용법: node curl-cookies-to-storage-state.js <curl 텍스트 파일> <출력 세션 파일> <origin URL>');
    console.error('예시: node curl-cookies-to-storage-state.js curl-x.txt x-session.json https://x.com');
    process.exit(1);
  }

  const curlText = fs.readFileSync(inputPath, 'utf-8');
  const storageState = convert(curlText, origin);

  fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
  console.log(`✅ 변환 완료: ${outputPath} (쿠키 ${storageState.cookies.length}개)`);
  console.log(`   쿠키 이름: ${storageState.cookies.map(c => c.name).join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = { convert, extractCookieHeader, parseCookieHeader };
