/**
 * naver-stock-snapshot.js가 쌓아둔 재고 히스토리를, 최신 스냅샷 vs 직전 스냅샷 비교로
 * 정리. 재고 감소분(stockDelta)은 그 사이 기간의 "추정 판매량"으로 해석(메가하우스는 예약
 * 단계에선 9999/10000 같은 임의 한도를 걸어두므로, 그 감소분이 실제 예약 판매량과 거의
 * 일치함 — naver-stock-snapshot.js 상단 주석 참고). 발매 후(입고 이후)엔 진짜 물리 재고라
 * 감소분 해석이 달라질 수 있어 raw 수치를 그대로 넘김(해석은 보는 사람 몫).
 *
 * 결과물은 별도 섹션이 아니라 SNS 비교표 우측에 붙는 컬럼으로 씀(html-report.js) — 위아래로
 * 왔다갔다하며 대조하지 않고 한 표 안에서(가로 스크롤로) 바로 보이게 하는 게 목적.
 */

// 히스토리(naver-stock-snapshot.js가 저장한 { snapshots: [...] })를 받아서, 최신 스냅샷과
// 직전 스냅샷을 store(PW/BH)별로 비교한 구조로 정리. 스냅샷이 1개뿐이면 비교 없이 현재값만.
function buildStockComparison(history) {
  const snapshots = history?.snapshots || [];
  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const storeLabels = Object.keys(latest.stores || {});

  const stores = {};
  for (const label of storeLabels) {
    const latestRecords = latest.stores[label] || [];
    const prevRecords = previous ? (previous.stores[label] || []) : [];
    const prevByProductId = new Map(prevRecords.map(r => [r.productId, r]));

    const products = latestRecords.map(r => {
      const prev = prevByProductId.get(r.productId);
      const stockDelta = prev && typeof prev.stock === 'number' && typeof r.stock === 'number'
        ? prev.stock - r.stock // 양수 = 그 사이 줄어든 수량(≈판매량), 음수 = 재입고/한도 재설정
        : null;
      return { productId: r.productId, name: r.name, price: r.price, stock: r.stock, prevStock: prev ? prev.stock : null, stockDelta };
    });

    stores[label] = products;
  }

  return { latestTakenAt: latest.takenAt, previousTakenAt: previous ? previous.takenAt : null, snapshotCount: snapshots.length, stores };
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

// 판매 추정치(재고 감소량) 기준으로 정렬 + 순위 부여. 비교 불가한(직전 스냅샷에 없던) 신규
// 상품은 판매 추정치 자체가 없어서 순위(rank: null)를 매기지 않음 — 근거 없는 숫자를 안 만듦.
function rankStockProducts(products, hasComparison) {
  const sorted = [...products].sort((a, b) => {
    if (hasComparison) return (b.stockDelta ?? -Infinity) - (a.stockDelta ?? -Infinity);
    return (b.stock ?? 0) - (a.stock ?? 0);
  });
  let rankCounter = 0;
  return sorted.map(p => ({ ...p, rank: hasComparison && p.stockDelta !== null ? ++rankCounter : null }));
}

function tokenize(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

// SNS 상품(ip/line)과 네이버 재고 상품(name)은 서로 다른 데이터라 정확한 ID 매칭이 안 되므로,
// ip를 단어 단위로 쪼개서 그 단어들이 전부 상품명에 들어있는지로 근사 매칭(있으면 line도 포함
// 되는지 추가 확인) — ip가 "은혼 카무이"처럼 여러 단어일 때 "은혼 GEM 카무이"처럼 중간에 다른
// 말이 끼어도 매칭되게 하려면 통짜 substring 비교로는 안 되고 단어 단위 AND 매칭이 필요함.
// 후보가 여럿이면 재고 변화폭이 가장 큰(=가장 눈에 띄는) 것을 대표로 — "대략 가늠"이 목적이라
// 과한 정밀도는 필요 없음.
function findStockMatch(ip, line, rankedProducts) {
  if (!ip || !rankedProducts || rankedProducts.length === 0) return null;
  const ipTokens = tokenize(ip);
  if (ipTokens.length === 0) return null;
  let candidates = rankedProducts.filter(r => r.name && ipTokens.every(t => r.name.includes(t)));
  if (candidates.length === 0) return null;
  if (line && line !== '-') {
    const refined = candidates.filter(r => r.name.includes(line));
    if (refined.length > 0) candidates = refined;
  }
  return candidates.reduce((best, cur) => (Math.abs(cur.stockDelta ?? 0) > Math.abs(best.stockDelta ?? 0) ? cur : best));
}

module.exports = { buildStockComparison, formatTakenAt, rankMedal, rankStockProducts, findStockMatch };
