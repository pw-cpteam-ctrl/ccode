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
 * 사용법: node naver-stock-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const { getProductStock } = require('./naver-stock');

const HISTORY_PATH = path.join(__dirname, 'reports', '_stock-history.json');

// TODO: BH 스토어 공개 URL 확정되면 채워넣기 (brand.naver.com 또는 smartstore.naver.com 링크)
const STORES = [
  { label: 'PW', url: 'https://brand.naver.com/megahouse' },
  { label: 'BH', url: '' },
];

async function captureSnapshot() {
  const activeStores = STORES.filter(s => s.url);
  const skipped = STORES.filter(s => !s.url);
  skipped.forEach(s => console.warn(`⚠️ ${s.label} URL이 비어있어서 건너뜀 — naver-stock-snapshot.js의 STORES에 채워넣어야 함`));

  const takenAt = new Date().toISOString();
  const snapshot = { takenAt, stores: {} };

  for (const store of activeStores) {
    console.log(`📸 ${store.label} (${store.url}) 재고 수집 중...`);
    const records = await getProductStock(store.url);
    snapshot.stores[store.label] = records;
    console.log(`  → ${records.length}건 수집`);
  }

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
    : { snapshots: [] };
  history.snapshots.push(snapshot);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  console.log(`✅ 스냅샷 저장 완료: ${HISTORY_PATH} (누적 ${history.snapshots.length}개)`);
  return snapshot;
}

if (require.main === module) {
  captureSnapshot().catch(err => {
    console.error('❌ 실패:', err.message);
    process.exit(1);
  });
}

module.exports = { captureSnapshot, HISTORY_PATH, STORES };
