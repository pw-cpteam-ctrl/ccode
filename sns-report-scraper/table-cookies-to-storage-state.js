/**
 * 크롬 개발자도구 Application 탭 → Storage → Cookies 표에서
 * Ctrl+A(전체선택) → Ctrl+C(복사)한 텍스트(탭 구분)를 Playwright storageState로 변환.
 *
 * "Copy as cURL"은 최신 크롬이 보안상 Cookie 헤더를 빼버려서 못 쓰는 경우의 대안.
 * 이 방식은 실제 httpOnly/secure/만료일 속성을 표에서 그대로 읽어와서 curl 방식보다 정확함.
 *
 * 사용법:
 *   node table-cookies-to-storage-state.js cookie-table.txt x-session.json https://x.com
 */
const fs = require('fs');

function findColumn(header, keyword) {
  return header.findIndex(h => h.replace(/[^a-z]/g, '').includes(keyword));
}

function mapSameSite(raw) {
  const v = (raw || '').toLowerCase();
  if (v.includes('none')) return 'None';
  if (v.includes('strict')) return 'Strict';
  return 'Lax'; // 빈 값/Unspecified/Lax 전부 Lax로 처리
}

function isTruthy(v) {
  const s = (v || '').trim().toLowerCase();
  return s === '✓' || s === 'true' || s === '1' || s === 'yes';
}

function parseExpires(raw) {
  const s = (raw || '').trim();
  if (!s || /session/i.test(s)) return -1;
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000) + 3600 * 24 * 365; // 파싱 실패 시 1년 후로 안전하게
}

function convert(tableText, origin) {
  const lines = tableText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('표 형태가 아님 — Application > Cookies 표에서 Ctrl+A → Ctrl+C 한 내용을 그대로 붙여넣었는지 확인 필요');
  }

  const header = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const col = {
    name: findColumn(header, 'name'),
    value: findColumn(header, 'value'),
    domain: findColumn(header, 'domain'),
    path: findColumn(header, 'path'),
    expires: findColumn(header, 'expires'),
    httpOnly: findColumn(header, 'http'),
    secure: findColumn(header, 'secure'),
    sameSite: findColumn(header, 'samesite'),
  };
  if (col.name === -1 || col.value === -1) {
    throw new Error('name/value 열을 못 찾음 — 표 맨 위 헤더 줄(Name, Value, Domain...)까지 포함해서 복사했는지 확인 필요');
  }

  const get = (cols, i) => (i >= 0 && cols[i] !== undefined) ? cols[i].trim() : '';

  const cookies = lines.slice(1).map(line => {
    const cols = line.split('\t');
    const name = get(cols, col.name);
    if (!name) return null;
    return {
      name,
      value: get(cols, col.value),
      domain: get(cols, col.domain) || new URL(origin).hostname,
      path: get(cols, col.path) || '/',
      expires: parseExpires(get(cols, col.expires)),
      httpOnly: isTruthy(get(cols, col.httpOnly)),
      secure: isTruthy(get(cols, col.secure)),
      sameSite: mapSameSite(get(cols, col.sameSite)),
    };
  }).filter(Boolean);

  return { cookies, origins: [{ origin, localStorage: [] }] };
}

function main() {
  const [, , inputPath, outputPath, origin] = process.argv;
  if (!inputPath || !outputPath || !origin) {
    console.error('사용법: node table-cookies-to-storage-state.js <복사한 표 텍스트 파일> <출력 세션 파일> <origin URL>');
    console.error('예시: node table-cookies-to-storage-state.js cookie-table.txt x-session.json https://x.com');
    process.exit(1);
  }

  const tableText = fs.readFileSync(inputPath, 'utf-8');
  const storageState = convert(tableText, origin);

  fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
  console.log(`✅ 변환 완료: ${outputPath} (쿠키 ${storageState.cookies.length}개)`);
  console.log(`   쿠키 이름: ${storageState.cookies.map(c => c.name).join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = { convert };
