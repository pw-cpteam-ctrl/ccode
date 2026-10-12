/**
 * naver-stock.js로 지금 이 순간의 재고를 긁어서 히스토리 파일에 스냅샷 한 건 추가.
 * 재고는 "현재 시점"만 조회 가능하고 과거 소급이 안 되므로, 이 스크립트를 원할 때마다
 * (스케줄 자동화 아님, PLAN.md 방침과 동일하게 사용자가 직접) 실행해서 스냅샷을 쌓아두고,
 * 쌓인 스냅샷끼리 비교해서 재고 변화(≈ 예약판매 수량)를 추정하는 용도.
 *
 * 메가하우스 특성상(피규어 브랜드, 예약→발매까지 6개월~1년) 재고 숫자의 의미가 상품마다 다름:
 *   - 예약 단계: 판매자가 9999/10000 같은 임의의 판매 한도를 걸어두고, 거기서 줄어든 만큼이
 *     실제 예약 판매량
 *   - 발매(입고) 이후: 진짜 물리 재고 수량을 그대로 보여줌
 * 이 스크립트는 raw 재고 스냅샷만 쌓고, 해석(어느 쪽 단계인지 판단)은 리포트 쪽에서 함.
 *
 * 어느 스토어를 볼지, 스냅샷을 어디에 쌓을지는 브랜드 설정(brands/<브랜드>.json)에서 가져옴 —
 * 브랜드가 여러 개(메가하우스/굿스마일)라서 한 파일에 같이 쌓으면 PW/BH 라벨이 뒤섞여
 * 판매추정 숫자가 틀어지므로, 브랜드별로 히스토리 파일을 따로 둠(brand-config.js 참고).
 *
 * 사용법: node naver-stock-snapshot.js                  — 메가하우스(기본)
 *        node naver-stock-snapshot.js brand=goodsmile  — 굿스마일
 */
const fs = require('fs');
const path = require('path');
const { getProductStock, getProductStockAllPages, extractNotifyCount } = require('./naver-stock');
const { prepareBrand, parseBrandArg } = require('./brand-config');
const { appendFollowerSnapshot } = require('./follower-history');

/**
 * 브랜드 설정의 스토어 목록을 실제 수집에 쓰는 형태로 변환.
 * JSON 파일엔 함수를 넣을 수 없어서 페이지 주소를 `{page}` 자리표시자가 들어간 문자열
 * (pageUrlTemplate)로 적어두고, 여기서 함수로 바꿔줌.
 */
function resolveStores(brand) {
  return brand.stockStores.map(s => ({
    ...s,
    pageUrl: s.pageUrlTemplate ? n => s.pageUrlTemplate.replace('{page}', n) : undefined,
  }));
}

/**
 * 지금 시점 재고를 긁어서 브랜드 히스토리 파일에 스냅샷 한 건 추가.
 * @param {object|string} [brandOrKey] 브랜드 객체(brand-config.loadBrand 결과) 또는 브랜드 키
 */
async function captureSnapshot(brandOrKey) {
  const brand = typeof brandOrKey === 'object' && brandOrKey ? brandOrKey : prepareBrand(brandOrKey);
  const stores = resolveStores(brand);
  if (stores.length === 0) {
    console.warn(`⚠️ [${brand.label}] 브랜드는 재고를 볼 스토어가 설정돼 있지 않아서 재고 스냅샷을 건너뜀 — 붙이려면 brands/${brand.key}.json의 stockStores에 스토어 주소를 넣으면 됩니다.`);
    return null;
  }

  const historyPath = brand.paths.stockHistory;
  const takenAt = new Date().toISOString();
  const snapshot = { takenAt, stores: {} };

  // 관심고객수(브랜드스토어는 '알림받기' 수)는 스토어 머리말에 있어서, 재고를 보려고
  // 어차피 여는 그 페이지에서 같이 읽으면 된다 — 페이지를 한 번 더 열지 않는다.
  // 못 읽은 스토어는 0이 아니라 null로 남긴다. 0으로 채우면 "관심고객이 0명으로 줄었다"는
  // 거짓 추이가 쌓이는데, 그건 숫자를 못 읽는 것보다 훨씬 나쁘다.
  snapshot.notify = {};

  for (const store of stores) {
    console.log(`📸 [${brand.label}] ${store.label} (${store.url}) 재고 수집 중...`);
    const fetchFn = store.paginate ? getProductStockAllPages : getProductStock;
    let notify = { count: null, label: null, from: 'none' };
    const records = await fetchFn(store.url, {
      warmupUrl: store.warmupUrl,
      mobile: store.mobile,
      pageUrl: store.pageUrl,
      onHtml: html => { notify = extractNotifyCount(html); },
    });
    snapshot.stores[store.label] = records;
    snapshot.notify[store.label] = notify;
    console.log(`  → ${records.length}건 수집 · ${notify.label || '관심고객수'} ${notify.count === null ? '못 읽음' : notify.count.toLocaleString('ko-KR')}`);
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  const history = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
    : { snapshots: [] };
  history.snapshots.push(snapshot);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  console.log(`✅ 스냅샷 저장 완료: ${historyPath} (누적 ${history.snapshots.length}개)`);

  // 관심고객수는 재고가 아니라 '그 시점에 몇 명인가'라서, 팔로워와 같은 기록에도 같이 쌓는다.
  // 예전엔 전체 수집(run-megahouse)을 돌 때만 쌓여서, 재고만 따로 찍으면 리포트 맨 위
  // 추이 블록의 관심고객수가 옛날 값에 멈춰 있었다. 재고를 찍었다는 건 스토어를 열어
  // 그 순간의 관심고객수를 실제로 읽었다는 뜻이므로, 그때마다 같이 남기는 게 맞다.
  const notifyAccounts = Object.entries(snapshot.notify || {})
    .map(([side, n]) => ({
      platform: 'naver',
      account: side === 'PW' ? '자사 스토어' : '경쟁사 스토어',
      side,
      followers: n?.count ?? null,
      from: n?.from ?? 'none',
      approx: false,            // 페이지에 적힌 숫자를 그대로 읽은 값이라 줄임 표기가 아니다
      label: n?.label ?? null,  // '관심고객수'인지 '알림받기'인지 — 스토어 종류마다 다르다
    }));
  const rows = appendFollowerSnapshot(brand.paths.followerHistory, notifyAccounts);
  if (rows !== null) {
    const shown = notifyAccounts
      .map(a => `${a.side} ${a.followers === null ? '못 읽음' : a.followers.toLocaleString('ko-KR')}`).join(' · ');
    console.log(`👥 관심고객수도 추이 기록에 저장: ${brand.paths.followerHistory} (누적 ${rows}개) — ${shown}`);
  }

  return snapshot;
}

if (require.main === module) {
  const { brandKey } = parseBrandArg(process.argv.slice(2));
  captureSnapshot(brandKey).catch(err => {
    console.error('❌ 실패:', err.message);
    process.exit(1);
  });
}

module.exports = { captureSnapshot, resolveStores };
