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
// totalSold는 실제 과거 기록 유무와 무관하게 항상 이 방식으로 계산(위 파일 헤더 설명 참고).
function estimateInitialCap(stock) {
  if (typeof stock !== 'number') return null;
  return Math.max(1000, Math.ceil(stock / 1000) * 1000);
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
      const stockDelta = prev && typeof prev.stock === 'number' && typeof r.stock === 'number'
        ? prev.stock - r.stock // 양수 = 직전 스냅샷 대비 줄어든 수량(참고용, 화면 기본 지표 아님)
        : null;

      const estimatedCap = estimateInitialCap(r.stock);
      const totalSold = typeof r.stock !== 'number' ? null : estimatedCap - r.stock;

      return {
        productId: r.productId, name: r.name, price: r.price, stock: r.stock,
        prevStock: prev ? prev.stock : null, stockDelta,
        estimatedCap, totalSold, totalSoldIsEstimated: true,
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
function matchPwBhStockProducts(pwProducts, bhProducts) {
  const MIN_SHARED_KEYWORDS = 2;
  const entries = [
    ...pwProducts.map(p => ({ side: 'pw', product: p, keywords: extractKeywords(p.name), line: detectProductLine(p.name) })),
    ...bhProducts.map(p => ({ side: 'bh', product: p, keywords: extractKeywords(p.name), line: detectProductLine(p.name) })),
  ];
  const parent = entries.map((_, i) => i);
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  function union(i, j) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].keywords.length === 0) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].keywords.length === 0) continue;
      if (entries[i].line !== entries[j].line) continue;
      const overlap = entries[i].keywords.filter(k => entries[j].keywords.includes(k));
      if (overlap.length >= MIN_SHARED_KEYWORDS) union(i, j);
    }
  }

  const groups = new Map();
  entries.forEach((e, i) => {
    if (e.keywords.length === 0) return;
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  });

  const pairs = [];
  for (const group of groups.values()) {
    const pwSide = group.filter(e => e.side === 'pw');
    const bhSide = group.filter(e => e.side === 'bh');
    if (pwSide.length === 1 && bhSide.length === 1) {
      pairs.push({ pw: pwSide[0].product, bh: bhSide[0].product });
    }
  }
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

  return pairs.map(({ pw, bh }) => {
    const pwSeries = stockSeries(snapshots, 'PW', pw.productId);
    const bhSeries = stockSeries(snapshots, 'BH', bh.productId);
    return {
      pw, bh,
      pwDelta2: deltaAt(pwSeries, 2),
      bhDelta2: deltaAt(bhSeries, 2),
      pwSeries, bhSeries,
    };
  });
}

