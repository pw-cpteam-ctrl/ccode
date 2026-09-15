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
  // "세션"(한국어 로케일 크롬) / "Session" 둘 다 브라우저 종료 시 삭제되는 세션 쿠키를 의미
  if (!s || /session/i.test(s) || s === '세션') return -1;
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000) + 3600 * 24 * 365; // 파싱 실패 시 1년 후로 안전하게
}

// 크롬 Application > Cookies 패널의 고정 열 순서 (표 안에서 Ctrl+A/C 하면 헤더 없이 이 순서로만 복사됨)
const DEFAULT_COLUMNS = ['name', 'value', 'domain', 'path', 'expires', 'size', 'httpOnly', 'secure', 'sameSite', 'partitionKey', 'crossSite', 'priority'];

function convert(tableText, origin) {
  const lines = tableText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) {
    throw new Error('표 형태가 아님 — Application > Cookies 표에서 Ctrl+A → Ctrl+C 한 내용을 그대로 붙여넣었는지 확인 필요');
  }

  const headerCandidate = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const looksLikeHeader = findColumn(headerCandidate, 'name') !== -1 && findColumn(headerCandidate, 'value') !== -1;

  let col;
  let dataLines;
  if (looksLikeHeader) {
    col = {
      name: findColumn(headerCandidate, 'name'),
      value: findColumn(headerCandidate, 'value'),
      domain: findColumn(headerCandidate, 'domain'),
      path: findColumn(headerCandidate, 'path'),
      expires: findColumn(headerCandidate, 'expires'),
      httpOnly: findColumn(headerCandidate, 'http'),
      secure: findColumn(headerCandidate, 'secure'),
      sameSite: findColumn(headerCandidate, 'samesite'),
    };
    dataLines = lines.slice(1);
  } else {
    // 헤더 줄이 없음 — 크롬 고정 열 순서로 간주 (표 본문만 선택돼서 복사된 일반적인 경우)
    col = {};
    DEFAULT_COLUMNS.forEach((name, i) => { col[name] = i; });
    dataLines = lines;
  }

  const get = (cols, i) => (i >= 0 && cols[i] !== undefined) ? cols[i].trim() : '';

  const cookies = dataLines.map(line => {
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
