/**
 * naver-stock-snapshot.js가 쌓아둔 재고 히스토리를 정리해서 상품별 "총 판매 추정치"를 계산.
 *
 * ⚠️ 두 번째 방향 전환: 한때 "이 상품을 우리가 처음 관측했을 때 재고 - 현재재고"(firstStock
 * 기준 실측 delta)를 "실제 기준점 있음(hasRealBaseline)"으로 우대해서 썼는데, 이러면 스냅샷을
 * 쌓기 시작한 지 며칠 안 된 상품은 "우리가 추적한 이후"만 잡혀서 1개/6개/8개처럼 터무니없이
 * 작은 숫자가 나옴 — 메가하우스 피규어는 예약판매가 보통 몇 달째 진행 중이라 실제 누적 판매는
 * 그보다 훨씬 큰데, 우리 관측 시작점이 늦었다는 이유로 축소돼 보이는 문제.
 *
 * 그래서 이제 totalSold는 실제 과거 스냅샷 유무와 무관하게 **항상** 메가하우스 예약판매 관행
 * (9999/10000 같은 "깔끔한" 숫자로 판매 한도를 걸어둠)을 이용해 현재 재고 위의 가장 가까운
 * 1000단위를 "초기 한도"로 가정하고 역산(estimateInitialCap)한다 — `초기한도 - 현재재고`.
 * 예약 시작 시점부터의 총 판매를 더 잘 반영하지만 여전히 추정치이므로 totalSoldIsEstimated는
 * 항상 true, 화면엔 "*"로 표시해서 정확도 한계를 숨기지 않음.
 *
 * ⚠️ 세 번째 방향 전환(2026-08-06): 위 "**항상** 초기한도 역산"이 **이미 발매(입고)된 상품까지
 * 싸잡아 적용되는 심각한 문제**가 실사용에서 드러남 — 재고 11개짜리 입고 상품이 "989개
 * 판매추정"으로 표시됨(초기한도를 최소 1000으로 강제하니 1000-11=989). 완전히 지어낸 숫자이고,
 * 그렇게 만들어진 가짜 수치가 매출 순위 1·2위를 차지해 진짜 예약 판매량을 밀어냄.
 * 애초에 PLAN.md(313~315행)에 "9000~10000대는 예약 한도에서 줄어든 만큼이 판매량이고,
 * 82/24/15/6처럼 낮은 숫자는 이미 발매(입고)된 상품의 진짜 물리 재고"라고 처음부터 적혀
 * 있었는데, 2026-07-10 수정이 그 구분을 통째로 버린 것이 원인.
 * → 이제 **예약 상품일 때만** 역산하고, 입고 상품은 totalSold를 계산하지 않음(null).
 *   근거 없는 숫자를 만드느니 "모른다"고 두는 게 맞고, 입고 상품의 실제 판매는 stockDelta
 *   (직전 스냅샷 대비 실측 감소량)로 이미 볼 수 있음.
 *
 * ⚠️ 세트 상품 수량 보정(2026-08-06): 자사(PW)는 "(6종세트)"처럼 **괄호 안에 (N종세트)로
 * 적힌 묶음**을 1세트 단위로 파는데, 재고는 낱개 기준으로 차감됨(8종세트 1개 팔리면 재고 -8).
 * 그래서 그런 상품은 재고/판매량을 N으로 나눠야 실제 판매 단위 수량이 됨. 실제 스냅샷 2개로
 * 검증함: 괄호형 (N종세트) 8건은 재고 감소량이 전부 N의 배수(104÷8, 224÷8, 48÷6, 52÷4 …),
 * 반면 괄호 밖 "2종세트 곤 키르아 룩업" 같은 묶음상품은 비배수(341, 97, 115 …)라 1판매=1차감.
 * 경쟁사(BH)는 "(1BOX 6개 구성)"/"(6종 단품 랜덤)" 어느 표기든 12건 전부 비배수 → 나누지 않음.
 *
 * stockDelta(직전 스냅샷 대비 변화량)는 참고용으로 그대로 남겨둠 — "최근에 얼마나 움직였는지"는
 * totalSold(누적)와는 별개 관심사.
 *
 * 결과물은 두 군데에서 씀(html-report.js): (1) SNS 비교표 우측 끝에 붙는 매출 매칭 컬럼
 * (findStockMatch), (2) 리포트 맨 아래 독립 섹션으로 PW/BH 재고 전체 목록(renderStockSectionHtml)
 * — 후자는 SNS 상품과 매칭 안 되는(또는 SNS에 아예 안 올라온) 상품까지 포함한 전체 현황용.
 */

const { extractKeywords, detectProductLine } = require('./aggregate');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 현재 재고를 가장 가까운 1000단위로 올려서 "초기 판매한도였을 것"으로 가정하고 역산 —
// **예약 상품에만** 적용한다(입고 상품엔 쓰면 안 됨 — 파일 헤더의 세 번째 방향 전환 참고).
function estimateInitialCap(stock) {
  if (typeof stock !== 'number') return null;
  return Math.max(1000, Math.ceil(stock / 1000) * 1000);
}

// 예약판매 중인 상품으로 볼 재고 하한선. 이 아래는 예약 한도가 아니라 실제 물리 재고로 본다.
// (사용자 확인: "2000개 이하는 다 예약수량이 아닌 재고수로 봐줘")
const PREORDER_MIN_STOCK = 2000;

