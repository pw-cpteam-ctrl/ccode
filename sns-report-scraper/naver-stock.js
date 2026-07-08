/**
 * 네이버 스마트스토어/브랜드스토어 공개 상품 페이지에서 재고/가격을 읽어옴.
 * 로그인/세션/API 승인 전혀 필요 없음 — "Naver Store Stock Overlay" 크롬 확장(사용자가
 * 공유해준 소스)을 분석해보니, 이 확장은 숨겨진 API를 호출하는 게 아니라 공개 상품 페이지
 * 자체에 이미 박혀있는 데이터를 읽는 것뿐이었음:
 *   1. 최초 페이지 로드 시 <script>에 박히는 `window.__PRELOADED_STATE__ = {...}` (Next.js
 *      SSR 하이드레이션용 데이터, 원래 공개된 정보)
 *   2. SPA 네비게이션 시 스트리밍되는 `self.__next_f.push([n, "..."])` (React Server
 *      Components flight 데이터, 역시 페이지 HTML에 그대로 포함됨)
 * 둘 다 로그인 없이 그 상품 페이지만 열면 아무나 받는 데이터라, PW/BH 스토어 둘 다 동일하게
 * 적용 가능. 단 "재고/가격/판매상태"만 알 수 있고 실제 매출액/주문건수는 안 나옴 — 매출은
 * 여전히 커머스API/엑셀 내보내기가 필요함(PLAN.md 참고). 재고는 "현재 시점"만 나오므로 기간별
 * 판매량을 추정하려면 이 스크립트로 주기적 스냅샷을 쌓아야 함(과거 소급 불가).
 *
 * ⚠️ 이 샌드박스 환경은 브랜드/스마트스토어 접속 시 네이버 엣지(nfront)가 이 환경의 IP를
 * 통째로 막아서(정적 429 에러 페이지) 실제 네트워크 검증을 못 함 — twitter.js/instagram.js와
 * 같은 이유로 실제 검증은 사용자 로컬 컴퓨터에서 해야 함.
 */

// 확장의 sanitizeJsonLiteral와 동일 — __PRELOADED_STATE__는 JS 객체 리터럴이라 NaN/undefined/
// Infinity 같은 순수 JSON이 아닌 토큰이 섞여 있을 수 있어서, 문자열 리터럴 밖에서만 null로 치환.
const NON_JSON_LITERALS = ['-Infinity', 'undefined', 'Infinity', 'NaN'];

function sanitizeJsonLiteral(text) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    const literal = NON_JSON_LITERALS.find(candidate => text.startsWith(candidate, index));
    if (literal) {
      result += 'null';
      index += literal.length - 1;
      continue;
    }

    result += char;
  }

  return result;
}

// marker(예: "__PRELOADED_STATE__") 뒤 첫 "=" 다음에 오는 균형잡힌 {...} 또는 [...] 블록을
// 잘라냄 — 확장의 extractAssignedJson과 동일한 알고리즘.
function extractAssignedJson(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return '';

  const assignmentIndex = text.indexOf('=', markerIndex + marker.length);
  if (assignmentIndex === -1) return '';

  let startIndex = -1;
  for (let index = assignmentIndex + 1; index < text.length; index += 1) {
    if (text[index] === '{' || text[index] === '[') { startIndex = index; break; }
    if (!/\s/.test(text[index])) return '';
  }
  if (startIndex === -1) return '';

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') { stack.push(char); continue; }
    if (char === '}' || char === ']') {
      const opener = stack.pop();
      if ((char === '}' && opener !== '{') || (char === ']' && opener !== '[')) return '';
      if (stack.length === 0) return text.slice(startIndex, index + 1);
    }
  }

  return '';
}

// Next.js App Router 페이지(예: search.shopping.naver.com)는 __PRELOADED_STATE__ 대신
// self.__next_f.push([n, "<이스케이프된 조각>"]) 여러 번으로 스트리밍함 — 이어붙이면
// 개행으로 구분된 "<hexId>:<json>" 행들이 나오고, 그 중 하나에 상품 데이터가 들어있음.
const NEXT_FLIGHT_PUSH = /self\.__next_f\.push\(\[\d+,"((?:[^"\\]|\\.)*)"\]\)/g;

