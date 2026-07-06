/**
 * 브라우저/로그인 세션 없이 aggregate.js + excel.js 내부 로직만 검증하는 스크립트.
 * twitter.js/instagram.js가 실제로 반환할 형태를 흉내낸 모킹 데이터를 사용한다.
 * (twitter.js, instagram.js 자체는 실제 세션 없이는 검증 불가 — README/PLAN 참고)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCount, buildComparisonReport, extractOwnProductName, extractCompetitorProductName } = require('./aggregate');
const { saveReportToExcel } = require('./excel');

function check(label, fn) {
  try {
    fn();
    console.log(`✅ ${label}`);
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ── 1. parseCount 단위 검증 ──
check('parseCount: 콤마/만/천/K/M/실패 케이스', () => {
  assert.strictEqual(parseCount('3,412'), 3412);
  assert.strictEqual(parseCount('1.2만'), 12000);
  assert.strictEqual(parseCount('3천'), 3000);
  assert.strictEqual(parseCount('1.2K'), 1200);
  assert.strictEqual(parseCount('3.4M'), 3400000);
  assert.strictEqual(parseCount('0'), 0);
  assert.strictEqual(parseCount(null), null);
  assert.strictEqual(parseCount(''), null);
  assert.strictEqual(parseCount('알 수 없음'), null); // 좌표 파싱 실패 등으로 이상값이 들어와도 죽지 않고 null
});

// ── 2. 모킹 데이터: twitter.js / instagram.js가 실제로 뱉을 형태 흉내 ──
// 상품별 비교(본문 템플릿 기반 상품명 추출) 검증용. 당사는 "첫 줄 = 상품명", 경쟁사는
// "바로가기/링크 줄 바로 위 줄(✔️ 표시) = 상품명" 템플릿을 따른다고 가정.
// 실제 계정 테스트에서 "26년 7월" 같은 날짜 표현이 키워드로 잡혀서, 날짜 하나로 서로 다른
// 상품의 게시물이 전부 사슬처럼 엮여버리는 버그가 있었음(회귀 방지용으로 날짜 포함시켜 테스트).
const ownTwitterPosts = [
  { link: 'https://x.com/own/status/1', datetime: '2026-07-01T02:00:00.000Z', likes: '1.2만', retweets: '3,400', text: '26년 7월 은혼 GEM 카무이 ver.2\n\n예약판매 중\nhttps://m.site.naver.com/xyz' },
  { link: 'https://x.com/own/status/2', datetime: '2026-07-01T05:00:00.000Z', likes: '5,000', retweets: '900', text: '정기 휴무 안내입니다 (특정 상품 아님)' },
  { link: 'https://x.com/own/status/3', datetime: '2026-07-01T06:00:00.000Z', likes: '2,000', retweets: '500', text: '26년 8월 진격의 거인 GEM 엘런\n\n예약판매 중\nhttps://m.site.naver.com/abc2' },
];
const compTwitterPosts = [
  { link: 'https://x.com/comp/status/1', datetime: '2026-07-01T03:00:00.000Z', likes: '8,000', retweets: '1,000', text: '✔️은혼 카무이 ver.2 세컨드\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/xyz' },
  { link: 'https://x.com/comp/status/2', datetime: '2026-07-01T07:00:00.000Z', likes: '4,000', retweets: '300', text: '✔️26년 8월 진격의 거인 GEM 엘런 세컨드\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/abc2' },
];
const ownInstaPosts = [
  // instagram.js는 좌표 파싱 실패 시 likes/comments가 null일 수 있음 — 그 케이스도 포함
  { url: 'https://instagram.com/p/1', datetime: '2026-07-01T01:00:00.000Z', likes: '2.3만', comments: '150', caption: '카무이 GEM 세트\n\n예약중\nhttps://m.site.naver.com/abc' },
  { url: 'https://instagram.com/p/2', datetime: '2026-07-01T04:00:00.000Z', likes: null, comments: '알수없음', caption: '정기 점검 안내 (특정 상품 아님)' },
];
const compInstaPosts = [
  { url: 'https://instagram.com/p/3', datetime: '2026-07-01T02:00:00.000Z', likes: '1.5만', comments: '80', caption: '✔️카무이 세컨드 버전\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/abc' },
];

const report = buildComparisonReport({
  startDate: '2026-07-01',
  endDate: '2026-07-02',
  own: [
    { platform: 'twitter', account: 'own_twitter', posts: ownTwitterPosts },
    { platform: 'instagram', account: 'own_insta', posts: ownInstaPosts },
  ],
  competitors: [
    { platform: 'twitter', account: 'comp_twitter', posts: compTwitterPosts },
    { platform: 'instagram', account: 'comp_insta', posts: compInstaPosts },
  ],
});

check('buildComparisonReport: 트위터 합계/비율 계산', () => {
  const tw = report.platforms.twitter;
  assert.strictEqual(tw.ownTotals.total_likes, 19000); // 12000 + 5000 + 2000
  assert.strictEqual(tw.ownTotals.total_retweets, 4800); // 3400 + 900 + 500
  const cmp = tw.perCompetitorComparison[0].metrics.total_likes;
  assert.strictEqual(cmp.own, 19000);
  assert.strictEqual(cmp.competitor, 12000); // 8000 + 4000
  assert.strictEqual(cmp.ratioPercent, 158.3); // 19000/12000*100
});

check('buildComparisonReport: 인스타 파싱 실패 건수 투명하게 집계', () => {
  const ig = report.platforms.instagram;
  const own = ig.own.find(a => a.account === 'own_insta');
  assert.strictEqual(own.parseFailures.comments, 1); // "알수없음" 파싱 실패 1건
  assert.strictEqual(own.total_likes, 23000); // null은 실패로 안 세고 그냥 제외, 있는 값만 합산
});

check('buildProductComparison: 본문 템플릿 기반 상품명 추출 + 키워드 매칭', () => {
  const tw = report.platforms.twitter.productComparison;
  assert.strictEqual(tw.products.length, 2, '은혼 상품, 진격의거인 상품 각각 따로 매칭돼야 함(날짜로 서로 엮이면 안 됨)');
  const eunhon = tw.products.find(p => /은혼|카무이/.test(p.label));
  const attack = tw.products.find(p => /진격|엘런/.test(p.label));
  assert.ok(eunhon, '은혼 상품 그룹이 있어야 함');
  assert.ok(attack, '진격의거인 상품 그룹이 있어야 함');
  assert.strictEqual(eunhon.own.total_likes, 12000);
  assert.strictEqual(eunhon.competitor.total_likes, 8000);
  assert.strictEqual(attack.own.total_likes, 2000);
  assert.strictEqual(attack.competitor.total_likes, 4000);
  // 날짜("26년","7월"/"8월")가 필터링 안 됐으면 위 두 그룹이 하나로 합쳐졌을 것 — 분리 확인이 핵심
  assert.strictEqual(tw.ownUnmatched.length, 1, '특정 상품 아닌 자사 공지 게시물 1건만 매칭 안 됨으로 분리돼야 함');
  assert.strictEqual(tw.competitorUnmatched.length, 0);

  const ig = report.platforms.instagram.productComparison;
  assert.strictEqual(ig.products.length, 1);
  assert.match(ig.products[0].label, /카무이/);
  assert.strictEqual(ig.products[0].own.total_comments, 150);
  assert.strictEqual(ig.products[0].competitor.total_comments, 80);
  assert.strictEqual(ig.ownUnmatched.length, 1);
});

check('extractOwnProductName / extractCompetitorProductName: 템플릿 위치 기반 추출', () => {
  assert.strictEqual(extractOwnProductName('[예약시작] 은혼 GEM 피규어\n\n다음 줄'), '은혼 GEM 피규어');
  assert.strictEqual(
    extractCompetitorProductName('✔️G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트\n\n🛍️바로가기 : https://example.com'),
    'G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트'
  );
});

// ── 3. 엑셀 저장: 히스토리 누적(기존 시트 보존) + 재실행 시 이름 충돌 처리 확인 ──
(async () => {
  const outPath = path.join(__dirname, 'verify-output', 'mock-report.xlsx');
  fs.rmSync(path.dirname(outPath), { recursive: true, force: true });

  const sheet1 = await saveReportToExcel(report, outPath);
  const sheet2 = await saveReportToExcel(report, outPath); // 같은 기간으로 재실행

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);

  check('엑셀: 재실행해도 기존 시트가 지워지지 않고 누적됨', () => {
    assert.notStrictEqual(sheet1, sheet2, '같은 기간 재실행 시 시트 이름이 달라야 함(덮어쓰기 방지)');
    assert.ok(wb.getWorksheet(sheet1), '첫 번째 시트가 남아있어야 함');
    assert.ok(wb.getWorksheet(sheet2), '두 번째 시트도 존재해야 함');
    // 저장 1회당 요약 시트 + 상품별 비교 시트 2개씩 생성됨 → 2회 저장 시 총 4개
    assert.strictEqual(wb.worksheets.length, 4);
  });

  check('엑셀: 임시파일이 정리되고 최종 파일만 남음', () => {
    const files = fs.readdirSync(path.dirname(outPath));
    assert.deepStrictEqual(files, ['mock-report.xlsx']);
  });

  console.log(`\n(생성된 검증용 엑셀 파일: ${outPath} — 직접 열어서 표 형태도 확인 가능)`);
  if (process.exitCode) {
    console.error('\n일부 검증 실패');
  } else {
    console.log('\n전체 검증 통과');
  }
})();
