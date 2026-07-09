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
const { getProductStock, getProductStockAllPages } = require('./naver-stock');

const HISTORY_PATH = path.join(__dirname, 'reports', '_stock-history.json');

// 스토어 메인 페이지는 지난 달 이전 상품까지 다 끌려와서, 이번 달(7월) 상품만 모아둔 카테고리
// 페이지 URL로 교체 — PW/BH 둘 다 네이버에 월별 카테고리를 따로 만들어두는 방식이라 이걸 쓰면
// "이번 달 판매데이터"만 정확히 잡힘. 다음 달부터는 그 달 카테고리 URL로 매번 갱신해줘야 함.
const STORES = [
  { label: 'PW', url: 'https://brand.naver.com/megahouse/category/a1b6775bba66406296df046187baf675?st=POPULAR&dt=IMAGE&page=1&size=80' },
  // BH는 원래 카테고리 URL(smartstore.naver.com/.../category/...)로 직접 들어가면 로그인
  // 게이트에 걸림(warmupUrl+referer로도 못 뚫음). m.site.naver.com 단축링크는 게이트 없이
  // 통과되는데 40개짜리 고정 목록이고(스크롤 안 됨, 무한스크롤 아님), 대신 번호 페이지네이션
  // (1,2,3...)이 있는 걸로 확인됨 — mobile:true(기기 에뮬레이션)는 오히려 접속을 막아버려서
  // 원상복구. 2페이지 URL 패턴 확인 후 정확한 방식으로 다시 고칠 예정.
  { label: 'BH', url: 'https://m.site.naver.com/1X24n', paginate: true },
];

async function captureSnapshot() {
  const activeStores = STORES.filter(s => s.url);
  const skipped = STORES.filter(s => !s.url);
  skipped.forEach(s => console.warn(`⚠️ ${s.label} URL이 비어있어서 건너뜀 — naver-stock-snapshot.js의 STORES에 채워넣어야 함`));

  const takenAt = new Date().toISOString();
  const snapshot = { takenAt, stores: {} };

  for (const store of activeStores) {
    console.log(`📸 ${store.label} (${store.url}) 재고 수집 중...`);
    const fetchFn = store.paginate ? getProductStockAllPages : getProductStock;
    const records = await fetchFn(store.url, { warmupUrl: store.warmupUrl, mobile: store.mobile });
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