/**
 * 이 상품이 "예약판매 중"인지 판정.
 * - 상품명에 `[예약]` 표기가 없으면 입고 상품(사용자 확인: "예약 없는 건 확실히 입고")
 * - 표기가 있어도 재고가 PREORDER_MIN_STOCK 이하면 입고로 본다 — 재판 상품이 `[예약]` 표기를
 *   그대로 달고 있는 경우가 실제로 있음(예: "[예약] 파피몬 룩업 l 디지몬 어드벤처 (재판)"이
 *   재고 22개). 표기만 믿으면 이런 상품에 또 989개 같은 가짜 숫자가 붙음.
 * ⚠️ 판정은 반드시 **세트로 나누기 전 원본 재고**로 해야 함 — 나눈 값으로 판정하면 재고
 *   9970짜리 예약 세트상품(÷6=1661)이 입고로 오분류됨(실제 데이터로 확인).
 */
function isPreorderProduct(name, rawStock) {
  if (typeof rawStock !== 'number') return false;
  if (!/\[예약\]/.test(name || '')) return false;
  return rawStock > PREORDER_MIN_STOCK;
}

/**
 * 상품명에서 "1회 판매 시 재고가 몇 개씩 차감되는지"(세트 크기)를 뽑음.
 * **괄호 안에 "(N종세트)" 형태로 적힌 것만** 해당 — 괄호 밖의 "2종세트 곤 키르아 룩업"은
 * 서로 다른 피규어를 묶어 파는 상품이라 1판매=1차감이라서 나누면 안 됨(스냅샷으로 검증).
 * "(6종+랜덤2종 세트)"처럼 여러 개가 적히면 합산(6+2=8).
 */
function parseSetSize(name) {
  for (const group of String(name || '').match(/\(([^)]*)\)/g) || []) {
    if (!group.includes('세트')) continue;
    const counts = [...group.matchAll(/(\d+)\s*종/g)].map(m => Number(m[1]));
    if (counts.length) return counts.reduce((a, b) => a + b, 0);
  }
  return 1;
}

// 히스토리(naver-stock-snapshot.js가 저장한 { snapshots: [...] })를 받아서 store(PW/BH)별로
// 상품별 총 판매 추정치(totalSold)를 계산.
//
// store별로 "비교 가능 여부(storeComparable)"를 따로 둠 — 직전 스냅샷이 전체적으로 존재해도,
// 그 시점에 특정 store만 수집 실패(0건)했을 수 있음(예: 로그인 게이트 걸려서 BH만 0건이었던
// 적이 있었음) — stockDelta(직전 대비, 참고용) 계산에만 영향을 줌.
function buildStockComparison(history) {
  const snapshots = history?.snapshots || [];
  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const storeLabels = Object.keys(latest.stores || {});

  const stores = {};
  const storeComparable = {};
  for (const label of storeLabels) {
    const latestRecords = latest.stores[label] || [];
    const prevRecords = previous ? (previous.stores[label] || []) : [];
    storeComparable[label] = prevRecords.length > 0;
    const prevByProductId = new Map(prevRecords.map(r => [r.productId, r]));

    const products = latestRecords.map(r => {
      const prev = prevByProductId.get(r.productId);
      // 세트 크기로 나눠서 "실제 판매 단위" 기준 수량으로 환산. 판정(예약/입고)은 나누기 전
      // 원본 재고로 해야 하므로(파일 헤더 참고) 순서에 주의.
      const setSize = parseSetSize(r.name);
      const perSet = v => (typeof v === 'number' ? Math.round(v / setSize) : null);
      const preorder = isPreorderProduct(r.name, r.stock);

      const rawDelta = prev && typeof prev.stock === 'number' && typeof r.stock === 'number'
        ? prev.stock - r.stock // 양수 = 직전 스냅샷 대비 줄어든 수량(실측값)
        : null;

      // 예약 상품만 초기한도 역산. 입고 상품은 총 판매량을 알 방법이 없으므로 null —
      // 지어낸 숫자를 넣지 않는다(입고 상품의 실제 판매는 stockDelta로 확인 가능).
      const estimatedCap = preorder ? estimateInitialCap(r.stock) : null;
      const totalSold = preorder && typeof r.stock === 'number' ? perSet(estimatedCap - r.stock) : null;

      return {
        productId: r.productId, name: r.name, price: r.price,
        stock: perSet(r.stock), rawStock: r.stock, setSize, isPreorder: preorder,
        prevStock: prev ? perSet(prev.stock) : null, stockDelta: perSet(rawDelta),
        estimatedCap, totalSold, totalSoldIsEstimated: preorder,
      };
    });

    stores[label] = products;
  }

  // snapshots를 그대로 들고 있음 — 종합표(통합 매칭 + 시간별 추이) 렌더링 시 전체 히스토리가
  // 필요한데, 그때마다 buildStockComparison을 다시 부르거나 별도로 history를 전달하지 않아도
  // 되게 하려는 목적.
  return { latestTakenAt: latest.takenAt, previousTakenAt: previous ? previous.takenAt : null, snapshotCount: snapshots.length, stores, storeComparable, snapshots };
}

function formatTakenAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

function rankMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

// 총 판매 추정치(totalSold) 기준으로 정렬 + 순위 부여. 재고 자체를 모르는 경우(totalSold
// 계산 불가)만 순위(rank: null)를 매기지 않음 — 근거 없는 숫자를 안 만듦.
function rankStockProducts(products) {
  const sorted = [...products].sort((a, b) => (b.totalSold ?? -Infinity) - (a.totalSold ?? -Infinity));
  let rankCounter = 0;
  return sorted.map(p => ({ ...p, rank: p.totalSold != null ? ++rankCounter : null }));
}

