// sns-report-scraper/naver-stock.js에서 그대로 가져온, 페이지 HTML에 박힌 JSON을 안전하게
// 뽑아내는 범용 헬퍼. DOM 셀렉터로 긁는 것보다 훨씬 안 깨진다 — recon.js 결과 GoodSmile
// 상세 페이지에 __NEXT_DATA__/__PRELOADED_STATE__/__next_f 중 뭐가 있는지 확인되면 여기 있는
// 함수로 그 JSON을 통째로 얻은 뒤, 그 안에서 실제 필드 경로(productName/price/imageUrl 등)를
// GoodSmile 구조에 맞게 새로 잡으면 된다 (naver 전용 트리탐색 로직은 옮기지 않았음).

// JS 객체 리터럴에 섞인 비-JSON 토큰(NaN/undefined/Infinity)을 문자열 밖에서만 null로 치환.
const NON_JSON_LITERALS = ['-Infinity', 'undefined', 'Infinity', 'NaN'];
function sanitizeJsonLiteral(text) {
  let result = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      result += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; result += c; continue; }
    const lit = NON_JSON_LITERALS.find(x => text.startsWith(x, i));
    if (lit) { result += 'null'; i += lit.length - 1; continue; }
    result += c;
  }
  return result;
}

// marker(예: "__PRELOADED_STATE__") 뒤 첫 "=" 다음의 균형잡힌 {...}/[...] 블록을 잘라냄.
function extractAssignedJson(text, marker) {
  const m = text.indexOf(marker);
  if (m === -1) return '';
  const eq = text.indexOf('=', m + marker.length);
  if (eq === -1) return '';
  let start = -1;
  for (let i = eq + 1; i < text.length; i += 1) {
    if (text[i] === '{' || text[i] === '[') { start = i; break; }
    if (!/\s/.test(text[i])) return '';
  }
  if (start === -1) return '';
  const stack = []; let inString = false, escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') {
      const open = stack.pop();
      if ((c === '}' && open !== '{') || (c === ']' && open !== '[')) return '';
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

// Next.js App Router는 self.__next_f.push([n,"<조각>"]) 여러 번으로 스트리밍 → 이어붙임.
const NEXT_FLIGHT_PUSH = /self\.__next_f\.push\(\[\d+,"((?:[^"\\]|\\.)*)"\]\)/g;
function reconstructNextFlight(html) {
  const chunks = []; NEXT_FLIGHT_PUSH.lastIndex = 0; let match;
  while ((match = NEXT_FLIGHT_PUSH.exec(html)) !== null) {
    try { chunks.push(JSON.parse(`"${match[1]}"`)); } catch (e) { /* 깨진 조각 skip */ }
  }
  return chunks.join('');
}

// Next.js Pages Router(구조가 더 단순한 경우)는 <script id="__NEXT_DATA__" type="application/json">
// 안에 그대로 JSON이 들어있음 — 이 경우는 균형중괄호 추출 없이 바로 JSON.parse 가능.
function extractNextDataScript(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}

module.exports = { sanitizeJsonLiteral, extractAssignedJson, reconstructNextFlight, extractNextDataScript };