// "513개 (점유율 54%)"처럼 총 판매추정치와 양사 합산 기준 점유율을 한 칸에 표시.
function totalSoldWithShareText(mine, other) {
  if (!mine || typeof mine.totalSold !== 'number') return '-';
  const mark = mine.totalSoldIsEstimated ? '*' : '';
  const countText = mine.totalSold > 0 ? `${mine.totalSold.toLocaleString()}개`
    : mine.totalSold < 0 ? `재입고+${Math.abs(mine.totalSold).toLocaleString()}개`
      : '0개';
  const a = Math.max(mine.totalSold, 0);
  const b = Math.max(other && typeof other.totalSold === 'number' ? other.totalSold : 0, 0);
  const sum = a + b;
  const sharePct = sum > 0 ? Math.round((a / sum) * 100) : null;
  return sharePct !== null ? `${countText}${mark} (점유율 ${sharePct}%)` : `${countText}${mark}`;
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

// 매칭된 상품 하나의 PW/BH 재고 추이 — 꺾은선 2개(PW 파랑/BH 빨강), 같은 재고 수량 축을
// 공유(단위가 같은 값 2개를 겹쳐 보는 거라 이중축 문제가 아님). 토글을 열 때만 계산해서
// 보여주면 되므로 매번 새로 그림 — 시점이 1~2개뿐이면 사실상 점 1~2개라 "추이"라 부르기
// 애매해서(표와 다를 게 없음) 그래프 대신 안내 문구로 대체, 3개부터 그래프로 그림.
function stockTrendChart(pwSeries, bhSeries, pwName, bhName) {
  const allDates = [...new Set([...pwSeries, ...bhSeries].map(p => p.takenAt))].sort();
  if (allDates.length < 3) {
    return `<div class="trend-empty">스냅샷이 더 쌓이면 추이 그래프가 여기 표시됩니다(현재 ${allDates.length}개 시점).</div>`;
  }

  const w = Math.max(520, allDates.length * 90);
  const h = 220;
  const ml = 60, mr = 20, mt = 16, mb = 40;
  const chartW = w - ml - mr, chartH = h - mt - mb;
  const maxStock = Math.max(1, ...pwSeries.map(p => p.stock), ...bhSeries.map(p => p.stock)) * 1.1;

  const x = i => ml + (allDates.length > 1 ? (i / (allDates.length - 1)) * chartW : chartW / 2);
  const y = v => mt + chartH - (v / maxStock) * chartH;

  function linePath(series) {
    const points = allDates
      .map((d, i) => { const rec = series.find(p => p.takenAt === d); return rec ? { i, v: rec.stock } : null; })
      .filter(Boolean);
    return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ');
  }
  function dots(series, color) {
    return allDates.map((d, i) => {
      const rec = series.find(p => p.takenAt === d);
      if (!rec) return '';
      return `<circle cx="${x(i)}" cy="${y(rec.stock)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"><title>${escapeHtml(formatTakenAt(d))} · ${rec.stock.toLocaleString()}개</title></circle>`;
    }).join('');
  }

  const gridLines = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxStock / ticks) * i;
    const yy = mt + chartH - (v / maxStock) * chartH;
    gridLines.push(`<line x1="${ml}" y1="${yy}" x2="${w - mr}" y2="${yy}" stroke="#e9ecef" stroke-width="1"/>`);
    gridLines.push(`<text x="${ml - 8}" y="${yy + 3}" font-size="10" fill="#6b7280" text-anchor="end">${Math.round(v).toLocaleString()}</text>`);
  }
  const xLabels = allDates.map((d, i) => `<text x="${x(i)}" y="${h - 10}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(formatTakenAt(d).slice(5, 10))}</text>`).join('');

  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${gridLines.join('')}
    <path d="${linePath(pwSeries)}" fill="none" stroke="#1971c2" stroke-width="2"/>
    <path d="${linePath(bhSeries)}" fill="none" stroke="#c0504d" stroke-width="2"/>
    ${dots(pwSeries, '#1971c2')}${dots(bhSeries, '#c0504d')}${xLabels}
  </svg>`;

  return `<div class="trend-wrap">
    <div class="trend-legend"><span class="pw">● PW ${escapeHtml(pwName)}</span><span class="bh">● BH ${escapeHtml(bhName)}</span></div>
    <div class="trend-scroll">${svg}</div>
  </div>`;
}

function renderIntegratedRow(row, index) {
  const rowId = `stock-trend-${index}`;
  const pwText = totalSoldWithShareText(row.pw, row.bh);
  const bhText = totalSoldWithShareText(row.bh, row.pw);
  const delta1Text = deltaPairText(row.pw.stockDelta, row.bh.stockDelta);
  const delta2Text = deltaPairText(row.pwDelta2, row.bhDelta2);
  const chart = stockTrendChart(row.pwSeries, row.bhSeries, row.pw.name, row.bh.name);
  return `<tr>
      <td class="sd-name" title="${escapeHtml(row.pw.name)}">${escapeHtml(row.pw.name)}</td>
      <td class="sd-sold">${escapeHtml(pwText)}</td>
      <td class="sd-sold">${escapeHtml(bhText)}</td>
      <td>${escapeHtml(delta1Text)}</td>
      <td>${escapeHtml(delta2Text)}</td>
      <td><button class="toggle-btn" onclick="toggleStockTrend('${rowId}', this)">▶ 보기</button></td>
    </tr>
    <tr class="trend-row" id="${rowId}"><td colspan="6">${chart}</td></tr>`;
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
          <th>상품명</th><th>PW 총판매추정</th><th>BH 총판매추정</th><th>직전 스냅샷 대비</th><th>그 전 스냅샷 대비</th><th>추이</th>
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
.trend-scroll{overflow-x:auto}
`;

module.exports = {
  buildStockComparison,
  formatTakenAt,
  rankMedal,
  rankStockProducts,
  findStockMatch,
  matchPwBhStockProducts,
  buildIntegratedStockRows,
  renderStockSectionHtml,
  STOCK_SECTION_STYLE,
};