function reconstructNextFlight(html) {
  const chunks = [];
  NEXT_FLIGHT_PUSH.lastIndex = 0;
  let match;
  while ((match = NEXT_FLIGHT_PUSH.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`));
    } catch (error) {
      // 이스케이프가 깨진 조각은 건너뜀
    }
  }
  return chunks.join('');
}

const PRODUCT_ID_KEYS = [
  'channelProductId', 'channelProductNo', 'productNo', 'originProductNo',
  'productId', 'productSeq', 'mallProductId', 'nvMid', 'itemNo', 'itemId', 'id',
];
const PRODUCT_HINT_KEYS = [
  'channelProductNo', 'productNo', 'originProductNo', 'productId', 'productName', 'name',
  'productUrl', 'representativeImageUrl', 'imageUrl', 'mobileImageUrl', 'salePrice', 'discountedSalePrice',
];
const STOCK_KEYS = [
  'stockQuantity', 'stockQty', 'stockCount', 'saleStockQuantity', 'availableStockQuantity',
  'availableStock', 'remainStockQuantity', 'remainingStockQuantity', 'usableStockQuantity',
  'inventoryQuantity', 'inventoryQty',
];
const CONTEXTUAL_STOCK_KEYS = ['quantity', 'qty'];
const SOLD_OUT_KEYS = ['soldOut', 'soldout', 'isSoldOut', 'outOfStock', 'soldOutYn', 'stockYn', 'saleStatus', 'status'];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function parseStockValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^(품절|sold\s*out|out\s*of\s*stock)$/i.test(normalized)) return 0;
    if (/^\d[\d,]*$/.test(normalized)) return Number.parseInt(normalized.replaceAll(',', ''), 10);
  }
  return null;
}

function parseSoldOutValue(value) {
  if (value === true) return 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['y', 'yes', 'true', 'soldout', 'sold_out', 'out_of_stock'].includes(normalized)) return 0;
    if (normalized.includes('품절') || normalized.includes('soldout')) return 0;
  }
  return null;
}

function normalizeProductId(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text || text.length > 40) return '';
  const match = text.match(/\d{4,}/);
  return match ? match[0] : '';
}

function objectHasAnyKey(object, keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(object, key));
}

function looksProductLike(object) {
  return objectHasAnyKey(object, PRODUCT_HINT_KEYS);
}

function looksSimpleProductLike(object) {
  return (
    Object.prototype.hasOwnProperty.call(object, 'id') &&
    Object.prototype.hasOwnProperty.call(object, 'productNo') &&
    (Object.prototype.hasOwnProperty.call(object, 'stockQuantity') ||
      Object.prototype.hasOwnProperty.call(object, 'productStatusType') ||
      Object.prototype.hasOwnProperty.call(object, 'representativeImageUrl'))
  );
}

function pickProductId(object) {
  if (looksSimpleProductLike(object)) {
    const channelProductId = normalizeProductId(object.id);
    if (channelProductId) return channelProductId;
  }
  for (const key of PRODUCT_ID_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    if (key === 'id' && !looksProductLike(object)) continue;
    const productId = normalizeProductId(object[key]);
    if (productId) return productId;
  }
  return '';
}

function pickProductName(object) {
  for (const key of ['productName', 'name', 'displayName']) {
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim();
  }
  return '';
}

function hasStockContext(object, context) {
  const pathText = context.path.join('.').toLowerCase();
  const keyText = Object.keys(object).join('.').toLowerCase();
  const haystack = `${pathText}.${keyText}`;
  const hasPositiveSignal = haystack.includes('stock') || haystack.includes('inventory') || haystack.includes('remain') || haystack.includes('available');
  const hasOrderSignal = haystack.includes('orderamount') || haystack.includes('totalorderamount') || haystack.includes('product-benefit') || haystack.includes('benefit');
  return hasPositiveSignal && !hasOrderSignal;
}

function pickStock(object, context) {
  for (const key of STOCK_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const stock = parseStockValue(object[key]);
    if (stock !== null) return { key, stock };
  }
  if (hasStockContext(object, context)) {
    for (const key of CONTEXTUAL_STOCK_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
      const stock = parseStockValue(object[key]);
      if (stock !== null) return { key, stock };
    }
  }
  for (const key of SOLD_OUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const stock = parseSoldOutValue(object[key]);
    if (stock !== null) return { key, stock };
  }
  return null;
}

function pickPrice(object) {
  const salePrice = typeof object.salePrice === 'number' ? object.salePrice
    : typeof object.dispSalePrice === 'number' ? object.dispSalePrice : null;
  const discounted = object.benefitsView?.discountedSalePrice ?? object.discountedSalePrice;
  if (typeof discounted === 'number' && salePrice !== null && discounted < salePrice) return discounted;
  return salePrice;
}

// 확장의 extractStockRecords와 동일한 트리 탐색 — payload(파싱된 __PRELOADED_STATE__ 또는
// flight JSON 행) 전체를 재귀적으로 훑으면서 상품ID + 재고 신호가 같이 있는 객체를 찾음.
function extractStockRecords(payload) {
  const records = new Map();
  const seenObjects = new WeakSet();

  function summarize(record) {
    if (record.directStocks.length > 0) return record.directStocks[0].stock;
    const uniqueNestedStocks = [...new Set(record.nestedStocks.map(s => s.stock))];
    if (uniqueNestedStocks.length === 1) return uniqueNestedStocks[0];
    return uniqueNestedStocks.reduce((sum, s) => sum + s, 0);
  }

  function addRecord(productId, stockInfo, context, sourceObject, isDirect) {
    if (!productId || !stockInfo) return;
    const current = records.get(productId) || { directStocks: [], nestedStocks: [], name: '', price: null, keys: new Set() };
    const sample = { stock: stockInfo.stock, key: stockInfo.key };
    if (isDirect) current.directStocks.push(sample);
    else current.nestedStocks.push(sample);
    if (!current.name && context.name) current.name = context.name;
    if (current.price === null) {
      const price = pickPrice(sourceObject);
      if (typeof price === 'number') current.price = price;
    }
    current.keys.add(stockInfo.key);
    records.set(productId, current);
  }

  function walk(node, context = { productId: '', name: '', path: [] }) {
    if (Array.isArray(node)) { node.forEach(item => walk(item, context)); return; }
    if (!isPlainObject(node) || seenObjects.has(node)) return;
    seenObjects.add(node);

    const ownProductId = pickProductId(node);
    const productId = ownProductId || context.productId;
    const name = pickProductName(node) || context.name;
    const nextContext = { ...context, productId, name };
    const stockInfo = pickStock(node, nextContext);

    addRecord(productId, stockInfo, nextContext, node, Boolean(ownProductId));

    for (const [key, value] of Object.entries(node)) {
      if (value && (Array.isArray(value) || isPlainObject(value))) {
        walk(value, { ...nextContext, path: [...nextContext.path, key] });
      }
    }
  }

  walk(payload);

  return [...records.entries()].map(([productId, record]) => ({
    productId,
    stock: summarize(record),
    name: record.name,
    price: record.price,
    keys: [...record.keys],
  }));
}

// HTML 전체 텍스트에서 __PRELOADED_STATE__ 및 __next_f 두 경로 다 시도해서 상품 레코드를 모음
// (스크립트 태그로 안 자르고 원문 문자열 그대로 검사해도 동작 — extractAssignedJson이 marker
// 위치부터 알아서 찾음).
function extractFromHtml(html) {
  const merged = new Map();

  const mergeIn = (records) => {
    for (const record of records) {
      if (!record.productId) continue;
      const existing = merged.get(record.productId);
      if (!existing || existing.stock === null || existing.stock === undefined) {
        merged.set(record.productId, record);
      }
    }
  };

  if (html.includes('__PRELOADED_STATE__')) {
    const jsonText = extractAssignedJson(html, '__PRELOADED_STATE__');
    if (jsonText) {
      try { mergeIn(extractStockRecords(JSON.parse(sanitizeJsonLiteral(jsonText)))); } catch (error) { /* 무시 */ }
    }
  }

  if (html.includes('__next_f')) {
    const flight = reconstructNextFlight(html);
    for (const row of flight.split('\n')) {
      const colonIndex = row.indexOf(':');
      if (colonIndex === -1) continue;
      const payload = row.slice(colonIndex + 1);
      if (payload[0] !== '{' && payload[0] !== '[') continue;
      try { mergeIn(extractStockRecords(JSON.parse(sanitizeJsonLiteral(payload)))); } catch (error) { /* 스트리밍 중 불완전한 행은 무시 */ }
    }
  }

  return [...merged.values()];
}

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

async function fetchProductPage(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.text();
}

// 상품 페이지 하나에서 재고/가격 레코드를 가져옴. 목록/메인 페이지에도 그대로 쓸 수 있음
// (여러 상품이 한 페이지에 있으면 배열로 여러 건 반환).
async function getProductStock(url) {
  const html = await fetchProductPage(url);
  return extractFromHtml(html);
}

module.exports = {
  getProductStock,
  fetchProductPage,
  extractFromHtml,
  extractStockRecords,
  sanitizeJsonLiteral,
  extractAssignedJson,
  reconstructNextFlight,
};

// CLI로 바로 테스트: node naver-stock.js <상품 또는 스토어 URL>
if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error('사용법: node naver-stock.js <네이버 상품/스토어 URL>');
    process.exit(1);
  }
  getProductStock(url)
    .then(records => {
      if (records.length === 0) {
        console.log('❌ 상품 데이터를 못 찾음 — 페이지 구조가 바뀌었거나 접근이 막혔을 수 있음(HTML 저장해서 확인 필요)');
        return;
      }
      console.log(`✅ ${records.length}건 발견:`);
      records.forEach(r => {
        console.log(`  상품번호 ${r.productId} | 재고 ${r.stock ?? '?'} | 가격 ${r.price ?? '?'} | ${r.name || '(이름 없음)'} | 감지키: ${r.keys.join(', ')}`);
      });
    })
    .catch(err => {
      console.error('❌ 실패:', err.message);
      process.exit(1);
    });
}
