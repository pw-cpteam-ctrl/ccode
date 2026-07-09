/**
 * naver-stock-snapshot.js가 쌓아둔 재고 히스토리를 정리해서 상품별 "총 판매 추정치"를 계산.
 *
 * ⚠️ 처음엔 "직전 스냅샷 대비 변화량"(그 사이에만 몇 개 팔렸는지)을 기본으로 썼는데, 사용자
 * 피드백으로 방향을 바꿈: "언제 리포트를 내든 현시점 몇 개 팔렸는지(총 판매 추정)가 궁금한
 * 거고, 스냅샷 사이 변화 추이는 그 자체로 별도 관심사"라는 게 명확해짐. 그래서 이제 기본
 * 지표는 **totalSold**(이 상품을 처음 관측한 이후 총 추정 판매량, 스냅샷 주기와 무관하게
 * 안정적)로 삼고, stockDelta(직전 스냅샷 대비)는 참고용으로만 남겨둠.
 *
 * totalSold 계산: 이 상품을 과거 스냅샷(최신 제외) 중 가장 먼저 관측했을 때의 재고를 기준점
 * (firstStock)으로 삼아 `firstStock - 현재재고`. 한 번도 이전에 관측된 적 없는(이번이 정말
 * 처음 잡힌) 상품만, 메가하우스 예약판매 관행(9999/10000 같은 "깔끔한" 숫자로 판매 한도를
 * 걸어둠)을 이용해 현재 재고 위의 가장 가까운 1000단위를 "초기 한도"로 가정하고 역산
 * (estimateInitialCap) — 이 경우만 totalSoldIsEstimated=true로 표시해서 정확도 차이를 숨기지
 * 않음.
 *
 * 결과물은 두 군데에서 씀(html-report.js): (1) SNS 비교표 우측 끝에 붙는 매출 매칭 컬럼
 * (findStockMatch), (2) 리포트 맨 아래 독립 섹션으로 PW/BH 재고 전체 목록(renderStockSectionHtml)
 * — 후자는 SNS 상품과 매칭 안 되는(또는 SNS에 아예 안 올라온) 상품까지 포함한 전체 현황용.
 */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 실제 기준점(firstStock)이 없는 상품(이번이 정말 처음 관측된 경우)에만 쓰는 대체 추정 —
// 현재 재고를 가장 가까운 1000단위로 올려서 "초기 판매한도였을 것"으로 가정하고 역산.
function estimateInitialCap(stock) {
  if (typeof stock !== 'number') return null;
  return Math.max(1000, Math.ceil(stock / 1000) * 1000);
}