function tokenize(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

// SNS 상품(ip/line)과 네이버 재고 상품(name)은 서로 다른 데이터라 정확한 ID 매칭이 안 되므로,
// ip를 단어 단위로 쪼개서 그 단어들이 전부 상품명에 들어있는지로 근사 매칭(있으면 line도 확인)
// — ip가 "은혼 카무이"처럼 여러 단어일 때 "은혼 GEM 카무이"처럼 중간에 다른 말이 끼어도
// 매칭되게 하려면 통짜 substring 비교로는 안 되고 단어 단위 AND 매칭이 필요함.
//
// ⚠️ 2026-08-06: 라인 비교를 `name.includes(line)`(문자열 포함)에서 detectProductLine 결과
// 비교로 바꿈 — "GEM 테노히라 미나토"는 이름에 "GEM"이 들어있어서 line="GEM"인 SNS 행에
// 후보로 잡혔지만 실제로는 테노히라(손바닥) 라인이라 다른 상품임. 정식 라인명끼리 비교해야
// 이런 상위/하위 브랜드 혼동이 안 생김.
//
// ⚠️ 후보가 여럿일 때 "판매량이 가장 큰 것"을 고르던 방식도 폐기 — ip가 프랜차이즈 수준
// ("나루토 질풍전")이라 캐릭터가 다른 상품이 전부 후보로 잡히는데, 그중 판매량 큰 걸 집으면
// 엉뚱한 상품이 붙음(실제 사례: "우치하 이타치 & 사스케 [재판]" 게시물 행에 "우즈마키 나루토
// 닌자대전 버전"의 664개가 붙음). 지금은 hints(게시물 본문에서 뽑은 캐릭터명 등)와 겹치는
// 정도로 점수를 매겨 고르고, 구분할 근거가 없으면(동점) 아예 매칭하지 않음 — 틀린 매칭보다
// 빈칸이 안전.
function findStockMatch(ip, line, rankedProducts, hints = []) {
  const scored = scoreStockCandidates(ip, line, rankedProducts, hints);
  if (scored.length === 0) return null;
  // 1등이 2등과 점수가 같으면(구분 근거 없음) 매칭 포기
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].product;
}

// findStockMatch용 후보 점수 계산 — 점수 내림차순으로 정렬해서 반환.
// 점수 = hints(게시물에서 뽑은 키워드)와 재고 상품명이 겹치는 개수.
function scoreStockCandidates(ip, line, rankedProducts, hints = []) {
  if (!ip || !rankedProducts || rankedProducts.length === 0) return [];
  const ipTokens = tokenize(ip);
  if (ipTokens.length === 0) return [];
  let candidates = rankedProducts.filter(r => r.name && ipTokens.every(t => r.name.includes(t)));
  if (line && line !== '-') {
    // 정식 라인명끼리 비교(문자열 포함이 아니라) — GEM ↔ 테노히라 혼동 방지.
    // ⚠️ 예전엔 `if (refined.length > 0) candidates = refined;`라 **라인이 맞는 후보가 하나도
    // 없으면 필터를 통째로 무시하고 전체 후보에서 아무거나 골랐음.** 재고 목록에 아직 안
    // 올라온 신제품(예약 개시 전) 게시물이 바로 이 경우인데, 같은 프랜차이즈의 전혀 다른
    // 라인 상품(GEM/테노히라/메가캣)이 그 자리에 붙어버림 — "매칭 안 됨"이 정답인 상황에서
    // 틀린 숫자를 만들어내던 것. 이제 라인이 맞는 후보가 없으면 매칭하지 않는다.
    candidates = candidates.filter(r => detectProductLine(r.name) === line);
  }
  if (candidates.length === 0) return [];
  const hintTokens = [...new Set(hints)].filter(h => h && !ipTokens.includes(h));
  return candidates
    .map(product => ({
      product,
      score: hintTokens.filter(h => product.name.includes(h)).length,
    }))
    .sort((a, b) => b.score - a.score || String(a.product.productId).localeCompare(String(b.product.productId)));
}

/**
 * SNS 상품 행 전체에 대해 재고 상품을 **한 번에** 배정. 재고 상품 하나는 최대 한 행에만
 * 붙는다(중복 금지).
 *
 * ⚠️ 예전엔 행마다 독립적으로 findStockMatch를 부르다 보니 같은 재고 상품이 여러 행에 동시에
 * 붙어서 매출이 중복 계상됐음(실제 사례: BH "14개*"가 나루토 질풍전 3개 행에 동시에, PW
 * "10개*"가 나루토와 도검난무 양쪽에). 행 단위로 보면 각자 "제일 그럴듯한 후보"를 고른
 * 것이지만 전체로 보면 같은 상품을 여러 번 판 것처럼 보이는 문제.
 *
 * 점수가 높은 (행, 재고상품) 쌍부터 확정하는 탐욕적 배정 — 확신이 큰 짝을 먼저 확정하고,
 * 이미 쓰인 재고 상품은 후보에서 빠진다. 남은 후보가 동점이면 그 행은 매칭하지 않음.
 *
 * @param {Array<{ip:?string, line:?string}>} snsRows SNS 상품 행 목록
 * @param {object[]} rankedProducts 재고 상품 목록(rankStockProducts 결과)
 * @param {(row:object)=>string[]} getHints 행에서 캐릭터명 등 추가 단서를 뽑는 함수
 * @returns {Map<object, object>} SNS 행 → 재고 상품
 */
