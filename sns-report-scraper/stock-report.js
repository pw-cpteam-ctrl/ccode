/**
 * naver-stock-snapshot.js가 쌓아둔 재고 히스토리를, 최신 스냅샷 vs 직전 스냅샷 비교로
 * 정리. 재고 감소분(stockDelta)은 그 사이 기간의 "추정 판매량"으로 해석(메가하우스는 예약
 * 단계에선 9999/10000 같은 임의 한도를 걸어두므로, 그 감소분이 실제 예약 판매량과 거의
 * 일치함 — naver-stock-snapshot.js 상단 주석 참고). 발매 후(입고 이후)엔 진짜 물리 재고라
 * 감소분 해석이 달라질 수 있어 raw 수치를 그대로 넘김(해석은 보는 사람 몫).
 *
 * 결과물은 두 군데에서 씀(html-report.js): (1) SNS 비교표 우측 끝에 붙는 매출 매칭 컬럼
 * (findStockMatch), (2) 리포트 맨 아래 독립 섹션으로 PW/BH 재고 전체 목록(renderStockSectionHtml)
 * — 후자는 SNS 상품과 매칭 안 되는(또는 SNS에 아예 안 올라온) 상품까지 포함한 전체 현황용.
 */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function renderStoreTable(label, products, hasComparison) {
  const ranked = rankStockProducts(products, hasComparison);

  const rows = ranked.map(p => {
    const deltaCell = hasComparison
      ? (p.stockDelta === null
        ? '<td class="sd-na">신규</td>'
        : p.stockDelta > 0
          ? `<td class="sd-sold">-${p.stockDelta.toLocaleString()} (판매 추정)</td>`
          : p.stockDelta < 0
            ? `<td class="sd-restock">+${Math.abs(p.stockDelta).toLocaleString()} (재입고/한도변경)</td>`
            : '<td class="sd-flat">변화 없음</td>')
      : '';
    return `<tr>
      ${hasComparison ? `<td class="sd-rank">${p.rank === null ? '-' : rankMedal(p.rank)}</td>` : ''}
      <td class="sd-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name || '(이름 없음)')}</td>
      <td class="sd-num">${p.stock.toLocaleString()}</td>
      ${hasComparison ? `<td class="sd-num sd-prev">${p.prevStock === null ? '-' : p.prevStock.toLocaleString()}</td>` : ''}
      ${deltaCell}
      <td class="sd-price">${p.price ? `${p.price.toLocaleString()}원` : '-'}</td>
    </tr>`;
  }).join('');

  const colCount = 3 + (hasComparison ? 3 : 0);

  return `
  <div class="stock-store">
    <h3>${escapeHtml(label)} (${products.length}개 상품)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          ${hasComparison ? '<th>매출순위</th>' : ''}
          <th>상품명</th><th>현재 재고</th>
          ${hasComparison ? '<th>이전 재고</th>' : ''}
          ${hasComparison ? '<th>변화(추정 판매량)</th>' : ''}
          <th>가격</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="${colCount}" class="empty">데이터 없음</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

// 리포트 맨 아래에 붙는 독립 섹션 — PW/BH 재고 전체 목록(SNS와 매칭 여부 무관하게 전체 현황).
// SNS 표 우측의 매출 매칭 컬럼(findStockMatch)과는 별개로, 이건 항상 존재해야 하는 기능임 —
// 지우면 안 됨(한 번 실수로 지웠다가 복구한 적 있음).
function renderStockSectionHtml(comparison) {
  if (!comparison) return '';

  const hasComparison = Boolean(comparison.previousTakenAt);
  const storeLabels = Object.keys(comparison.stores);

  return `
  <section class="platform stock-section">
    <h2>📦 재고 스냅샷 (실험적)</h2>
    <div class="sub">
      최신 수집: ${escapeHtml(formatTakenAt(comparison.latestTakenAt))} (KST)
      ${hasComparison ? ` · 직전 수집: ${escapeHtml(formatTakenAt(comparison.previousTakenAt))} 대비 변화량 표시` : ' · 스냅샷이 아직 1개뿐이라 변화량은 다음 수집부터 나옵니다'}
      · 누적 스냅샷 ${comparison.snapshotCount}개
    </div>
    ${storeLabels.map(label => renderStoreTable(label, comparison.stores[label], hasComparison)).join('')}
    <div class="foot">
      ※ 재고는 "현재 시점" 값만 조회 가능해서(과거 소급 불가) <code>naver-stock-snapshot.js</code>를
      실행할 때마다 쌓인 스냅샷끼리 비교한 것입니다.<br>
      ※ 예약판매 상품은 판매자가 9999/10000 같은 임의 한도를 걸어두고 거기서 줄어든 만큼이
      실제 예약 판매량인 경우가 많고, 발매(입고) 이후엔 진짜 물리 재고를 보여줍니다 — 어느
      단계인지는 상품명/가격 보고 직접 판단해주세요.<br>
      ※ "재입고/한도변경"은 재고가 늘어난 경우(추가 입고, 또는 판매자가 한도를 다시 올린 경우)입니다.<br>
      ※ 이 목록은 SNS 비교표와 매칭 여부 상관없이 PW/BH 재고 전체를 보여줍니다 — 상품별 매출
      매칭은 위쪽 SNS 비교표 우측 끝(가로 스크롤)의 📦PW/BH 매출 컬럼을 참고하세요.
    </div>
  </section>`;
}

const STOCK_SECTION_STYLE = `
.stock-section{margin-top:8px}
.stock-store{margin-bottom:20px}
.stock-store h3{font-size:14px;margin:0 0 8px;color:#374151}
.sd-rank{font-size:15px;font-weight:700;width:38px;text-align:center}
.sd-name{text-align:left;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-num{text-align:right;font-variant-numeric:tabular-nums}
.sd-prev{color:#9099a6}
.sd-sold{color:#2f9e44;font-weight:700;text-align:right}
.sd-restock{color:#c0504d;font-weight:700;text-align:right}
.sd-flat{color:#9099a6;text-align:right}
.sd-na{color:#9099a6;text-align:right}
.sd-price{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}
`;

module.exports = {
  buildStockComparison,
  formatTakenAt,
  rankMedal,
  rankStockProducts,
  findStockMatch,
  renderStockSectionHtml,
  STOCK_SECTION_STYLE,
};