// 히스토리(naver-stock-snapshot.js가 저장한 { snapshots: [...] })를 받아서 store(PW/BH)별로
// 상품별 총 판매 추정치(totalSold)를 계산. 스냅샷이 1개뿐이면 firstStock 기준점이 없어서
// 전부 초기 한도 추정으로 대체.
//
// store별로 "비교 가능 여부(storeComparable)"를 따로 둠 — 직전 스냅샷이 전체적으로 존재해도,
// 그 시점에 특정 store만 수집 실패(0건)했을 수 있음(예: 로그인 게이트 걸려서 BH만 0건이었던
// 적이 있었음) — stockDelta(직전 대비, 참고용) 계산에만 영향, totalSold는 "최신 제외 과거
// 스냅샷 전체"에서 최초 관측치를 찾으므로 직전 스냅샷 하나가 비어도 그 전 스냅샷에 데이터가
// 있으면 영향 없음.
function buildStockComparison(history) {
  const snapshots = history?.snapshots || [];
  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const priorSnapshots = snapshots.slice(0, -1); // 최신 제외 — "이전에 관측된 적 있는지" 판단용
  const storeLabels = Object.keys(latest.stores || {});

  const stores = {};
  const storeComparable = {};
  for (const label of storeLabels) {
    const latestRecords = latest.stores[label] || [];
    const prevRecords = previous ? (previous.stores[label] || []) : [];
    storeComparable[label] = prevRecords.length > 0;
    const prevByProductId = new Map(prevRecords.map(r => [r.productId, r]));

    // 오래된 스냅샷부터 훑어서 productId별 "최초 관측 재고"를 기록(먼저 찾은 값을 유지).
    const firstSeen = new Map();
    for (const snap of priorSnapshots) {
      for (const r of (snap.stores[label] || [])) {
        if (typeof r.stock === 'number' && !firstSeen.has(r.productId)) firstSeen.set(r.productId, r.stock);
      }
    }

    const products = latestRecords.map(r => {
      const prev = prevByProductId.get(r.productId);
      const stockDelta = prev && typeof prev.stock === 'number' && typeof r.stock === 'number'
        ? prev.stock - r.stock // 양수 = 직전 스냅샷 대비 줄어든 수량(참고용, 화면 기본 지표 아님)
        : null;

      const hasRealBaseline = typeof firstSeen.get(r.productId) === 'number';
      const firstStock = hasRealBaseline ? firstSeen.get(r.productId) : null;
      const estimatedCap = hasRealBaseline ? null : estimateInitialCap(r.stock);
      const totalSold = typeof r.stock !== 'number' ? null
        : hasRealBaseline ? firstStock - r.stock
          : estimatedCap - r.stock;

      return {
        productId: r.productId, name: r.name, price: r.price, stock: r.stock,
        prevStock: prev ? prev.stock : null, stockDelta,
        firstStock, estimatedCap, totalSold, totalSoldIsEstimated: !hasRealBaseline,
      };
    });

    stores[label] = products;
  }

  return { latestTakenAt: latest.takenAt, previousTakenAt: previous ? previous.takenAt : null, snapshotCount: snapshots.length, stores, storeComparable };
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
  return candidates.reduce((best, cur) => (Math.abs(cur.totalSold ?? 0) > Math.abs(best.totalSold ?? 0) ? cur : best));
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

function renderStoreTable(label, products) {
  const ranked = rankStockProducts(products);

  const rows = ranked.map(p => {
    const cls = p.totalSold > 0 ? 'sd-sold' : p.totalSold < 0 ? 'sd-restock' : p.totalSold === 0 ? 'sd-flat' : 'sd-na';
    return `<tr>
      <td class="sd-rank">${p.rank === null ? '-' : rankMedal(p.rank)}</td>
      <td class="sd-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name || '(이름 없음)')}</td>
      <td class="${cls}">${soldWithStockText(p)}</td>
      <td class="sd-price">${p.price ? `${p.price.toLocaleString()}원` : '-'}</td>
    </tr>`;
  }).join('');

  return `
  <div class="stock-store">
    <h3>${escapeHtml(label)} (${products.length}개 상품)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>매출순위</th><th>상품명</th><th>총 판매추정 (재고)</th><th>가격</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="empty">데이터 없음</td></tr>'}</tbody>
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

  return `
  <section class="platform stock-section">
    <h2>📦 재고 스냅샷 (실험적)</h2>
    <div class="sub">
      최신 수집: ${escapeHtml(formatTakenAt(comparison.latestTakenAt))} (KST) · 이 상품을 처음
      관측한 시점 대비 총 판매 추정치 표시(스냅샷 주기와 무관하게 안정적인 값) · 누적 스냅샷
      ${comparison.snapshotCount}개
    </div>
    ${storeLabels.map(label => renderStoreTable(label, comparison.stores[label])).join('')}
    <div class="foot">
      ※ 재고는 "현재 시점" 값만 조회 가능해서(과거 소급 불가) <code>naver-stock-snapshot.js</code>를
      실행할 때마다 쌓인 스냅샷끼리 비교한 것입니다.<br>
      ※ "N개 판매추정"은 이 상품을 맨 처음 관측했을 때의 재고에서 현재 재고를 뺀 값 — 리포트를
      언제 뽑든 그 시점까지의 총 추정 판매량으로 안정적으로 나옵니다(스냅샷을 몇 번 찍었는지와
      무관). 예약판매 상품은 판매자가 9999/10000 같은 임의 한도를 걸어두고 거기서 줄어든 만큼이
      실제 예약 판매량인 경우가 많고, 발매(입고) 이후엔 진짜 물리 재고 감소라 의미가 달라질 수
      있음 — 어느 단계인지는 상품명/가격 보고 직접 판단해주세요.<br>
      ※ <b>*</b> 표시는 이 상품을 이번에 처음 관측해서(비교할 과거 데이터가 없어서) 현재 재고를
      가장 가까운 1000단위로 올려 "초기 판매한도였을 것"이라 가정하고 역산한 값입니다 — 실제
      관측 기반 값보다 정확도가 떨어지니 참고용으로만 봐주세요(다음 스냅샷부터는 진짜 값으로
      바뀜).<br>
      ※ "재입고"는 재고가 늘어난 경우(추가 입고, 또는 판매자가 한도를 다시 올린 경우)입니다.<br>
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
.sd-sold{color:#2f9e44;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.sd-restock{color:#c0504d;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.sd-flat{color:#9099a6;text-align:right;font-variant-numeric:tabular-nums}
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
