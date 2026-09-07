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
const { getProductStock, getProductStockAllPages } = require('./naver-stock');
const { prepareBrand, parseBrandArg } = require('./brand-config');

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

  for (const store of stores) {
    console.log(`📸 [${brand.label}] ${store.label} (${store.url}) 재고 수집 중...`);
    const fetchFn = store.paginate ? getProductStockAllPages : getProductStock;
    const records = await fetchFn(store.url, { warmupUrl: store.warmupUrl, mobile: store.mobile, pageUrl: store.pageUrl });
    snapshot.stores[store.label] = records;
    console.log(`  → ${records.length}건 수집`);
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  const history = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
    : { snapshots: [] };
  history.snapshots.push(snapshot);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  console.log(`✅ 스냅샷 저장 완료: ${historyPath} (누적 ${history.snapshots.length}개)`);
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
