/**
 * 브라우저/로그인 세션 없이 aggregate.js + excel.js 내부 로직만 검증하는 스크립트.
 * twitter.js/instagram.js가 실제로 반환할 형태를 흉내낸 모킹 데이터를 사용한다.
 * (twitter.js, instagram.js 자체는 실제 세션 없이는 검증 불가 — README/PLAN 참고)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCount, buildComparisonReport, buildProductComparison, extractOwnProductName, extractCompetitorProductName, extractKeywords, formatKstTime } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { extractFromHtml, sanitizeJsonLiteral, extractAssignedJson, withPageParam } = require('./naver-stock');
const { buildStockComparison, rankStockProducts, findStockMatch, matchPwBhStockProducts, buildIntegratedStockRows, renderStockSectionHtml } = require('./stock-report');
const { buildHtmlReport } = require('./html-report');
const { archiveAndGetPath } = require('./report-archive');

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
  { link: 'https://x.com/comp/status/1', datetime: '2026-07-01T03:00:00.000Z', likes: '8,000', retweets: '1,000', text: '✔️은혼 GEM 카무이 ver.2 세컨드\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/xyz' },
  { link: 'https://x.com/comp/status/2', datetime: '2026-07-01T07:00:00.000Z', likes: '4,000', retweets: '300', text: '✔️26년 8월 진격의 거인 GEM 엘런 세컨드\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/abc2' },
];
const ownInstaPosts = [
  // instagram.js는 좌표 파싱 실패 시 likes/comments가 null일 수 있음 — 그 케이스도 포함
  { url: 'https://instagram.com/p/1', datetime: '2026-07-01T01:00:00.000Z', likes: '2.3만', comments: '150', caption: '은혼 카무이 GEM 세트\n\n예약중\nhttps://m.site.naver.com/abc' },
  { url: 'https://instagram.com/p/2', datetime: '2026-07-01T04:00:00.000Z', likes: null, comments: '알수없음', caption: '정기 점검 안내 (특정 상품 아님)' },
];
const compInstaPosts = [
  { url: 'https://instagram.com/p/3', datetime: '2026-07-01T02:00:00.000Z', likes: '1.5만', comments: '80', caption: '✔️은혼 GEM 카무이 세컨드 버전\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/abc' },
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
  const eunhon = tw.products.find(p => /은혼|카무이/.test(p.ip));
  const attack = tw.products.find(p => /진격|엘런/.test(p.ip));
  assert.ok(eunhon, '은혼 상품 그룹이 있어야 함');
  assert.ok(attack, '진격의거인 상품 그룹이 있어야 함');
  assert.strictEqual(eunhon.line, 'GEM');
  assert.strictEqual(eunhon.own.total_likes, 12000);
  assert.strictEqual(eunhon.competitor.total_likes, 8000);
  assert.strictEqual(attack.own.total_likes, 2000);
  assert.strictEqual(attack.competitor.total_likes, 4000);
  // 날짜("26년","7월"/"8월")가 필터링 안 됐으면 위 두 그룹이 하나로 합쳐졌을 것 — 분리 확인이 핵심
  assert.strictEqual(tw.ownUnmatched.length, 1, '특정 상품 아닌 자사 공지 게시물 1건만 매칭 안 됨으로 분리돼야 함');
  assert.strictEqual(tw.competitorUnmatched.length, 0);

  // PW/BH 값이 한 행에 나란히 + 차이/배수/시각차이/결과까지 계산되는지 확인
  assert.strictEqual(eunhon.diffText.likes, '4000 (1.5배)'); // 12000-8000=4000, 12000/8000=1.5
  assert.strictEqual(eunhon.verdict, '우세'); // 리트윗/좋아요 둘 다 자사가 큼
  assert.strictEqual(eunhon.pwTime, '7/1 11:00'); // 2026-07-01T02:00:00Z + 9h
  assert.strictEqual(eunhon.bhTime, '7/1 12:00'); // 2026-07-01T03:00:00Z + 9h
  assert.strictEqual(eunhon.timeDiffMinutes, 60);

  const ig = report.platforms.instagram.productComparison;
  assert.strictEqual(ig.products.length, 1);
  assert.match(ig.products[0].ip, /카무이/);
  assert.strictEqual(ig.products[0].own.total_comments, 150);
  assert.strictEqual(ig.products[0].competitor.total_comments, 80);
  assert.strictEqual(ig.ownUnmatched.length, 1);
});

// 실제 계정 데이터로 검증했을 때 발견된 3가지 오매칭 패턴 회귀 방지 테스트
check('extractKeywords: 실전에서 발견된 오매칭 패턴들이 다시 생기지 않는지', () => {
  // 1) 브라켓 태그("[채색원형 최초공개]")가 서로 다른 프랜차이즈 게시물을 연결하면 안 됨
  const a = extractKeywords('[채색원형 최초공개] 원피스 메가캣\n\nMEGA CAT PROJECT 냥피스');
  const b = extractKeywords('[채색원형 최초공개] 은혼 룩업 미니어처 컬렉션');
  const bracketOverlap = a.filter(k => b.includes(k));
  assert.strictEqual(bracketOverlap.length, 0, '브라켓 태그 문구만으로는 겹치는 키워드가 없어야 함');

  // 2) naver.com 링크의 16진수 해시 조각("ca","ef" 등)이 무관한 게시물을 연결하면 안 됨
  const c = extractKeywords('원피스 토비마스\n\nhttps://\nmkt.shopping.naver.com/link/6a44b667b\nb3426556b41926e\n…');
  const d = extractKeywords('은혼 카무이\n\nhttps://\nmkt.shopping.naver.com/link/6a45eb80b\nb3426556b41939a\n…');
  const urlHashOverlap = c.filter(k => d.includes(k));
  assert.strictEqual(urlHashOverlap.length, 0, 'URL 해시 조각으로는 겹치는 키워드가 없어야 함');

  // 3) 흔한 단어("SET") 하나만 겹치는 건 매칭 기준(2개 이상) 미달이어야 함
  const e = extractKeywords('원피스 컬렉션 SET');
  const f = extractKeywords('은혼 컬렉션 SET');
  const singleWordOverlap = e.filter(k => f.includes(k));
  assert.ok(singleWordOverlap.length < 2, '흔한 단어 1개 겹침만으로는 매칭 기준(2개 이상)에 못 미쳐야 함');
});

check('수동 매칭(manual-matches): 자동으로 안 묶이는 게시물도 사람이 지정하면 상품 행에 들어감', () => {
  const ownP = [{ link: 'https://x.com/own/999', datetime: '2026-07-01T01:00:00.000Z', likes: '10', retweets: '5', text: '전혀 안 겹치는 문구' }];
  const compP = [{ link: 'https://x.com/comp/999', datetime: '2026-07-01T02:00:00.000Z', likes: '3', retweets: '1', text: '완전히 다른 문구' }];
  const result = buildProductComparison(ownP, compP, ['likes', 'retweets'], 'text', ['retweets', 'likes'], [
    { pw: ['https://x.com/own/999'], bh: ['https://x.com/comp/999'], label: '수동상품' },
  ]);
  assert.strictEqual(result.products.length, 1, '수동 매칭 1건이 상품 행으로 만들어져야 함');
  assert.strictEqual(result.products[0].ip, '수동상품');
  assert.strictEqual(result.products[0].own.total_likes, 10);
  assert.strictEqual(result.products[0].competitor.total_likes, 3);
  assert.strictEqual(result.ownUnmatched.length, 0, '수동 매칭된 게시물은 매칭 안 됨 목록에서 빠져야 함');
  assert.strictEqual(result.competitorUnmatched.length, 0);
});

check('ignore-posts: 상품 아닌 공지 게시물은 "매칭 안 됨" 목록에서만 빠지고 계정 총계엔 그대로 포함', () => {
  const ownP = [{ link: 'https://x.com/own/1', datetime: '2026-07-01T01:00:00.000Z', likes: '10', retweets: '5', text: '전혀 안 겹치는 문구' }];
  const compP = [
    { link: 'https://x.com/comp/1', datetime: '2026-07-01T02:00:00.000Z', likes: '3', retweets: '1', text: '완전히 다른 문구' },
    { link: 'https://x.com/comp/2', datetime: '2026-07-01T03:00:00.000Z', likes: '7', retweets: '2', text: '쿠폰 이벤트 공지' },
  ];
  const result = buildProductComparison(ownP, compP, ['likes', 'retweets'], 'text', ['retweets', 'likes'], [], {
    bh: ['https://x.com/comp/2'],
  });
  assert.strictEqual(result.ownUnmatched.length, 1, 'ignorePosts에 없는 own 게시물은 그대로 매칭 안 됨에 남아야 함');
  assert.strictEqual(result.competitorUnmatched.length, 1, 'ignore 대상 아닌 comp/1은 그대로 매칭 안 됨에 남아야 함');
  assert.strictEqual(result.competitorUnmatched[0].link, 'https://x.com/comp/1', 'comp/2(ignore 대상)만 매칭 안 됨 목록에서 빠져야 함');
});

check('같은 IP(원피스)라도 상품 라인(룩업/GEM)이 다르면 분리돼야 함', () => {
  // 실제 데이터에서 "원피스" 하나로 룩업/스케일/컬렉션 등 완전히 다른 라인이 다 뭉쳐버리는
  // 문제가 있었음. 아래는 키워드는 3개나 겹치지만("원피스","루피","기어") 라인이 다른
  // own_a-comp_b, own_b-comp_a 쌍이 절대 합쳐지면 안 됨을 검증.
  const own = [
    { link: 'https://x.com/own/a', datetime: '2026-07-01T01:00:00.000Z', likes: '10', retweets: '5', text: '원피스 룩업 루피 기어\n\nhttps://m.site.naver.com/x' },
    { link: 'https://x.com/own/b', datetime: '2026-07-01T02:00:00.000Z', likes: '20', retweets: '8', text: '원피스 GEM 루피 기어\n\nhttps://m.site.naver.com/y' },
  ];
  const comp = [
    { link: 'https://x.com/comp/a', datetime: '2026-07-01T03:00:00.000Z', likes: '3', retweets: '1', text: '✔️원피스 룩업 루피 기어\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/x' },
    { link: 'https://x.com/comp/b', datetime: '2026-07-01T04:00:00.000Z', likes: '6', retweets: '2', text: '✔️원피스 GEM 루피 기어\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/y' },
  ];
  const result = buildProductComparison(own, comp, ['likes', 'retweets'], 'text', ['retweets', 'likes']);
  assert.strictEqual(result.products.length, 2, '라인이 다르면 키워드가 겹쳐도 별도 상품으로 분리돼야 함');
  const byLine = Object.fromEntries(result.products.map(p => [p.line, p]));
  assert.strictEqual(byLine['룩업'].own.total_likes, 10);
  assert.strictEqual(byLine['룩업'].competitor.total_likes, 3);
  assert.strictEqual(byLine['GEM'].own.total_likes, 20);
  assert.strictEqual(byLine['GEM'].competitor.total_likes, 6);
});

check('상품 라인 별칭 통일: "스케일"(당사 표현)과 "POP"(경쟁사 표현)은 같은 라인으로 매칭', () => {
  const own = [
    { link: 'https://x.com/own/c', datetime: '2026-07-01T01:00:00.000Z', likes: '10', retweets: '5', text: '원피스 스케일 피규어\n\nPOP 시리즈\n하이에나 베라미\n\nhttps://m.site.naver.com/z' },
  ];
  const comp = [
    { link: 'https://x.com/comp/c', datetime: '2026-07-01T02:00:00.000Z', likes: '3', retweets: '1', text: '✔️P.O.P 시리즈 하이에나 베라미\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/z' },
  ];
  const result = buildProductComparison(own, comp, ['likes', 'retweets'], 'text', ['retweets', 'likes']);
  assert.strictEqual(result.products.length, 1, '"스케일"과 "P.O.P"는 같은 라인(POP)으로 취급해서 매칭돼야 함');
  assert.strictEqual(result.products[0].line, 'POP');
});

check('formatKstTime: 날짜가 다른 게시물끼리 비교할 때 날짜도 같이 표시돼야 함', () => {
  // 실제 데이터에서 "시각차이 1496분"처럼 이상해 보이는 값이 나온 원인 — PW/BH가 하루
  // 넘게 차이나는 날 각각 게시했는데 시:분만 보여줘서 헷갈렸음. 날짜 포함 표시로 수정.
  assert.strictEqual(formatKstTime('2026-07-02T08:06:45.000Z'), '7/2 17:06');
  assert.strictEqual(formatKstTime('2026-07-01T07:11:00.000Z'), '7/1 16:11');
});

check('extractOwnProductName / extractCompetitorProductName: 템플릿 위치 기반 추출', () => {
  assert.strictEqual(extractOwnProductName('[예약시작] 은혼 GEM 피규어\n\n다음 줄'), '은혼 GEM 피규어');
  assert.strictEqual(
    extractCompetitorProductName('✔️G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트\n\n🛍️바로가기 : https://example.com'),
    'G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트'
  );
});

check('naver-stock: __PRELOADED_STATE__ / __next_f 플라이트 두 경로 다 재고·가격 추출', () => {
  const preloadedObj = {
    product: {
      A: {
        channelProductNo: 13647054468,
        productName: '테스트 피규어',
        stockQuantity: 42,
        salePrice: 29000,
        benefitsView: { discountedSalePrice: 25000, discountedRatio: 14 },
      },
    },
  };
  // __PRELOADED_STATE__는 순수 JSON이 아닌 JS 객체 리터럴이라 undefined 같은 토큰이 섞일 수
  // 있음 — sanitizeJsonLiteral이 이런 토큰을 null로 치환해서 파싱이 안 깨지는지도 같이 확인.
  const preloadedJson = JSON.stringify(preloadedObj).replace(
    '"salePrice":29000',
    '"salePrice":29000,"legacyNote":undefined'
  );
  const preloadedHtml = `<script>window.__PRELOADED_STATE__ = ${preloadedJson};</script>`;

  const flightRowObj = { channelProductId: 99887766, productName: '플라이트 상품', availableStockQuantity: 7, salePrice: 15000 };
  const flightRowText = `1:${JSON.stringify(flightRowObj)}`;
  const innerEscaped = JSON.stringify(flightRowText).slice(1, -1);
  const flightHtml = `<script>self.__next_f.push([1,"${innerEscaped}"])</script>`;

  const records = extractFromHtml(`<html><head>${preloadedHtml}${flightHtml}</head></html>`);

  const preloaded = records.find(r => r.productId === '13647054468');
  assert.ok(preloaded, '__PRELOADED_STATE__ 경로 상품이 추출돼야 함');
  assert.strictEqual(preloaded.stock, 42);
  assert.strictEqual(preloaded.price, 25000, '할인가가 있으면 할인가를 가격으로 써야 함');
  assert.strictEqual(preloaded.name, '테스트 피규어');

  const flight = records.find(r => r.productId === '99887766');
  assert.ok(flight, '__next_f 플라이트 경로 상품도 추출돼야 함');
  assert.strictEqual(flight.stock, 7);
  assert.strictEqual(flight.price, 15000);
});

check('naver-stock: sanitizeJsonLiteral/extractAssignedJson 유틸 단위 검증', () => {
  assert.strictEqual(sanitizeJsonLiteral('{"a":undefined,"b":NaN,"c":"undefined 문자열은 유지"}'),
    '{"a":null,"b":null,"c":"undefined 문자열은 유지"}');
  assert.strictEqual(extractAssignedJson('window.__X__ = {"a":1};', '__X__'), '{"a":1}');
  assert.strictEqual(extractAssignedJson('no marker here', '__X__'), '');
});

check('naver-stock: withPageParam — 다음 페이지 URL을 만들 때 다른 쿼리 파라미터는 그대로 유지', () => {
  assert.strictEqual(
    withPageParam('https://m.smartstore.naver.com/mall/category/1?st=TOTALSALE&page=1&size=40', 2),
    'https://m.smartstore.naver.com/mall/category/1?st=TOTALSALE&page=2&size=40'
  );
  assert.strictEqual(
    withPageParam('https://example.com/list?page=1', 3),
    'https://example.com/list?page=3'
  );
});

check('stock-report: 스냅샷 1개뿐일 땐 비교 없이 현재값만, 2개면 변화량(판매 추정) 계산', () => {
  const oneSnapshot = {
    snapshots: [
      { takenAt: '2026-07-01T00:00:00.000Z', stores: { PW: [{ productId: 'A', name: '상품A', price: 10000, stock: 9999 }] } },
    ],
  };
  const onlyOne = buildStockComparison(oneSnapshot);
  assert.strictEqual(onlyOne.previousTakenAt, null, '스냅샷이 1개면 비교 대상이 없어야 함');
  assert.strictEqual(onlyOne.stores.PW[0].stockDelta, null);
  assert.strictEqual(onlyOne.stores.PW[0].totalSoldIsEstimated, true, 'totalSold는 항상 초기한도 역산 기반 추정치');
  assert.strictEqual(onlyOne.stores.PW[0].totalSold, 1, '재고 9999 → 초기한도 10000으로 가정 → 10000-9999=1');

  const twoSnapshots = {
    snapshots: [
      { takenAt: '2026-07-01T00:00:00.000Z', stores: { PW: [{ productId: 'A', name: '상품A', price: 10000, stock: 9999 }] } },
      {
        takenAt: '2026-07-02T00:00:00.000Z',
        stores: {
          PW: [
            { productId: 'A', name: '상품A', price: 10000, stock: 9486 }, // 재고 감소 = 판매 추정
            { productId: 'B', name: '신상품B', price: 5000, stock: 100 }, // 첫 등장(비교 불가)
          ],
        },
      },
    ],
  };
  const compared = buildStockComparison(twoSnapshots);
  assert.ok(compared.previousTakenAt, '스냅샷이 2개면 직전 스냅샷과 비교해야 함');
  const a = compared.stores.PW.find(p => p.productId === 'A');
  const b = compared.stores.PW.find(p => p.productId === 'B');
  assert.strictEqual(a.stockDelta, 513, '9999 - 9486 = 513개 판매 추정(직전 스냅샷 대비, 참고용)');
  assert.strictEqual(b.stockDelta, null, '이전 스냅샷에 없던 신규 상품은 직전 대비 비교 불가(null)');
  assert.strictEqual(a.totalSold, 514, '실제 최초 관측(9999)과 무관하게 항상 초기한도 역산: 재고 9486 → 초기한도 10000 → 514');
  assert.strictEqual(a.totalSoldIsEstimated, true, 'totalSold는 실제 과거 기록 유무와 무관하게 항상 초기한도 추정');
  assert.strictEqual(b.totalSoldIsEstimated, true, 'B도 마찬가지로 초기한도 추정');
  assert.strictEqual(b.totalSold, 900, '재고 100 → 초기한도 1000으로 가정 → 1000-100=900');
});

check('stock-report: rankStockProducts — 총 판매추정치를 모르는 상품은 순위 없이 "-" 처리용 null', () => {
  const ranked = rankStockProducts([
    { productId: 'A', name: '상품A', stock: 9486, totalSold: 513 },
    { productId: 'B', name: '상품B', stock: 100, totalSold: null },
    { productId: 'C', name: '상품C', stock: 9062, totalSold: 438 },
  ]);
  assert.strictEqual(ranked[0].productId, 'A', '가장 많이 판매 추정된 상품이 1위여야 함');
  assert.strictEqual(ranked[0].rank, 1);
  assert.strictEqual(ranked[1].productId, 'C');
  assert.strictEqual(ranked[1].rank, 2);
  const b = ranked.find(r => r.productId === 'B');
  assert.strictEqual(b.rank, null, '총 판매추정치를 모르는 상품은 순위를 매기면 안 됨(근거 없는 숫자 방지)');
});

check('stock-report: findStockMatch — SNS 상품(ip/line)과 재고 상품명 근사 매칭', () => {
  const ranked = rankStockProducts([
    { productId: 'A', name: '[예약] 은혼 GEM 카무이 ver.2 (재판)', stock: 9486, totalSold: 513 },
    { productId: 'B', name: '은혼 룩업 미니어처 컬렉션', stock: 9062, totalSold: 438 },
  ]);
  const match = findStockMatch('은혼', 'GEM', ranked);
  assert.ok(match, 'ip+line이 둘 다 포함된 상품명을 찾아야 함');
  assert.strictEqual(match.productId, 'A', 'line(GEM)까지 일치하는 쪽을 우선해야 함(룩업 말고)');
  assert.strictEqual(findStockMatch('없는상품', null, ranked), null, '매칭되는 게 없으면 null');
  assert.strictEqual(findStockMatch(null, null, ranked), null, 'ip 자체가 없으면 매칭 시도 안 함');
});

check('html-report: SNS 표 우측 매출 칸(PW vs BH 분할 바) + 하단 재고 스냅샷 섹션, 둘 다 있어야 함', () => {
  // 한 번 실수로 하단 독립 섹션을 지웠다가 복구한 적 있음 — 회귀 방지: 둘 다 공존해야 함.
  const stockComparison = {
    latestTakenAt: '2026-07-08T00:00:00.000Z',
    previousTakenAt: '2026-07-06T00:00:00.000Z',
    snapshotCount: 2,
    stores: {
      PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486, totalSold: 513, totalSoldIsEstimated: false }],
      BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 470, totalSold: 30, totalSoldIsEstimated: false }],
    },
    storeComparable: { PW: true, BH: true },
  };

  const html = buildHtmlReport(report, stockComparison);
  assert.ok(html.includes('📦 매출 (PW vs BH)'), '헤더에 매출 칸이 리트윗/좋아요와 같은 "PW vs BH" 형식으로 있어야 함');
  assert.ok(html.includes('class="metricbar-val pw">513개') && html.includes('class="metricbar-val bh">30개'),
    'PW/BH 매출이 리트윗/좋아요와 같은 분할 바 형식(metricbar-val)으로 나와야 함');
  assert.ok(html.includes('재고 스냅샷 (실험적)'), '하단 독립 재고 섹션도 그대로 남아있어야 함(삭제 금지)');
  assert.ok(html.includes('매출순위'), '독립 섹션에도 매출순위 컬럼이 있어야 함');

  assert.strictEqual(buildHtmlReport(report, null).includes('재고 스냅샷'), false,
    '재고 히스토리가 아예 없으면(null) 독립 섹션도 안 나와야 함');
});

check('html-report/stock-report: 직전 스냅샷이 있어도 특정 store만 그때 수집 실패(0건)했으면 "신규" 오표시하면 안 됨 — 초기 한도 추정치로 대체', () => {
  // 실제로 있었던 버그: BH가 로그인 게이트에 걸려서 0건 수집된 스냅샷 다음에, 정상 수집된
  // 스냅샷과 비교하면 BH 상품 전체가 진짜 신규가 아닌데도 "신규"로 잘못 표시됐음. 지금은
  // totalSold 자체가 실제 과거 기록 유무와 무관하게 항상 초기 한도(가장 가까운 1000단위)
  // 역산이라 PW/BH 둘 다 이미 같은 형식이고("신규" 분기 자체가 없음), 이 테스트는 그 상태가
  // 계속 유지되는지 보는 회귀 방지용.
  const historyWithFailedBhSnapshot = {
    snapshots: [
      { takenAt: '2026-07-06T00:00:00.000Z', stores: { PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9999 }], BH: [] } },
      { takenAt: '2026-07-08T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 470 }],
      } },
    ],
  };
  const compared = buildStockComparison(historyWithFailedBhSnapshot);
  assert.strictEqual(compared.storeComparable.PW, true, 'PW는 직전 스냅샷 데이터가 있었으니 비교 가능해야 함');
  assert.strictEqual(compared.storeComparable.BH, false, 'BH는 직전 스냅샷이 0건이었으니 비교 불가로 표시돼야 함');
  const pwProduct = compared.stores.PW[0];
  const bhProduct = compared.stores.BH[0];
  assert.strictEqual(pwProduct.totalSold, 514, 'PW도 항상 초기한도 역산: 재고 9486 → 초기한도 10000 → 514');
  assert.strictEqual(pwProduct.totalSoldIsEstimated, true, 'totalSold는 실제 과거 기록 유무와 무관하게 항상 초기한도 추정');
  assert.strictEqual(bhProduct.estimatedCap, 1000, '재고 470을 가장 가까운 1000단위로 올리면 1000이어야 함');
  assert.strictEqual(bhProduct.totalSold, 530, '1000 - 470 = 530이 추정 판매량이어야 함');
  assert.strictEqual(bhProduct.totalSoldIsEstimated, true, 'BH도 마찬가지로 초기한도 추정');

  const html = buildHtmlReport(report, compared);
  assert.ok(html.includes('class="metricbar-val pw">514개*') && html.includes('class="metricbar-val bh">530개*'),
    'PW/BH 둘 다 같은 분할 바 형식(초기한도 추정, "*" 표시)으로 나와야 함');
  // 각주 설명 문구엔 "신규"라는 단어 자체가 나오지만(의미 설명용), 실제 셀 내용(>신규<)으로
  // 렌더링되면 안 됨 — BH는 직전 데이터가 없었을 뿐 진짜 신규가 아님.
  assert.ok(!html.includes('>신규<'), 'BH는 직전 데이터가 없었을 뿐 진짜 신규가 아니므로 "신규" 셀로 표시하면 안 됨');
});

check('stock-report: 재고 스냅샷 하단 표에 "직전 스냅샷 대비" 컬럼 — totalSold(초기한도 추정)와 별개로 순수 실측 변화량', () => {
  const history = {
    snapshots: [
      { takenAt: '2026-07-06T00:00:00.000Z', stores: { PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9999 }] } },
      { takenAt: '2026-07-08T00:00:00.000Z', stores: { PW: [
        { productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486 },
        { productId: 'X2', name: '신상품', price: 100000, stock: 500 },
      ] } },
    ],
  };
  const compared = buildStockComparison(history);
  const html = renderStockSectionHtml(compared);
  assert.ok(html.includes('직전 스냅샷 대비'), '헤더에 새 컬럼이 있어야 함');
  assert.ok(html.includes('513개 판매'), '9999 - 9486 = 513개 판매(직전 스냅샷 대비, 순수 실측값)가 표시돼야 함');
  assert.ok(html.includes('비교 불가'), '직전 스냅샷에 없던 신규 상품(X2)은 "비교 불가"로 표시돼야 함');
});

check('stock-report: matchPwBhStockProducts — SNS 매칭과 같은 규칙(키워드 2개+라인 일치)으로 PW/BH 재고 상품명 매칭', () => {
  const pw = [
    { productId: 'P1', name: '[예약] GEM 시리즈 카무이 ver 2 l 은혼 (재판)' },
    { productId: 'P2', name: '전혀 다른 상품 룩업 나루토' },
  ];
  const bh = [
    { productId: 'B1', name: '은혼 GEM 카무이 세컨드' },
    { productId: 'B2', name: '상관없는 상품' },
  ];
  const pairs = matchPwBhStockProducts(pw, bh);
  assert.strictEqual(pairs.length, 1, '카무이·은혼끼리만 매칭되고 나머지는 매칭 안 돼야 함');
  assert.strictEqual(pairs[0].pw.productId, 'P1');
  assert.strictEqual(pairs[0].bh.productId, 'B1');
});

check('stock-report: matchPwBhStockProducts — 한쪽에 후보가 여러 개 몰리면(모호함) 매칭 안 시킴', () => {
  const pw = [
    { productId: 'P1', name: '은혼 GEM 카무이 초판' },
    { productId: 'P2', name: '은혼 GEM 카무이 재판' },
  ];
  const bh = [{ productId: 'B1', name: '은혼 GEM 카무이 세컨드' }];
  const pairs = matchPwBhStockProducts(pw, bh);
  assert.strictEqual(pairs.length, 0, 'PW 쪽에 후보가 2개면 어느 쪽을 짝지을지 모호하니 매칭하면 안 됨(잘못 짝짓는 것보다 안전)');
});

check('stock-report: 종합표 — PW/BH 매칭 + 점유율 + 직전/전전 스냅샷 대비 + 추이 그래프(스냅샷 3개 이상)', () => {
  const history = {
    snapshots: [
      { takenAt: '2026-07-04T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9999 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 900 }],
      } },
      { takenAt: '2026-07-06T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9700 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 700 }],
      } },
      { takenAt: '2026-07-08T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 470 }],
      } },
    ],
  };
  const compared = buildStockComparison(history);
  const rows = buildIntegratedStockRows(compared);
  assert.strictEqual(rows.length, 1, 'PW/BH 은혼 카무이가 매칭돼서 1쌍 나와야 함');
  const row = rows[0];
  assert.strictEqual(row.pwDelta2, 299, '전전 스냅샷 대비: 9999-9700=299');
  assert.strictEqual(row.bhDelta2, 200, '전전 스냅샷 대비: 900-700=200');
  assert.strictEqual(row.pwSeries.length, 3, 'PW는 스냅샷 3개 모두에 등장해야 함');
  assert.strictEqual(row.bhSeries.length, 3, 'BH도 스냅샷 3개 모두에 등장해야 함');

  const html = renderStockSectionHtml(compared);
  assert.ok(html.includes('🔗 종합'), '종합표 헤더가 있어야 함');
  assert.ok(html.includes('전체 펼치기') && html.includes('전체 접기'), 'SNS 표처럼 전체 펼치기/접기 버튼이 있어야 함');
  assert.ok(html.includes('<svg'), '스냅샷 3개 이상이면 추이 그래프(svg)가 그려져야 함');
  assert.ok(html.includes('점유율'), 'PW/BH 총판매추정 칸에 점유율이 표시돼야 함');
});

check('stock-report: 종합표 — 스냅샷이 2개뿐이면 "그 전 스냅샷 대비"는 계산 불가(null), 추이는 안내 문구로 대체', () => {
  const history = {
    snapshots: [
      { takenAt: '2026-07-06T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9999 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 900 }],
      } },
      { takenAt: '2026-07-08T00:00:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 470 }],
      } },
    ],
  };
  const compared = buildStockComparison(history);
  const rows = buildIntegratedStockRows(compared);
  assert.strictEqual(rows[0].pwDelta2, null, '스냅샷이 2개뿐이면 전전 대비를 계산할 과거가 없어야 함');

  const html = renderStockSectionHtml(compared);
  assert.ok(html.includes('스냅샷이 더 쌓이면 추이 그래프'), '시점이 2개뿐이면 그래프 대신 안내 문구가 나와야 함');
});

check('report-archive: 기존 리포트(고정이름+타임스탬프 이름 둘 다)를 old/로 옮기고 새 타임스탬프 경로를 돌려줌', () => {
  const dir = path.join(__dirname, 'verify-output', 'archive-test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sns-report.html'), '예전 고정이름 파일');
  fs.writeFileSync(path.join(dir, 'sns-report_20260101_0000.html'), '예전 타임스탬프 파일');
  fs.writeFileSync(path.join(dir, 'sns-report.xlsx'), '엑셀은 손대면 안 됨');

  const newPath = archiveAndGetPath(dir, 'sns-report', 'html');

  assert.ok(/sns-report_\d{8}_\d{4}\.html$/.test(newPath), `새 경로는 타임스탬프 형식이어야 함: ${newPath}`);
  assert.ok(!fs.existsSync(path.join(dir, 'sns-report.html')), '예전 고정이름 파일은 dir에 남아있으면 안 됨');
  assert.ok(!fs.existsSync(path.join(dir, 'sns-report_20260101_0000.html')), '예전 타임스탬프 파일도 dir에 남아있으면 안 됨');
  assert.ok(fs.existsSync(path.join(dir, 'old', 'sns-report.html')), 'old/에 고정이름 파일이 옮겨져 있어야 함');
  assert.ok(fs.existsSync(path.join(dir, 'old', 'sns-report_20260101_0000.html')), 'old/에 타임스탬프 파일도 옮겨져 있어야 함');
  assert.ok(fs.existsSync(path.join(dir, 'sns-report.xlsx')), '엑셀(.xlsx)은 html이 아니니 옮겨지면 안 됨');

  fs.rmSync(dir, { recursive: true, force: true });
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
