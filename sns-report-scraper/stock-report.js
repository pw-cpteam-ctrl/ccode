/**
 * naver-stock-snapshot.js가 쌓아둔 재고 히스토리를, 최신 스냅샷 vs 직전 스냅샷 비교로
 * 정리하고 HTML 섹션으로 렌더링. 재고 감소분(stockDelta)은 그 사이 기간의 "추정 판매량"으로
 * 해석(메가하우스는 예약 단계에선 9999/10000 같은 임의 한도를 걸어두므로, 그 감소분이 실제
 * 예약 판매량과 거의 일치함 — naver-stock-snapshot.js 상단 주석 참고). 발매 후(입고 이후)엔
 * 진짜 물리 재고라 감소분 해석이 달라질 수 있어 사람이 눈으로 판단하도록 raw 수치를 그대로 보여줌.
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

function renderStoreTable(label, products, hasComparison) {
  const sorted = [...products].sort((a, b) => {
    if (hasComparison) return (b.stockDelta ?? -Infinity) - (a.stockDelta ?? -Infinity);
    return (b.stock ?? 0) - (a.stock ?? 0);
  });

  const rows = sorted.map(p => {
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
      <td class="sd-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name || '(이름 없음)')}</td>
      <td class="sd-num">${p.stock.toLocaleString()}</td>
      ${hasComparison ? `<td class="sd-num sd-prev">${p.prevStock === null ? '-' : p.prevStock.toLocaleString()}</td>` : ''}
      ${deltaCell}
      <td class="sd-price">${p.price ? `${p.price.toLocaleString()}원` : '-'}</td>
    </tr>`;
  }).join('');

  return `
  <div class="stock-store">
    <h3>${escapeHtml(label)} (${products.length}개 상품)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>상품명</th><th>현재 재고</th>
          ${hasComparison ? '<th>이전 재고</th>' : ''}
          ${hasComparison ? '<th>변화(추정 판매량)</th>' : ''}
          <th>가격</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">데이터 없음</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

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
      ※ "재입고/한도변경"은 재고가 늘어난 경우(추가 입고, 또는 판매자가 한도를 다시 올린 경우)입니다.
    </div>
  </section>`;
}

const STOCK_SECTION_STYLE = `
.stock-section{margin-top:8px}
.stock-store{margin-bottom:20px}
.stock-store h3{font-size:14px;margin:0 0 8px;color:#374151}
.sd-name{text-align:left;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-num{text-align:right;font-variant-numeric:tabular-nums}
.sd-prev{color:#9099a6}
.sd-sold{color:#2f9e44;font-weight:700;text-align:right}
.sd-restock{color:#c0504d;font-weight:700;text-align:right}
.sd-flat{color:#9099a6;text-align:right}
.sd-na{color:#9099a6;text-align:right}
.sd-price{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}
`;

module.exports = { buildStockComparison, renderStockSectionHtml, STOCK_SECTION_STYLE };