function assignStockMatches(snsRows, rankedProducts, getHints = () => []) {
  const assignment = new Map();
  if (!snsRows || !rankedProducts || rankedProducts.length === 0) return assignment;

  // (행, 후보) 쌍을 전부 만들어 점수 순으로 정렬
  const pairs = [];
  snsRows.forEach((row, rowIdx) => {
    scoreStockCandidates(row.ip, row.line, rankedProducts, getHints(row)).forEach(({ product, score }) => {
      pairs.push({ rowIdx, row, product, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.rowIdx - b.rowIdx
    || String(a.product.productId).localeCompare(String(b.product.productId)));

  const usedProducts = new Set();
  const bestScoreOfRow = new Map(); // 확정된 행의 점수(동점 판별용)
  for (const { row, product, score } of pairs) {
    if (assignment.has(row) || usedProducts.has(product.productId)) continue;
    // 이 행에 대해 아직 안 쓰인 후보 중 최고점이 동점이면(구분 근거 없음) 배정하지 않음
    const remaining = pairs.filter(p => p.row === row && !usedProducts.has(p.product.productId));
    if (remaining.length > 1 && remaining[1].score === score) continue;
    assignment.set(row, product);
    usedProducts.add(product.productId);
    bestScoreOfRow.set(row, score);
  }
  return assignment;
}

// "N개 판매추정 (재고 M개)"처럼 판매추정치와 현재 재고를 한 셀에 같이 보여줌 — 예전엔 이전
// 재고(추정치인 경우 "~5000(추정)"처럼 가상의 숫자)와 변화량을 따로 된 컬럼에 나눠서 보여줘서
// "그래서 지금 재고가 몇 개 남았는지"를 셀 두 개를 대조해야 알 수 있었음 — 병기해서 한눈에.
function soldWithStockText(p) {
  const stockText = `재고 ${p.stock.toLocaleString()}개`;
  if (p.totalSold === null || p.totalSold === undefined) return `비교 불가 (${stockText})`;
  const mark = p.totalSoldIsEstimated ? '*' : '';
  if (p.totalSold > 0) return `${p.totalSold.toLocaleString()}개 판매추정${mark} (${stockText})`;
  if (p.totalSold < 0) return `재입고 +${Math.abs(p.totalSold).toLocaleString()}개${mark} (${stockText})`;
  return `변화 없음${mark} (${stockText})`;
}

// totalSold(초기한도 역산, 항상 나오는 값)와 별개로, "직전 스냅샷 찍은 이후로만" 몇 개
// 팔렸는지도 참고용으로 보고 싶다는 요청 — stockDelta는 buildStockComparison에서 이미
// 계산해둔 필드(양수=직전 대비 줄어든 수량)라 그대로 표시만 하면 됨.
function stockDeltaText(p) {
  if (p.stockDelta === null || p.stockDelta === undefined) return '비교 불가';
  if (p.stockDelta > 0) return `${p.stockDelta.toLocaleString()}개 판매`;
  if (p.stockDelta < 0) return `재입고 +${Math.abs(p.stockDelta).toLocaleString()}개`;
  return '변화 없음';
}

// ── 종합표(PW+BH 통합 매칭) ──────────────────────────────────────────────
// 재고 스냅샷 섹션이 원래 PW표/BH표로 나뉘어 있었는데, "SNS 표처럼 PW/BH를 한 행에서
// 바로 비교하고 싶다"는 요청으로 종합표를 추가함 — PW표/BH표는 지우지 않고 그대로 두고
// (전체 재고 현황은 매칭 여부와 무관하게 항상 보여야 하니까), 종합표는 그 위에 추가로 얹음.
//
// 매칭 로직은 SNS 상품 매칭(aggregate.js의 extractKeywords/detectProductLine, 키워드
// 2개 이상 겹치고 라인이 정확히 같아야 함)을 그대로 재사용 — 재고 상품명("[예약] GEM
// 시리즈 카무이 ver 2 l 은혼 (재판)")도 브라켓/상용구/라인명을 걸러내면 SNS 텍스트와
// 같은 방식으로 비교 가능. 한 그룹에 PW/BH가 각각 정확히 1개씩만 있을 때만 짝지음 —
// 여러 개가 몰리면(재판/리뉴얼 등) 어느 걸 짝지어야 할지 애매하니 매칭 안 시키고
// PW표/BH표에만 남겨둠(잘못 짝짓는 것보다 안전).
// ⚠️ 처음엔 SNS 매칭(aggregate.js)과 완전히 같은 Union-Find 방식을 그대로 재사용했는데,
// 실제 데이터로 확인해보니 매칭률이 너무 낮았음(51 PW개 중 14쌍만). 원인: Union-Find는
// "전이적으로" 묶기 때문에(A-B, B-C가 연결되면 A-C까지 한 그룹), 같은 프랜차이즈의 여러
// 변형 상품(예: "리바이 단품", "엘런 단품", "엘런+리바이 세트")이 프랜차이즈명("진격",
// "거인")만으로도 서로 연결돼서 PW 여러 개 + BH 여러 개가 뒤섞인 큰 그룹이 되고, 그러면
// 코드가 "1:1이 아니면 매칭 안 함"으로 전부 버려버림 — 정작 "리바이 단품" 하나만 놓고 보면
// BH의 "리바이 단품"과 명백히 제일 잘 맞는 진짜 짝이 있었는데도 그룹이 뒤섞여서 놓친 것.
//
// 그래서 Union-Find(그룹화) 대신 PW-BH 쌍마다 직접 유사도 점수를 매기고(겹친 키워드 수를
// 두 상품명 중 키워드가 더 많은 쪽 개수로 나눈 비율 — 세트 상품처럼 키워드가 많이 붙어서
// 우연히 겹치는 경우에 점수가 낮아짐), PW/BH가 서로를 1순위로 고를 때만("상호 최선")
// 확정 짝으로 인정. 점수가 동률인 후보가 있으면(예: 같은 상품의 "박스 구성"/"단품 랜덤"
// 버전처럼 진짜 구분이 안 되는 경우) 그 상품은 짝짓지 않고 넘어감 — 잘못 짝짓는 것보다 안전.
function matchPwBhStockProducts(pwProducts, bhProducts) {
  const MIN_SHARED_KEYWORDS = 2;
  const pwEntries = pwProducts.map(p => ({ product: p, keywords: extractKeywords(p.name), line: detectProductLine(p.name) }));
  const bhEntries = bhProducts.map(p => ({ product: p, keywords: extractKeywords(p.name), line: detectProductLine(p.name) }));

  const scored = [];
  pwEntries.forEach((pw, i) => {
    if (pw.keywords.length === 0) return;
    bhEntries.forEach((bh, j) => {
      if (bh.keywords.length === 0 || pw.line !== bh.line) return;
      const overlap = pw.keywords.filter(k => bh.keywords.includes(k));
      if (overlap.length < MIN_SHARED_KEYWORDS) return;
      scored.push({ i, j, score: overlap.length / Math.max(pw.keywords.length, bh.keywords.length) });
    });
  });

  // key(PW면 i, BH면 j) 기준으로 "제일 점수 높은 상대"를 찾되, 동점 후보가 있으면 tie=true.
  function bestByKey(key, otherKey) {
    const best = new Map();
    for (const s of scored) {
      const k = s[key];
      const cur = best.get(k);
      if (!cur || s.score > cur.score) best.set(k, { idx: s[otherKey], score: s.score, tie: false });
      else if (s.score === cur.score && s[otherKey] !== cur.idx) cur.tie = true;
    }
    return best;
  }
  const bestBhForPw = bestByKey('i', 'j');
  const bestPwForBh = bestByKey('j', 'i');

  const pairs = [];
  bestBhForPw.forEach((bhBest, pwIdx) => {
    if (bhBest.tie) return; // 이 PW 상품에 점수가 같은 BH 후보가 여럿 — 확정 안 함
    const pwBest = bestPwForBh.get(bhBest.idx);
    if (!pwBest || pwBest.tie || pwBest.idx !== pwIdx) return; // BH 쪽에서도 이 PW가 유일한 1순위여야 함
    pairs.push({ pw: pwEntries[pwIdx].product, bh: bhEntries[bhBest.idx].product });
  });
  return pairs;
}

// productId 하나의 스토어별 전체 스냅샷 재고 이력 — [{takenAt, stock}, ...] (오래된 순).
function stockSeries(snapshots, storeLabel, productId) {
  const series = [];
  for (const snap of snapshots) {
    const rec = (snap.stores[storeLabel] || []).find(r => r.productId === productId);
    if (rec && typeof rec.stock === 'number') series.push({ takenAt: snap.takenAt, stock: rec.stock });
  }
  return series;
}

// series 끝에서 stepsBack번째 지점과 그 바로 이전 지점의 차이 — stepsBack=1이면 "직전
// 스냅샷 대비"(stockDelta와 동일), stepsBack=2면 "그 전(전전) 스냅샷 대비". 그만큼 과거
// 데이터가 없으면(스냅샷이 아직 부족하면) null — 화면에선 빈 칸으로 처리.
function deltaAt(series, stepsBack) {
  const len = series.length;
  const cur = series[len - stepsBack];
  const prev = series[len - stepsBack - 1];
  if (!cur || !prev) return null;
  return prev.stock - cur.stock; // 양수 = 판매(감소)
}

// comparison(buildStockComparison 결과, snapshots 포함)에서 종합표에 필요한 행 데이터를
// 뽑아냄 — 매칭 페어별로 totalSold/점유율/최근 2단계 변화량/전체 추이 시리즈까지 한 번에.
function buildIntegratedStockRows(comparison) {
  const snapshots = comparison?.snapshots || [];
  if (snapshots.length === 0) return [];

  const pwLatest = comparison.stores.PW || [];
  const bhLatest = comparison.stores.BH || [];
  const pairs = matchPwBhStockProducts(pwLatest, bhLatest);

  const rows = pairs.map(({ pw, bh }) => {
    const pwSeries = stockSeries(snapshots, 'PW', pw.productId);
    const bhSeries = stockSeries(snapshots, 'BH', bh.productId);
    return {
      pw, bh,
      pwDelta2: deltaAt(pwSeries, 2),
      bhDelta2: deltaAt(bhSeries, 2),
      pwSeries, bhSeries,
    };
  });

  // 많이 팔린 순(PW+BH 총판매추정 합산 내림차순) 정렬 — 누락됐던 부분.
  rows.sort((a, b) => ((b.pw.totalSold ?? 0) + (b.bh.totalSold ?? 0)) - ((a.pw.totalSold ?? 0) + (a.bh.totalSold ?? 0)));
  return rows;
}

// "513개 (점유율 54%)"처럼 총 판매추정치와 양사 합산 기준 점유율을 한 칸에 표시.
// 총판매추정 개수만 — 점유율은 보기 불편하다는 피드백으로 별도 컬럼(shareText)으로 분리.
function totalSoldWithShareText(mine) {
  if (!mine || typeof mine.totalSold !== 'number') return '-';
  const mark = mine.totalSoldIsEstimated ? '*' : '';
  if (mine.totalSold > 0) return `${mine.totalSold.toLocaleString()}개${mark}`;
  if (mine.totalSold < 0) return `재입고+${Math.abs(mine.totalSold).toLocaleString()}개${mark}`;
  return `0개${mark}`;
}

// "72% : 28%"처럼 양사 합산 기준 점유율만 담당하는 전용 컬럼.
function shareText(pw, bh) {
  const a = Math.max(pw && typeof pw.totalSold === 'number' ? pw.totalSold : 0, 0);
  const b = Math.max(bh && typeof bh.totalSold === 'number' ? bh.totalSold : 0, 0);
  const sum = a + b;
  if (sum <= 0) return '-';
  const pwPct = Math.round((a / sum) * 100);
  return `${pwPct}% : ${100 - pwPct}%`;
}

// "직전/전전 스냅샷 대비" 칸 — PW/BH 둘 다 값이 없으면(스냅샷이 그만큼 안 쌓였으면) 공란.
function deltaPairText(pwDelta, bhDelta) {
  if (pwDelta === null && bhDelta === null) return '-';
  const one = v => (v === null || v === undefined) ? '-'
    : v > 0 ? `${v.toLocaleString()}개 판매`
      : v < 0 ? `재입고+${Math.abs(v).toLocaleString()}개`
        : '변화 없음';
  return `PW ${one(pwDelta)} · BH ${one(bhDelta)}`;
}

// 매칭된 상품 하나의 PW/BH "총판매추정" 추이.
//
// ⚠️ 세 번째 시행착오: (1) 원본 재고 수량을 한 축에 그렸다가 큰 고정값(초기한도)에
// 축이 지배당해 변화가 안 보임 → (2) 최초 시점=100 지수화로 바꿨는데 사용자가 "그냥
// 개수로 그리면 되지 지수화 왜 하냐"고 반려 → (3) 총판매추정 개수를 그대로 그렸지만,
// 실제 데이터로 확인해보니 여전히 일자로 보임: PW가 994~999개(하루 새 5개 차이)처럼
// 아주 좁은 범위에서 움직이는데, 그 값을 BH(386개, 변화 없음)와 **같은 축**(0부터
// 시작)에 그리다 보니 5개짜리 변화가 전체 축(0~1000+)의 0.5%도 안 돼서 또 안 보임 —
// 축을 0부터 강제로 시작한 게 원인. 그래서 PW/BH를 각자 축을 가진 두 개의 작은
// 그래프(위아래로 쌓음, small multiples)로 분리하고, 각 축은 그 시리즈 자체의
// 최소~최대 범위로 확대(0 강제 안 함) — 주가 차트처럼 "그 범위 안에서의 움직임"이
// 목적이라 0을 포함할 필요가 없음. 이러면 PW의 994~999개짜리 미세한 변화도, BH의
// 진짜로 변화 없는 평평한 선도 각자 제대로 보임. 값이 완전히 똑같아 축 범위가 0이
// 되는 경우엔 위아래로 최소 여백을 줘서 선이 차트 중앙에 보이게 함.
function stockTrendChart(pwSeries, bhSeries, pwName, bhName) {
  const allDates = [...new Set([...pwSeries, ...bhSeries].map(p => p.takenAt))].sort();
  if (allDates.length < 2) {
    // ⚠️ 문구 주의: 여기 개수는 **전체 스냅샷 수가 아니라 "이 상품이 관측된 시점 수"**임.
    // 새로 예약 개시된 신상품은 이전 스냅샷에 아예 없어서 1개로 나오는데, 예전 문구가
    // "현재 1개 시점"이라고만 해서 마치 전체 히스토리가 날아간 것처럼 읽혔음(실제로 그렇게
    // 오해해서 데이터 유실을 의심한 적 있음 — 스냅샷은 3개 다 멀쩡했음).
    return '<div class="trend-empty">이 상품은 아직 한 시점에서만 관측됨(최근에 추가된 상품일 수 있음) — 스냅샷이 2개 시점 이상 쌓이면 추이 그래프가 표시됩니다.</div>';
  }

  // 각 시점의 재고를 그 시점 기준 총판매추정치(estimateInitialCap 역산)로 환산.
  function toSoldSeries(series) {
    return series.map(p => ({ takenAt: p.takenAt, stock: p.stock, totalSold: estimateInitialCap(p.stock) - p.stock }));
  }
  const pwSold = toSoldSeries(pwSeries);
  const bhSold = toSoldSeries(bhSeries);

  const w = Math.max(560, allDates.length * 100);
  const ml = 60, mr = 20;
  const chartW = w - ml - mr;
  const panelH = 130, panelMt = 20, panelMb = 10;
  const chartH = panelH - panelMt - panelMb;
  const xAxisH = 34;
  const h = panelH * 2 + xAxisH;

  const x = i => ml + (allDates.length > 1 ? (i / (allDates.length - 1)) * chartW : chartW / 2);

  function panel(series, color, name, yOffset) {
    const values = series.map(p => p.totalSold);
    const rawMin = Math.min(...values), rawMax = Math.max(...values);
    // 값이 다 같으면(rawMax===rawMin) 범위가 0이 되니 최소 여백을 강제로 줌.
    const pad = (rawMax - rawMin) * 0.2 || Math.max(1, Math.abs(rawMax) * 0.05, 1);
    const min = rawMin - pad, max = rawMax + pad;
    const range = (max - min) || 1;
    const y = v => yOffset + panelMt + chartH - ((v - min) / range) * chartH;

    const gridLines = [];
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const v = min + (range / ticks) * i;
      const yy = y(v);
      gridLines.push(`<line x1="${ml}" y1="${yy}" x2="${w - mr}" y2="${yy}" stroke="#e9ecef" stroke-width="1"/>`);
      gridLines.push(`<text x="${ml - 8}" y="${yy + 3}" font-size="10" fill="#6b7280" text-anchor="end">${Math.round(v).toLocaleString()}</text>`);
    }
    const points = allDates
      .map((d, i) => { const rec = series.find(p => p.takenAt === d); return rec ? { i, rec } : null; })
      .filter(Boolean);
    const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.i)},${y(p.rec.totalSold)}`).join(' ');
    const dots = points.map(p => `<circle cx="${x(p.i)}" cy="${y(p.rec.totalSold)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"><title>${escapeHtml(formatTakenAt(p.rec.takenAt))} · ${p.rec.totalSold.toLocaleString()}개 판매추정(재고 ${p.rec.stock.toLocaleString()}개)</title></circle>`).join('');
    const label = `<text x="${ml}" y="${yOffset + 12}" font-size="11" font-weight="700" fill="${color}">${escapeHtml(name)}</text>`;
    return `${label}${gridLines.join('')}<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  }

  const pwPanel = panel(pwSold, '#1971c2', `PW ${pwName}`, 0);
  const bhPanel = panel(bhSold, '#c0504d', `BH ${bhName}`, panelH);
  const divider = `<line x1="${ml}" y1="${panelH}" x2="${w - mr}" y2="${panelH}" stroke="#eef0f4" stroke-width="1"/>`;

  // 같은 날짜에 스냅샷을 여러 번 찍을 수도 있어서(하루에 여러 번 실행) 날짜만 보여주면
  // 라벨이 죄다 "07-09"로 겹쳐 보임 — 날짜/시각을 2줄로 나눠서 구분되게 표시.
  const xLabels = allDates.map((d, i) => {
    const [datePart, timePart] = formatTakenAt(d).split(' ');
    const baseY = panelH * 2;
    return `<text x="${x(i)}" y="${baseY + 14}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(datePart.slice(5))}</text>` +
      `<text x="${x(i)}" y="${baseY + 28}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(timePart)}</text>`;
  }).join('');

  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${pwPanel}${divider}${bhPanel}${xLabels}</svg>`;

  return `<div class="trend-wrap">
    <div class="trend-sub">총판매추정(개) 추이 · PW/BH 각자 변화폭에 맞춰 축을 따로 확대함(둘의 축 스케일이 서로 다를 수 있음) · 실제 재고 수량은 점에 마우스를 올리면 확인 가능</div>
    <div class="trend-scroll">${svg}</div>
  </div>`;
}

function renderIntegratedRow(row, index) {
  const rowId = `stock-trend-${index}`;
  const pwText = totalSoldWithShareText(row.pw);
  const bhText = totalSoldWithShareText(row.bh);
  const shareTextValue = shareText(row.pw, row.bh);
  const delta1Text = deltaPairText(row.pw.stockDelta, row.bh.stockDelta);
  const delta2Text = deltaPairText(row.pwDelta2, row.bhDelta2);
  const chart = stockTrendChart(row.pwSeries, row.bhSeries, row.pw.name, row.bh.name);
  return `<tr>
      <td class="sd-name" title="${escapeHtml(row.pw.name)}">${escapeHtml(row.pw.name)}</td>
      <td class="sd-sold">${escapeHtml(pwText)}</td>
      <td class="sd-sold">${escapeHtml(bhText)}</td>
      <td>${escapeHtml(shareTextValue)}</td>
      <td>${escapeHtml(delta1Text)}</td>
      <td>${escapeHtml(delta2Text)}</td>
      <td><button class="toggle-btn" onclick="toggleStockTrend('${rowId}', this)">▶ 보기</button></td>
    </tr>
    <tr class="trend-row" id="${rowId}"><td colspan="7">${chart}</td></tr>`;
}

function renderIntegratedTable(rows) {
  if (rows.length === 0) return '';
  const body = rows.map((row, i) => renderIntegratedRow(row, i)).join('');
  return `
  <div class="stock-store stock-integrated">
    <div class="section-head">
      <h3>🔗 종합 (PW+BH 매칭, ${rows.length}쌍)</h3>
      <div class="toggle-all">
        <button class="toggle-all-btn" onclick="toggleAllStockTrends(true)">전체 펼치기</button>
        <button class="toggle-all-btn" onclick="toggleAllStockTrends(false)">전체 접기</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>상품명</th><th>PW 총판매추정</th><th>BH 총판매추정</th><th>점유율</th><th>직전 스냅샷 대비</th><th>그 전 스냅샷 대비</th><th>추이</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

function renderStoreTable(label, products) {
  const ranked = rankStockProducts(products);

  const rows = ranked.map(p => {
    const cls = p.totalSold > 0 ? 'sd-sold' : p.totalSold < 0 ? 'sd-restock' : p.totalSold === 0 ? 'sd-flat' : 'sd-na';
    const deltaCls = p.stockDelta > 0 ? 'sd-sold' : p.stockDelta < 0 ? 'sd-restock' : p.stockDelta === 0 ? 'sd-flat' : 'sd-na';
    return `<tr>
      <td class="sd-rank">${p.rank === null ? '-' : rankMedal(p.rank)}</td>
      <td class="sd-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name || '(이름 없음)')}</td>
      <td class="${cls}">${soldWithStockText(p)}</td>
      <td class="${deltaCls}">${stockDeltaText(p)}</td>
      <td class="sd-price">${p.price ? `${p.price.toLocaleString()}원` : '-'}</td>
    </tr>`;
  }).join('');

  return `
  <div class="stock-store">
    <h3>${escapeHtml(label)} (${products.length}개 상품)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>매출순위</th><th>상품명</th><th>총 판매추정 (재고)</th><th>직전 스냅샷 대비</th><th>가격</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">데이터 없음</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

// 리포트 맨 아래에 붙는 독립 섹션 — PW/BH 재고 전체 목록(SNS와 매칭 여부 무관하게 전체 현황).
// SNS 표 우측의 매출 매칭 컬럼(findStockMatch)과는 별개로, 이건 항상 존재해야 하는 기능임 —
// 지우면 안 됨(한 번 실수로 지웠다가 복구한 적 있음).
function renderStockSectionHtml(comparison) {
  if (!comparison) return '';

  const storeLabels = Object.keys(comparison.stores);
  const integratedRows = buildIntegratedStockRows(comparison);

  return `
  <section class="platform stock-section">
    <h2>📦 재고 스냅샷 (실험적)</h2>
    <div class="sub">
      최신 수집: ${escapeHtml(formatTakenAt(comparison.latestTakenAt))} (KST) · 초기 판매한도 가정
      역산 기준 총 판매 추정치 표시(스냅샷 주기와 무관하게 안정적인 값) · 누적 스냅샷
      ${comparison.snapshotCount}개
    </div>
    ${renderIntegratedTable(integratedRows)}
    ${storeLabels.map(label => renderStoreTable(label, comparison.stores[label])).join('')}
    <div class="foot">
      ※ 재고는 "현재 시점" 값만 조회 가능해서(과거 소급 불가) <code>naver-stock-snapshot.js</code>를
      실행할 때마다 쌓인 스냅샷끼리 비교한 것입니다.<br>
      ※ "N개 판매추정"은 현재 재고를 가장 가까운 1000단위로 올려 "초기 판매한도였을 것"으로
      가정하고 거기서 현재 재고를 뺀 값입니다(항상 이 방식 — 과거 스냅샷을 몇 개나 찍었는지와
      무관하게 동일하게 계산되므로 리포트를 언제 뽑든 안정적입니다). 예약판매 상품은 판매자가
      9999/10000 같은 임의 한도를 걸어두고 거기서 줄어든 만큼이 실제 예약 판매량인 경우가
      많고, 발매(입고) 이후엔 진짜 물리 재고 감소라 의미가 달라질 수 있음 — 어느 단계인지는
      상품명/가격 보고 직접 판단해주세요.<br>
      ※ <b>*</b> 표시는 위 방식대로 "초기 판매한도 추정치"를 역산한 값이라는 뜻입니다 — 실제
      한도가 아니라 현재 재고를 가장 가까운 1000단위로 올려서 가정한 값이므로 참고용으로만
      봐주세요.<br>
      ※ "재입고"는 재고가 늘어난 경우(추가 입고, 또는 판매자가 한도를 다시 올린 경우)입니다.<br>
      ※ "직전 스냅샷 대비" 컬럼은 "총 판매추정(재고)"와 달리 초기한도 추정이 아니라, 바로
      전 스냅샷 대비 재고가 실제로 얼마나 줄었는지(순수 실측값)입니다 — 스냅샷을 처음 찍은
      상품이거나 그 사이 수집이 실패했으면 "비교 불가"로 표시됩니다.<br>
      ※ 맨 위 <b>🔗 종합</b> 표는 PW/BH 상품명이 서로 비슷한 것끼리 자동으로 짝지어서(SNS
      상품 매칭과 같은 방식) 한 행에서 바로 비교하는 표입니다 — 짝지어지지 않은 상품은
      사라지지 않고 아래 PW/BH 개별 표에 그대로 남아있습니다. "점유율"은 두 스토어 판매추정치
      합산 기준이고, "직전/그 전 스냅샷 대비"는 최근 2단계 변화량만 보여줍니다(그 이전 변화는
      "▶ 보기"를 눌러 열리는 추이 그래프에서 전체 확인 가능, 스냅샷이 2개뿐이면 "그 전 스냅샷
      대비"는 아직 계산할 수 없어 빈 칸으로 남습니다).<br>
      ※ 이 목록은 SNS 비교표와 매칭 여부 상관없이 PW/BH 재고 전체를 보여줍니다 — 상품별 매출
      매칭은 위쪽 SNS 비교표 우측 끝(가로 스크롤)의 📦 매출 (PW vs BH) 컬럼을 참고하세요.
    </div>
  </section>`;
}

const STOCK_SECTION_STYLE = `
.stock-section{margin-top:8px}
.stock-store{margin-bottom:20px}
.stock-store h3{font-size:14px;margin:0 0 8px;color:#374151}
.sd-rank{font-size:15px;font-weight:700;width:38px;text-align:center}
.sd-name{text-align:left;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-sold{color:#2f9e44;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.sd-restock{color:#c0504d;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.sd-flat{color:#9099a6;text-align:right;font-variant-numeric:tabular-nums}
.sd-na{color:#9099a6;text-align:right}
.sd-price{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}
.stock-integrated{margin-bottom:28px}
.stock-integrated .section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.stock-integrated .section-head h3{margin:0}
tr.trend-row{display:none;background:#fafbfd}
tr.trend-row.open{display:table-row}
tr.trend-row td{padding:14px}
.trend-empty{font-size:12px;color:#9099a6}
.trend-legend{display:flex;gap:14px;font-size:12px;font-weight:700;margin-bottom:6px}
.trend-legend .pw{color:#1971c2}.trend-legend .bh{color:#c0504d}
.trend-sub{font-size:11px;color:#9099a6;margin-bottom:6px}
.trend-scroll{overflow-x:auto}
`;

module.exports = {
  buildStockComparison,
  formatTakenAt,
  rankMedal,
  rankStockProducts,
  findStockMatch,
  assignStockMatches,
  matchPwBhStockProducts,
  buildIntegratedStockRows,
  renderStockSectionHtml,
  STOCK_SECTION_STYLE,
};
