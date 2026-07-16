/**
 * 브라우저/로그인 세션 없이 aggregate.js + excel.js 내부 로직만 검증하는 스크립트.
 * twitter.js/instagram.js가 실제로 반환할 형태를 흉내낸 모킹 데이터를 사용한다.
 * (twitter.js, instagram.js 자체는 실제 세션 없이는 검증 불가 — README/PLAN 참고)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCount, summarizeAccount, buildComparisonReport, buildProductComparison, extractOwnProductName, extractCompetitorProductName, extractKeywords, formatKstTime, applyManualPosts } = require('./aggregate');
const { parsePastedPost } = require('./paste-parser');
const { buildAccountReportHtml, buildPlaintextDump } = require('./account-report');
const { saveReportToExcel, renameWithRetry } = require('./excel');
const { saveAccountReportToExcel } = require('./account-excel');
const { buildPeriodSummary, buildPeriodComparisonHtml } = require('./period-comparison');
const { savePeriodComparisonToExcel } = require('./period-excel');
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

check('extractKeywords: "헌터×헌터"(곱셈기호)와 "헌터x헌터"(영문x)가 같은 토큰으로 잡혀야 함', () => {
  // 실전 사례: 자사는 "헌터x헌터"(영문 x)로 쓰고 경쟁사는 "헌터×헌터"(곱셈 기호, U+00D7)로
  // 써서, 곱셈 기호가 글자(\p{L})가 아니라 토큰이 "헌터"+"헌터"로 끊겨버림 → 겹치는 키워드가
  // 0개로 나와 같은 프랜차이즈인데도 절대 매칭될 수 없었던 문제.
  const own = extractKeywords('헌터x헌터 룩업 곤 프릭스');
  const competitor = extractKeywords('헌터×헌터 환상의 콤비 룩업 출시');
  assert.ok(own.includes('헌터x헌터'), '영문 x는 한 토큰으로 잡혀야 함');
  assert.ok(competitor.includes('헌터x헌터'), '곱셈 기호도 x로 정규화돼서 같은 토큰으로 잡혀야 함');
});

check('완전히 다른 프랜차이즈(페르소나3 vs 헌터x헌터)가 "초회특전(방석) SET" 상용구만으로 묶이면 안 됨', () => {
  // 실전 사례: 자사가 여러 프랜차이즈 예약 발표 게시물마다 똑같이 쓰는 "초회특전 SET(방석)"
  // 문구가 안 걸러졌을 때, 완전히 무관한 페르소나3 게시물과 헌터x헌터 게시물이 이 상용구 3개
  // 단어(초회/방석/SET)만으로 겹쳐서 하나의 상품으로 잘못 묶였음 — 그 결과 "헌터x헌터" 실적
  // 숫자에 페르소나3 실적이 섞여 들어가 있었음(사용자가 실제 리포트에서 발견).
  const persona = extractKeywords(
    '[예약시작] 페르소나3 리로드 룩업\n\n주인공(유키 마코토)\n\n아이기스\n\n초회특전 SET(방석)\n\n발매:27년 2월\n예약판매 기간 내 5% 할인 캠페인 중!'
  );
  const hxh = extractKeywords(
    '[예약시작] 헌터x헌터 룩업\n\n곤 프릭스\n\n키르아 조르딕\n\n초회특전 (방석 SET)\n\n발매: 27년 1월\n예약판매 기간 내 5% 할인 캠페인 중!'
  );
  const overlap = persona.filter(k => hxh.includes(k));
  assert.strictEqual(overlap.length, 0, '상용구("초회","방석","SET")를 빼면 겹치는 키워드가 없어야 함');
});

check('BH 발표 게시물 고정 템플릿("원형/최초/추가/추후")이 서로 다른 상품끼리 다리 역할 하면 안 됨', () => {
  // 실전 사례: BH가 신제품 발표 게시물마다 "OO 원형 첫 공개... 룩업 시리즈 신제품 OO 최초
  // 공개! 추가 정보 추후 공개 예정"이라는 문구를 그대로 재사용해서, 이 상용구 단어들이
  // GENERIC_KEYWORDS에 없었을 때 BH 게시물 5건이 서로 전부 연결되고, 거기에 각 PW 게시물이
  // 다리처럼 붙어서 실제로는 무관한 상품 10건(PW 5 + BH 5)이 통째로 하나로 뭉쳤었음.
  const own = [
    { link: 'https://x.com/own/reborn', datetime: '2026-07-10T01:00:00.000Z', likes: '10', retweets: '5', text: '[원형 최초공개] 가히리 룩업\n\n가정교사 히트맨 REBORN!\n사와다 츠나요시\n히바리 쿄야' },
    { link: 'https://x.com/own/p5r', datetime: '2026-07-10T02:00:00.000Z', likes: '10', retweets: '5', text: '[원형 최초공개] 페르소나5 더 로열 룩업\n\n주인공\n모르가나' },
    { link: 'https://x.com/own/kaguya', datetime: '2026-07-10T03:00:00.000Z', likes: '10', retweets: '5', text: '[원형 최초공개] 초 가구야 공주! 룩업\n\n가구야\n이로하' },
    { link: 'https://x.com/own/bleach', datetime: '2026-07-10T04:00:00.000Z', likes: '10', retweets: '5', text: '[채색원형 최초공개] 블리치 룩업\n\n히츠가야 토시로\n히라코 신지' },
    { link: 'https://x.com/own/honkai', datetime: '2026-07-10T05:00:00.000Z', likes: '10', retweets: '5', text: '[채색원형 최초공개] 붕괴 스타레일 룩업\n\n더 헤르타\n카프카' },
  ];
  const comp = [
    { link: 'https://x.com/comp/reborn', datetime: '2026-07-10T06:00:00.000Z', likes: '3', retweets: '1', text: '원형 첫 공개\n가정교사 히트맨 리본 REBORN\n룩업 사와다 츠나요시\n룩업 히바리 쿄야\n룩업 시리즈 신제품 원형 최초 공개! 추가 정보 추후 공개 예정' },
    { link: 'https://x.com/comp/p5r', datetime: '2026-07-10T06:10:00.000Z', likes: '3', retweets: '1', text: '원형 첫 공개\n페르소나 5 더 로열 P5R\n룩업 주인공\n룩업 모르가나\n룩업 시리즈 신제품 원형 최초 공개! 추가 정보 추후 공개 예정' },
    { link: 'https://x.com/comp/kaguya', datetime: '2026-07-10T06:20:00.000Z', likes: '3', retweets: '1', text: '원형 첫 공개\n초 가구야 공주\n룩업 가구야\n룩업 사카요리 이로하\n룩업 시리즈 신제품 원형 최초 공개! 추가 정보 추후 공개 예정' },
    { link: 'https://x.com/comp/bleach', datetime: '2026-07-10T06:30:00.000Z', likes: '3', retweets: '1', text: '색채 조형 첫 공개\n블리치 BLEACH\n룩업 히츠가야 토시로\n룩업 히라코 신지\n룩업 시리즈 신제품 색채 조형 공개! 추가 정보 추후 공개 예정' },
    { link: 'https://x.com/comp/honkai', datetime: '2026-07-10T06:40:00.000Z', likes: '3', retweets: '1', text: '색채 조형 첫 공개\n붕괴 스타레일\n룩업 헤르타 카프카\n룩업 시리즈 신제품 색채 조형 공개! 추가 정보 추후 공개 예정' },
  ];
  const result = buildProductComparison(own, comp, ['likes', 'retweets'], 'text', ['retweets', 'likes']);
  assert.strictEqual(result.products.length, 5, '상용구로 다리 놓이지 않고 5개 상품으로 정확히 분리돼야 함');
  result.products.forEach(p => {
    assert.strictEqual(p.own.postCount, 1, `"${p.ip}" 행은 PW 게시물 1건씩만 있어야 함(다른 상품과 안 섞임)`);
    assert.strictEqual(p.competitor.postCount, 1, `"${p.ip}" 행은 BH 게시물 1건씩만 있어야 함(다른 상품과 안 섞임)`);
  });
});

check('상품 매칭 그룹에 게시물이 너무 많이 몰리면(오묶음 의심) "확인 필요" 표시가 붙어야 함', () => {
  const many = [
    { link: 'https://x.com/own/many1', datetime: '2026-07-01T01:00:00.000Z', likes: '10', retweets: '5', text: '왕눈이 캐릭터 인형 1탄' },
    { link: 'https://x.com/own/many2', datetime: '2026-07-01T02:00:00.000Z', likes: '10', retweets: '5', text: '왕눈이 캐릭터 인형 2탄' },
    { link: 'https://x.com/own/many3', datetime: '2026-07-01T03:00:00.000Z', likes: '10', retweets: '5', text: '왕눈이 캐릭터 인형 3탄' },
  ];
  const manyComp = [
    { link: 'https://x.com/comp/many1', datetime: '2026-07-01T04:00:00.000Z', likes: '3', retweets: '1', text: '왕눈이 캐릭터 인형 4탄' },
    { link: 'https://x.com/comp/many2', datetime: '2026-07-01T05:00:00.000Z', likes: '3', retweets: '1', text: '왕눈이 캐릭터 인형 5탄' },
  ];
  const few = [{ link: 'https://x.com/own/few1', datetime: '2026-07-01T06:00:00.000Z', likes: '10', retweets: '5', text: '별똥별 소녀 인형' }];
  const fewComp = [{ link: 'https://x.com/comp/few1', datetime: '2026-07-01T07:00:00.000Z', likes: '3', retweets: '1', text: '별똥별 소녀 인형' }];

  const result = buildProductComparison(
    [...many, ...few], [...manyComp, ...fewComp], ['likes', 'retweets'], 'text', ['retweets', 'likes']
  );
  assert.strictEqual(result.products.length, 2, '두 그룹(많이 몰린 것/적은 것)으로 나뉘어야 함');
  const bigGroup = result.products.find(p => p.own.postCount + p.competitor.postCount >= 5);
  const smallGroup = result.products.find(p => p.own.postCount + p.competitor.postCount < 5);
  assert.strictEqual(bigGroup.needsReview, true, '게시물 5건 이상 몰린 그룹은 확인 필요 표시가 있어야 함');
  assert.strictEqual(smallGroup.needsReview, false, '게시물 몇 건 안 되는 정상 그룹은 확인 필요 표시가 없어야 함');

  const manualResult = buildProductComparison([...many, ...few], [...manyComp, ...fewComp], ['likes', 'retweets'], 'text', ['retweets', 'likes'], [
    { pw: many.map(p => p.link), bh: manyComp.map(p => p.link), label: '수동상품(게시물 많음)' },
  ]);
  const manualProduct = manualResult.products.find(p => p.ip === '수동상품(게시물 많음)');
  assert.strictEqual(manualProduct.needsReview, false, '사람이 직접 확인하고 지정한 수동 매칭은 게시물이 많아도 확인 필요 표시를 달지 않아야 함');
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

// ── 리포트 "붙여넣기로 게시물 추가" 기능용: paste-parser.js + aggregate.js의 applyManualPosts ──
check('parsePastedPost: 트위터 게시물 상세페이지 복사 텍스트에서 본문/시각/지표 추출', () => {
  const raw = `📢[예약시작] 헌터x헌터 룩업

곤 프릭스🎣
https://mkt.shopping.naver.com/link/6a577cc1ba6bc43bdea0bb1f…

키르아 조르딕⚡
https://mkt.shopping.naver.com/link/6a577cc8149eb0351e13c131…

초회특전⭕️ (방석 SET)
https://mkt.shopping.naver.com/link/6a577cd000cc0d59ae193873…

📍발매: 27년 1월
📍예약판매 기간 내 5% 할인 캠페인 중!

#HxH #메가하우스공식스토어 #헌터헌터 #헌헌
이미지
이미지
이미지
이미지
오후 1:01 · 2026년 7월 16일
·
5.4만
 조회수

1

445

373

218

이 게시물에 답글을 달 수 있습니다.
@MegahouseStore 님에게 보내는 답글
메가하우스 공식 스토어
답글 게시하기
`;
  const result = parsePastedPost(raw);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.datetime, '2026-07-16T04:01:00.000Z', '오후 1:01(KST) → UTC 04:01로 변환돼야 함');
  assert.strictEqual(result.retweets, 445, '조회수 다음 두 번째 숫자(리트윗)');
  assert.strictEqual(result.likes, 373, '조회수 다음 세 번째 숫자(좋아요)');
  assert.strictEqual(result.replies, 1);
  assert.strictEqual(result.bookmarks, 218);
  assert.match(result.text, /헌터x헌터 룩업/);
  assert.ok(!result.text.includes('이미지'), '"이미지" 플레이스홀더 줄은 본문에서 제거돼야 함(오묶음 방지)');
  assert.ok(!result.text.includes('조회수'), '시각 줄 이후 내용은 본문에 안 들어가야 함');
});

check('parsePastedPost: 게시 시각 줄을 못 찾으면 실패 사유를 알려줘야 함', () => {
  const result = parsePastedPost('그냥 아무 텍스트\n더 있음');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /게시 시각/);
});

check('applyManualPosts: manual-posts.json 내용이 "(수동 추가)" 계정으로 own/competitors에 덧붙여져야 함(원본 불변)', () => {
  const own = [{ platform: 'twitter', account: 'own', posts: [{ link: 'a' }] }];
  const competitors = [{ platform: 'twitter', account: 'comp', posts: [{ link: 'b' }] }];
  const manualPosts = {
    twitter: { pw: [{ link: 'manual-pw-1' }], bh: [{ link: 'manual-bh-1' }] },
  };
  const result = applyManualPosts(own, competitors, manualPosts);
  assert.strictEqual(result.own.length, 2, '자사 쪽에 수동 추가 계정 1개가 더 생겨야 함');
  assert.strictEqual(result.own[1].account, '(수동 추가)');
  assert.deepStrictEqual(result.own[1].posts, [{ link: 'manual-pw-1' }]);
  assert.strictEqual(result.competitors[1].posts[0].link, 'manual-bh-1');
  assert.strictEqual(own.length, 1, '원본 배열은 그대로 유지돼야 함(불변)');
});

check('applyManualPosts로 합쳐진 게시물이 실제 파이프라인(buildComparisonReport)에서 평소처럼 자동 매칭돼야 함', () => {
  // 스크래퍼가 놓친 경쟁사 게시물을 사람이 직접 붙여넣기로 채워넣었을 때, 별도 매칭 지정 없이도
  // 이미 있던 자사 게시물과 자동으로 짝지어져야 한다는 게 이 기능의 핵심 전제 — 회귀 방지.
  const own = [{ platform: 'twitter', account: 'own', posts: [
    { link: 'https://x.com/own/1', datetime: '2026-07-16T01:00:00.000Z', likes: '10', retweets: '5', text: '[예약시작] 페르소나3 리로드 룩업\n\nhttps://m.site.naver.com/x' },
  ] }];
  const competitors = [{ platform: 'twitter', account: 'comp', posts: [] }]; // 스크래퍼가 놓쳐서 원래 0건
  const manualPosts = {
    twitter: { pw: [], bh: [{ link: 'https://x.com/comp/manual-1', datetime: '2026-07-16T02:00:00.000Z', likes: '3', retweets: '1', text: '✔️페르소나3 리로드 룩업\n\n🛍️바로가기 : https://mkt.shopping.naver.com/link/y' } ] },
  };
  const { own: mergedOwn, competitors: mergedCompetitors } = applyManualPosts(own, competitors, manualPosts);
  const report = buildComparisonReport({ startDate: '2026-07-16', endDate: '2026-07-16', own: mergedOwn, competitors: mergedCompetitors });
  const products = report.platforms.twitter.productComparison.products;
  assert.strictEqual(products.length, 1, '수동으로 채운 경쟁사 게시물이 자사 게시물과 자동으로 매칭돼야 함');
  assert.match(products[0].ip, /페르소나/);
  assert.strictEqual(products[0].competitor.total_likes, 3);
});

check('collect-account용 buildAccountReportHtml: 계정 단독 성과(비교 없음) 리포트 생성', () => {
  const posts = [
    { link: 'https://x.com/GoodsmileP/status/1', datetime: '2026-07-02T01:00:00.000Z', likes: '100', retweets: '10', text: '이벤트 안내' },
    { link: 'https://x.com/GoodsmileP/status/2', datetime: '2026-07-03T01:00:00.000Z', likes: '200', retweets: '30', text: '새 피규어 공개' },
  ];
  const summary = summarizeAccount({ platform: 'twitter', account: 'GoodsmileP', posts, fields: ['likes', 'retweets'] });
  assert.strictEqual(summary.postCount, 2);
  assert.strictEqual(summary.total_likes, 300);
  assert.strictEqual(summary.avg_likes, 150);

  const ranked = [...posts].sort((a, b) =>
    (parseCount(b.likes) + parseCount(b.retweets)) - (parseCount(a.likes) + parseCount(a.retweets))
  );
  assert.strictEqual(ranked[0].text, '새 피규어 공개', '(좋아요+리트윗) 합산 큰 게시물이 먼저 나와야 함');

  const html = buildAccountReportHtml({ handle: 'GoodsmileP', startDate: '2026-07-01', endDate: '2026-07-11', summary, rankedPosts: ranked });
  assert.match(html, /GoodsmileP/);
  assert.match(html, /새 피규어 공개/);
  assert.match(html, />300</, '총 좋아요 합계가 표시돼야 함');
});

check('collect-account용 buildPlaintextDump: plaintext 모드는 지표 없이 시각순(오래된 것부터) 본문만', () => {
  const chronologicalPosts = [
    { link: 'https://x.com/GoodsmileP/status/1', datetime: '2026-07-02T01:00:00.000Z', likes: '999', retweets: '999', text: '먼저 쓴 글' },
    { link: 'https://x.com/GoodsmileP/status/2', datetime: '2026-07-03T01:00:00.000Z', likes: '1', retweets: '1', text: '나중에 쓴 글' },
  ];
  const dump = buildPlaintextDump({ handle: 'GoodsmileP', startDate: '2026-07-01', endDate: '2026-07-11', chronologicalPosts });
  assert.ok(dump.indexOf('먼저 쓴 글') < dump.indexOf('나중에 쓴 글'), '좋아요/리트윗과 무관하게 오래된 게시물이 먼저 나와야 함');
  assert.ok(!/999/.test(dump), '지표(좋아요/리트윗 숫자)는 plaintext 출력에 없어야 함');
  assert.match(dump, /GoodsmileP/);
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
  assert.ok(html.includes('class="metric-diff">94:6</div>'),
    '리트윗/좋아요의 "N배" 캡션처럼 매출도 PW:BH 점유율("94:6")이 회색 작은 글씨로 병기돼야 함(513:30 → 반올림 94:6)');
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

check('stock-report: matchPwBhStockProducts — 같은 프랜차이즈의 단품/세트 변형이 섞여 있어도 진짜 짝을 찾아야 함(Union-Find 회귀 방지)', () => {
  // 실사용 버그: "블리치" 프랜차이즈 안에 "이치고 단품", "뱌쿠야 단품", "이치고+뱌쿠야 세트"가
  // 공존하는데, Union-Find 방식은 공통 키워드("룩업"은 라인이라 제외되지만 "블리치"류 공통
  // 토큰)만으로도 이들을 전부 한 그룹으로 묶어버려서(PW 2개 + BH 3개) 결국 하나도 매칭 못
  // 시켰음. 점수 기반 상호 최선 방식이면 "이치고 단품"끼리는 세트 상품보다 키워드 비중(자카드
  // 유사도)이 뚜렷하게 높아서 세트 상품과 안 헷갈리고 정확히 짝지어져야 함.
  const pw = [
    { productId: 'PW-이치고', name: '쿠로사키 이치고 룩업 l 블리치 (재판)' },
    { productId: 'PW-뱌쿠야', name: '쿠치키 뱌쿠야 룩업 l 블리치 (재판)' },
  ];
  const bh = [
    { productId: 'BH-이치고', name: '룩업 쿠로사키 이치고 천년혈전편 l 블리치 (재판) 27.01' },
    { productId: 'BH-뱌쿠야', name: '룩업 쿠치키 뱌쿠야 천년혈전편 l 블리치 (재판) 27.01' },
    { productId: 'BH-세트', name: '룩업 쿠로사키 이치고 천년혈전편 & 쿠치키 뱌쿠야 천년혈전편 일반품 세트 l 블리치 (재판) 27.01' },
  ];
  const pairs = matchPwBhStockProducts(pw, bh);
  const byPw = Object.fromEntries(pairs.map(p => [p.pw.productId, p.bh.productId]));
  assert.strictEqual(byPw['PW-이치고'], 'BH-이치고', '이치고 단품끼리 짝지어야 함(세트 상품과 헷갈리면 안 됨)');
  assert.strictEqual(byPw['PW-뱌쿠야'], 'BH-뱌쿠야', '뱌쿠야 단품끼리 짝지어야 함(세트 상품과 헷갈리면 안 됨)');
});

check('stock-report: matchPwBhStockProducts — 후보가 여럿이어도 점수 차이가 뚜렷하면(상호 최선) 짝지음', () => {
  // 실사용 데이터로 확인해보니 예전 Union-Find 방식은 매칭률이 너무 낮았음(51개 중 14쌍) —
  // 원인은 전이적 그룹화라 프랜차이즈명만 겹쳐도 서로 무관한 변형 상품들이 한 그룹으로
  // 뭉쳐서 "1:1 아니면 매칭 안 함" 규칙에 걸려 다 버려졌기 때문. 이제는 자카드 유사도
  // 점수로 "서로가 서로를 1순위로 고르는지"만 확인 — "재판"(BH와 키워드가 완전히 같음,
  // 점수 1.0)이 "초판"(부분적으로만 겹침, 점수 0.67)보다 뚜렷하게 높으므로 재판 쪽이
  // 확정 매칭돼야 함(모호함이 아니라 명백한 우위).
  const pw = [
    { productId: 'P1', name: '은혼 GEM 카무이 초판' },
    { productId: 'P2', name: '은혼 GEM 카무이 재판' },
  ];
  const bh = [{ productId: 'B1', name: '은혼 GEM 카무이 세컨드' }];
  const pairs = matchPwBhStockProducts(pw, bh);
  assert.strictEqual(pairs.length, 1, '점수가 뚜렷하게 높은 쪽(재판)은 확정 매칭돼야 함');
  assert.strictEqual(pairs[0].pw.productId, 'P2', '키워드가 BH와 완전히 겹치는 재판 쪽이 선택돼야 함');
});

check('stock-report: matchPwBhStockProducts — 점수가 완전히 동률이면(진짜 구분 불가) 매칭 안 시킴', () => {
  // 실제로 있었던 패턴: BH가 같은 상품을 "박스 구성"/"단품 랜덤" 두 SKU로 중복 등록해서,
  // PW의 단일 상품이 BH 두 후보 모두와 동점으로 겹침 — 이 경우는 점수로도 구분이 안 되니
  // 안전하게 매칭하지 않아야 함.
  const pw = [{ productId: 'P1', name: '은혼 룩업 미니어처 컬렉션 (4종세트)' }];
  const bh = [
    { productId: 'B1', name: '룩업 미니어처 컬렉션 은혼 (1BOX 4개 구성)' },
    { productId: 'B2', name: '룩업 미니어처 컬렉션 은혼 (4종 단품 랜덤)' },
  ];
  const pairs = matchPwBhStockProducts(pw, bh);
  assert.strictEqual(pairs.length, 0, 'BH 두 후보가 동점이면(박스/단품 구성 차이만) 어느 쪽인지 확정할 수 없으니 매칭하면 안 됨');
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

check('stock-report: 종합표 — 많이 팔린 순(PW+BH 합산) 정렬 누락 버그 수정 확인', () => {
  const history = {
    snapshots: [
      { takenAt: '2026-07-06T00:00:00.000Z', stores: {
        PW: [
          { productId: 'A1', name: '적게 팔린 상품 GEM 아무개', price: 10000, stock: 990 },
          { productId: 'B1', name: '많이 팔린 상품 GEM 누구', price: 10000, stock: 100 },
        ],
        BH: [
          { productId: 'A2', name: '적게 팔린 상품 GEM 아무개 세컨드', price: 10000, stock: 990 },
          { productId: 'B2', name: '많이 팔린 상품 GEM 누구 세컨드', price: 10000, stock: 100 },
        ],
      } },
    ],
  };
  const compared = buildStockComparison(history);
  const rows = buildIntegratedStockRows(compared);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].pw.name.includes('많이 팔린'), '판매추정치 합산이 더 큰 상품(초기한도-100 쪽)이 먼저 나와야 함');
  assert.ok(rows[1].pw.name.includes('적게 팔린'), '판매추정치 합산이 더 작은 상품이 뒤에 나와야 함');
});

check('stock-report: 종합표 추이 그래프 — 지수화 대신 총판매추정(개) 값을 그대로 그려야 함(사용자 피드백)', () => {
  // 사용자 피드백: "지수화 이런거 필요없고 그냥 총판매추정 개수만 가지고 꺾은선 만들면
  // 되잖아" — 재고 대신 총판매추정(estimateInitialCap 역산, 항상 0에서 우상향)을 그대로
  // 그리면 PW/BH 규모가 달라도(996개 vs 386개) 자체 축이 변화량에 비례해서 안 짓눌림.
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
  const html = renderStockSectionHtml(compared);
  assert.ok(html.includes('1개 판매추정(재고 9,999개)'), 'PW 첫 시점(10000-9999=1)이 툴팁에 나와야 함');
  assert.ok(html.includes('514개 판매추정(재고 9,486개)'), 'PW 마지막 시점(10000-9486=514)이 툴팁에 나와야 함');
  assert.ok(html.includes('100개 판매추정(재고 900개)'), 'BH 첫 시점(1000-900=100)이 툴팁에 나와야 함');
  assert.ok(html.includes('530개 판매추정(재고 470개)'), 'BH 마지막 시점(1000-470=530)이 툴팁에 나와야 함');
  assert.ok(html.includes('총판매추정(개) 추이'), '지수 대신 총판매추정 기준이라는 설명이 나와야 함');
  assert.ok(!html.includes('지수'), '지수화 문구가 더 이상 남아있으면 안 됨');
});

check('stock-report: 종합표 추이 그래프 — x축 라벨이 날짜/시각 2줄로 나뉘어야 함(같은 날 여러 스냅샷 구분)', () => {
  const history = {
    snapshots: [
      { takenAt: '2026-07-09T02:13:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9999 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 900 }],
      } },
      { takenAt: '2026-07-09T05:52:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9700 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 700 }],
      } },
      { takenAt: '2026-07-10T02:13:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9486 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 470 }],
      } },
    ],
  };
  const compared = buildStockComparison(history);
  const html = renderStockSectionHtml(compared);
  // KST = UTC+9: 07-09 02:13 → 07-09 11:13, 07-09 05:52 → 07-09 14:52
  assert.ok(html.includes('>11:13<') && html.includes('>14:52<'), '같은 날짜(07-09)에 찍힌 두 스냅샷이 시각으로 구분돼야 함');
  assert.ok(html.includes('>07-09<'), '날짜 라벨도 그대로 나와야 함(시각과 별도 줄)');
});

check('stock-report: 종합표 추이 그래프 — PW가 좁은 범위(994~999)에서만 움직여도, BH(변화 없음)와 축을 공유하지 않아서 눌리지 않고 보여야 함', () => {
  // 실사용 버그 리포트 재현: PW 총판매추정이 994~999개(범위 5)로 아주 좁게 움직이는데,
  // 이걸 BH(386개, 변화 없음)와 같은 축(0부터 시작)에 그리면 5개짜리 움직임이 전체 축의
  // 1%도 안 돼서 "일자"로 보임 — PW/BH를 각자 축을 가진 두 그래프(위아래)로 분리해서
  // 그 문제를 해결했는지, PW 선의 y좌표가 실제로 서로 달라지는지 확인.
  const history = {
    snapshots: [
      { takenAt: '2026-07-09T00:34:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9001 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 4614 }],
      } },
      { takenAt: '2026-07-09T00:53:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9006 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 4614 }],
      } },
      { takenAt: '2026-07-09T04:24:00.000Z', stores: {
        PW: [{ productId: 'X1', name: '은혼 GEM 카무이 ver.2', price: 220000, stock: 9004 }],
        BH: [{ productId: 'Y1', name: '은혼 GEM 카무이 세컨드', price: 210000, stock: 4614 }],
      } },
    ],
  };
  const compared = buildStockComparison(history);
  const html = renderStockSectionHtml(compared);
  const pathMatches = [...html.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  assert.strictEqual(pathMatches.length, 2, 'PW 패널 1개 + BH 패널 1개, 총 path 2개여야 함');
  const pwYs = [...pathMatches[0].matchAll(/[ML]-?[\d.]+,(-?[\d.]+)/g)].map(m => parseFloat(m[1]));
  assert.strictEqual(pwYs.length, 3, 'PW 점 3개(994~999개 대응)가 모두 그려져야 함');
  const spread = Math.max(...pwYs) - Math.min(...pwYs);
  assert.ok(spread > 20, `PW가 994~999개로만 움직여도(BH와 축을 공유하지 않으므로) 화면상 y좌표 차이가 눈에 띄어야 함(실측 ${spread.toFixed(1)}px)`);
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

// ── 3. 엑셀 저장: 같은 기간 재실행은 시트를 갱신(교체), 다른 기간은 누적 보존 ──
(async () => {
  const outPath = path.join(__dirname, 'verify-output', 'mock-report.xlsx');
  fs.rmSync(path.dirname(outPath), { recursive: true, force: true });

  const sheet1 = await saveReportToExcel(report, outPath);
  const sheet2 = await saveReportToExcel(report, outPath); // 같은 기간으로 재실행(테스트 중 반복 실행 시나리오)

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);

  check('엑셀: 같은 수집 기간으로 재실행하면 시트가 쌓이지 않고 갱신(교체)됨', () => {
    assert.strictEqual(sheet1, sheet2, '같은 기간이면 시트 이름도 같아야 함(같은 시트를 갱신하는 것)');
    assert.ok(wb.getWorksheet(sheet1), '갱신된 시트가 남아있어야 함');
    // 같은 기간을 2번 저장해도 요약 시트 + 상품별 비교 시트, 총 2개만 있어야 함(누적되면 안 됨)
    assert.strictEqual(wb.worksheets.length, 2);
  });

  const otherReport = { ...report, startDate: '2026-07-10', endDate: '2026-07-11' };
  const sheet3 = await saveReportToExcel(otherReport, outPath); // 다른 기간
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(outPath);

  check('엑셀: 다른 수집 기간은 별도 시트로 추가되고 기존 기간 시트는 그대로 보존됨', () => {
    assert.notStrictEqual(sheet1, sheet3, '기간이 다르면 시트 이름도 달라야 함');
    assert.ok(wb2.getWorksheet(sheet1), '이전 기간 시트가 지워지지 않고 남아있어야 함');
    assert.ok(wb2.getWorksheet(sheet3), '새 기간 시트도 존재해야 함');
    // 기간1(요약+상품별 2개) + 기간2(요약+상품별 2개) = 4개
    assert.strictEqual(wb2.worksheets.length, 4);
  });

  check('엑셀: 임시파일이 정리되고 최종 파일만 남음', () => {
    const files = fs.readdirSync(path.dirname(outPath));
    assert.deepStrictEqual(files, ['mock-report.xlsx']);
  });

  // ── renameWithRetry: 엑셀 파일이 다른 프로그램(엑셀 등)에 열려있어 rename이 EPERM으로
  // 실패하는 윈도우 환경을 재현 — 실제 fs.renameSync를 잠깐 흉내낸 함수로 바꿔치기해서 검증.
  const realRename = fs.renameSync;
  try {
    let calls = 0;
    fs.renameSync = () => {
      calls++;
      if (calls < 3) { const e = new Error('mock EPERM'); e.code = 'EPERM'; throw e; }
    };
    await renameWithRetry('from', 'to', { retries: 5, delayMs: 1 });
    check('엑셀: 파일이 잠깐 잠겨있어도(EPERM) 재시도해서 결국 성공함', () => {
      assert.strictEqual(calls, 3, '3번째 시도에서 성공해야 함');
    });
  } catch (e) {
    check('엑셀: 파일이 잠깐 잠겨있어도(EPERM) 재시도해서 결국 성공함', () => { throw e; });
  } finally {
    fs.renameSync = realRename;
  }

  try {
    fs.renameSync = () => { const e = new Error('mock EPERM'); e.code = 'EPERM'; throw e; };
    let thrown = null;
    try {
      await renameWithRetry('from', 'to', { retries: 3, delayMs: 1 });
    } catch (e) {
      thrown = e;
    }
    check('엑셀: 계속 잠겨있으면(EPERM) 재시도 다 써도 "파일을 닫아달라"는 안내 메시지로 실패함', () => {
      assert.ok(thrown, '에러가 던져져야 함');
      assert.match(thrown.message, /다른 프로그램.*열려있어서/);
      assert.match(thrown.message, /유실되지 않고/);
    });
  } finally {
    fs.renameSync = realRename;
  }

  // ── collect-account용 엑셀: excel.js와 같은 정책(같은 계정+기간이면 시트 교체, 다른
  // 기간은 별도 시트로 누적)이 account-report.xlsx에도 그대로 적용되는지 확인 ──
  const accountOutPath = path.join(__dirname, 'verify-output', 'account-report.xlsx');
  const accountPosts = [
    { link: 'https://x.com/GoodsmileP/status/1', datetime: '2026-07-02T01:00:00.000Z', likes: '10', retweets: '5', text: '게시물 A' },
    { link: 'https://x.com/GoodsmileP/status/2', datetime: '2026-07-03T01:00:00.000Z', likes: '30', retweets: '9', text: '게시물 B' },
  ];
  const sheetA1 = await saveAccountReportToExcel({ handle: 'GoodsmileP', startDate: '2026-07-01', endDate: '2026-07-11', posts: accountPosts }, accountOutPath);
  const sheetA2 = await saveAccountReportToExcel({ handle: 'GoodsmileP', startDate: '2026-07-01', endDate: '2026-07-11', posts: accountPosts }, accountOutPath);
  const sheetB = await saveAccountReportToExcel({ handle: 'GoodsmileP', startDate: '2026-07-12', endDate: '2026-07-19', posts: accountPosts }, accountOutPath);

  const ExcelJS2 = require('exceljs');
  const wbAcc = new ExcelJS2.Workbook();
  await wbAcc.xlsx.readFile(accountOutPath);

  check('account-excel: 같은 계정+같은 기간으로 재실행하면 시트가 쌓이지 않고 갱신됨', () => {
    assert.strictEqual(sheetA1, sheetA2, '같은 계정+기간이면 시트 이름도 같아야 함');
    assert.ok(wbAcc.getWorksheet(sheetA1));
  });
  check('account-excel: 다른 기간은 별도 시트로 추가되고 기존 시트는 보존됨', () => {
    assert.notStrictEqual(sheetA1, sheetB);
    assert.ok(wbAcc.getWorksheet(sheetA1), '이전 기간 시트가 남아있어야 함');
    assert.ok(wbAcc.getWorksheet(sheetB));
    assert.strictEqual(wbAcc.worksheets.length, 2, '계정별 시트 1개(엑셀은 요약+상품별처럼 나뉘지 않고 계정당 1개) x 기간 2개');
  });
  check('account-excel: 게시물이 (좋아요+리트윗) 합산 내림차순으로 들어감', () => {
    const ws = wbAcc.getWorksheet(sheetB);
    // 5행: 헤더, 6행: 1위(게시물 B, 30+9=39), 7행: 2위(게시물 A, 10+5=15)
    assert.strictEqual(ws.getCell('F6').value, '게시물 B');
    assert.strictEqual(ws.getCell('F7').value, '게시물 A');
  });

  const multilinePosts = [
    { link: 'https://x.com/GoodsmileP/status/3', datetime: '2026-07-13T01:00:00.000Z', likes: '1', retweets: '1', text: '1번째 줄\n2번째 줄\n3번째 줄' },
  ];
  const sheetC = await saveAccountReportToExcel({ handle: 'GoodsmileP', startDate: '2026-07-20', endDate: '2026-07-21', posts: multilinePosts }, accountOutPath);
  const wbAcc2 = new ExcelJS2.Workbook();
  await wbAcc2.xlsx.readFile(accountOutPath);
  check('account-excel: 본문의 줄바꿈이 공백으로 뭉개지지 않고 셀 안에 그대로 보존되며 wrapText가 켜져 있어야 함', () => {
    const ws = wbAcc2.getWorksheet(sheetC);
    const cell = ws.getCell('F6');
    assert.strictEqual(cell.value, '1번째 줄\n2번째 줄\n3번째 줄', '줄바꿈 문자가 그대로 남아있어야 함(공백으로 치환 금지)');
    assert.strictEqual(cell.alignment && cell.alignment.wrapText, true, 'wrapText가 켜져 있어야 실제로 줄바꿈되어 보임');
  });

  // ── compare-periods.js용: 여러 기간(공백 있어도 됨)을 나란히 비교하는 기능 ──
  const periodA = { label: '2026-06-10~2026-06-13', report: buildComparisonReport({
    startDate: '2026-06-10', endDate: '2026-06-13',
    own: [{ platform: 'twitter', account: 'own', posts: [
      { link: 'https://x.com/own/a1', datetime: '2026-06-10T01:00:00.000Z', likes: '100', retweets: '10', text: '기간A 게시물' },
    ] }],
    competitors: [{ platform: 'twitter', account: 'comp', posts: [
      { link: 'https://x.com/comp/a1', datetime: '2026-06-10T02:00:00.000Z', likes: '40', retweets: '4', text: '기간A 경쟁사 게시물' },
    ] }],
  }) };
  const periodB = { label: '2026-06-18~2026-06-22', report: buildComparisonReport({
    startDate: '2026-06-18', endDate: '2026-06-22',
    own: [{ platform: 'twitter', account: 'own', posts: [
      { link: 'https://x.com/own/b1', datetime: '2026-06-18T01:00:00.000Z', likes: '200', retweets: '20', text: '기간B 게시물 1' },
      { link: 'https://x.com/own/b2', datetime: '2026-06-19T01:00:00.000Z', likes: '300', retweets: '30', text: '기간B 게시물 2' },
    ] }],
    competitors: [{ platform: 'twitter', account: 'comp', posts: [
      { link: 'https://x.com/comp/b1', datetime: '2026-06-18T02:00:00.000Z', likes: '90', retweets: '9', text: '기간B 경쟁사 게시물' },
    ] }],
  }) };

  check('buildPeriodSummary: 기간마다 자사/경쟁사 총합이 따로 계산되고 나란히 놓여야 함', () => {
    const summary = buildPeriodSummary([periodA, periodB]);
    const tw = summary.find(s => s.platform === 'twitter');
    const postCountRow = tw.rows.find(r => r.key === 'postCount');
    assert.deepStrictEqual(postCountRow.cells[0], { own: 1, competitor: 1 }, '기간A: 자사 1건, 경쟁사 1건');
    assert.deepStrictEqual(postCountRow.cells[1], { own: 2, competitor: 1 }, '기간B: 자사 2건, 경쟁사 1건');
    const likesRow = tw.rows.find(r => r.key === 'total_likes');
    assert.strictEqual(likesRow.cells[0].own, 100);
    assert.strictEqual(likesRow.cells[1].own, 500, '기간B 자사 좋아요 합산(200+300)');
    assert.strictEqual(likesRow.cells[1].competitor, 90);
  });

  check('buildPeriodComparisonHtml: 기간 라벨과 지표가 표에 들어가야 함', () => {
    const html = buildPeriodComparisonHtml([periodA, periodB]);
    assert.match(html, /2026-06-10~2026-06-13/);
    assert.match(html, /2026-06-18~2026-06-22/);
    assert.match(html, /게시물 수/);
  });

  const periodExcelPath = path.join(__dirname, 'verify-output', 'period-comparison.xlsx');
  const sheetP1 = await savePeriodComparisonToExcel([periodA, periodB], periodExcelPath);
  const sheetP2 = await savePeriodComparisonToExcel([periodA, periodB], periodExcelPath);
  const periodC = { label: '2026-06-27~2026-06-30', report: periodB.report };
  const sheetP3 = await savePeriodComparisonToExcel([periodA, periodC], periodExcelPath);

  const ExcelJS3 = require('exceljs');
  const wbPeriod = new ExcelJS3.Workbook();
  await wbPeriod.xlsx.readFile(periodExcelPath);
  check('period-excel: 같은 기간 조합으로 재실행하면 시트가 쌓이지 않고 갱신됨', () => {
    assert.strictEqual(sheetP1, sheetP2, '같은 기간 조합이면 시트 이름도 같아야 함');
  });
  check('period-excel: 다른 기간 조합은 별도 시트로 추가되고 기존 시트는 보존됨', () => {
    assert.notStrictEqual(sheetP1, sheetP3);
    assert.ok(wbPeriod.getWorksheet(sheetP1), '이전 기간 조합 시트가 남아있어야 함');
    assert.ok(wbPeriod.getWorksheet(sheetP3));
  });

  console.log(`\n(생성된 검증용 엑셀 파일: ${outPath} — 직접 열어서 표 형태도 확인 가능)`);
  if (process.exitCode) {
    console.error('\n일부 검증 실패');
  } else {
    console.log('\n전체 검증 통과');
  }
})();
