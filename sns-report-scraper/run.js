/**
 * 전체 실행 스크립트: 계정별 수집(twitter.js/instagram.js) → 취합(aggregate.js) → 엑셀 저장(excel.js)
 *
 * twitter.js, instagram.js는 실제 계정(megahousestore/megahouse_store)으로 검증 완료
 * (PLAN.md 참고). 아래 CONFIG는 원칙적으로 운용하는 자사/경쟁사 계정 고정 세팅 —
 * 예외적인 계정을 수집해야 할 땐 이 CONFIG를 건드리지 말고 그때그때 따로 요청.
 *
 * 경쟁사 계정도 sessionFile은 자사와 동일한 세션 파일을 씀 — 경쟁사 로그인이 아니라,
 * "내 계정으로 로그인한 상태에서 경쟁사의 공개 게시물을 조회"하는 방식이라서 정상임.
 *
 * 기간은 커맨드라인에서 YYYY-MM-DD 두 개(시작일 종료일)로 바로 지정 가능 — 안 주면
 * CONFIG.startDate/endDate 기본값 사용. endDate는 미포함(그 날짜 자정 이전까지)이라
 * 하루치만 보려면 다음날을 endDate로 줄 것(예: 7/10 하루 → 2026-07-10 2026-07-11).
 *
 * 사용법: node run.js                                — 트위터+인스타, CONFIG 기본 기간
 *        node run.js twitter                         — 트위터만, CONFIG 기본 기간
 *        node run.js instagram                       — 인스타만, CONFIG 기본 기간
 *        node run.js 2026-07-10 2026-07-11            — 트위터+인스타, 지정 기간(7/10 하루)
 *        node run.js twitter 2026-07-10 2026-07-11    — 트위터만, 지정 기간
 * 한쪽만 수집해도 캐시(cachePath)에 남아있던 다른 플랫폼 데이터는 보존됨(안 지워짐).
 */
const fs = require('fs');
const path = require('path');
const { collectTwitter } = require('./twitter');
const { collectInstagram } = require('./instagram');
const { buildComparisonReport } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');
const { buildStockComparison } = require('./stock-report');
const { HISTORY_PATH: STOCK_HISTORY_PATH } = require('./naver-stock-snapshot');
const { archiveAndGetPath } = require('./report-archive');

const CONFIG = {
  startDate: '2026-07-01',
  endDate: '2026-07-02',
  outputPath: './reports/sns-report.xlsx',
  // HTML은 매번 새로 만들 때 파일명에 생성 시각을 붙이고, 예전 파일은 reports/old/로 자동
  // 이동함(report-archive.js) — 과거 데이터 보존은 엑셀(outputPath, 시트 누적)이 따로 담당.
  htmlOutputDir: './reports',
  htmlOutputBaseName: 'sns-report',
  // 수집한 원본 게시물을 여기에 캐시해둠 — 리포트 포맷만 고칠 땐 재수집(몇 분) 없이
  // rebuild-report.js로 이 캐시만 다시 읽어서 몇 초 안에 엑셀만 새로 뽑을 수 있음.
  cachePath: './reports/_last-collection.json',
  // 자동 매칭이 놓친 게시물을 수동으로 짝지어주는 목록. "매칭 안 됨" 목록에서 번호(PW #n,
  // BH #n)로 지정해서 { pw: [링크], bh: [링크], label: "표시할 이름" } 형태로 추가하면 됨.
  manualMatchesPath: './manual-matches.json',
  // 상품이 아닌 공지/이벤트/쿠폰 게시물 — "매칭 안 됨" 목록에 안 보이게 걸러내지만, 계정
  // 총계(팔로워/게시물 지표)에는 그대로 포함됨. { twitter: {pw:[], bh:[링크,...]}, ... } 형태.
  ignorePostsPath: './ignore-posts.json',

  own: [
    { platform: 'twitter', account: 'megahousestore', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'megahouse_store', sessionFile: './instagram-session.json' },
  ],
  competitors: [
    { platform: 'twitter', account: 'megahouse_BH', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'megahouse_korea_dt_bh', sessionFile: './instagram-session.json' },
  ],
};

async function collectAll(accounts) {
  const collections = [];
  for (const acc of accounts) {
    const collector = acc.platform === 'twitter' ? collectTwitter : collectInstagram;
    const posts = await collector({
      account: acc.account,
      sessionFile: acc.sessionFile,
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      headless: acc.headless ?? false,
    });
    collections.push({ platform: acc.platform, account: acc.account, posts });
  }
  return collections;
}

async function main() {
  const args = process.argv.slice(2);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let platformFilter;
  const cliDates = [];
  for (const arg of args) {
    if (arg === 'twitter' || arg === 'instagram') platformFilter = arg;
    else if (DATE_RE.test(arg)) cliDates.push(arg);
    else {
      console.error(`❌ 사용법: node run.js [twitter|instagram] [시작일 종료일 (YYYY-MM-DD YYYY-MM-DD)]`);
      process.exit(1);
    }
  }
  if (cliDates.length === 1) {
    console.error('❌ 시작일/종료일 둘 다 줘야 함 (예: node run.js 2026-07-10 2026-07-11)');
    process.exit(1);
  }
  if (cliDates.length === 2) {
    [CONFIG.startDate, CONFIG.endDate] = cliDates;
    console.log(`📅 커맨드라인 기간 지정: ${CONFIG.startDate} ~ ${CONFIG.endDate} (미포함)`);
  }

  const ownToCollect = platformFilter ? CONFIG.own.filter(a => a.platform === platformFilter) : CONFIG.own;
  const competitorsToCollect = platformFilter ? CONFIG.competitors.filter(a => a.platform === platformFilter) : CONFIG.competitors;

  const ownFresh = await collectAll(ownToCollect);
  const competitorsFresh = await collectAll(competitorsToCollect);

  // 특정 플랫폼만 다시 수집했으면, 캐시에 남아있던 다른 플랫폼 데이터는 그대로 보존 —
  // 안 그러면 예전에 수집해둔 트위터/인스타 데이터가 통째로 사라짐(데이터 손실 방지 우선).
  const prevCache = fs.existsSync(CONFIG.cachePath) ? JSON.parse(fs.readFileSync(CONFIG.cachePath, 'utf-8')) : null;
  const mergeWithCache = (fresh, prevList) => {
    if (!platformFilter) return fresh;
    const kept = (prevList || []).filter(c => c.platform !== platformFilter);
    return [...kept, ...fresh];
  };
  const own = mergeWithCache(ownFresh, prevCache?.own);
  const competitors = mergeWithCache(competitorsFresh, prevCache?.competitors);

  // 원본 게시물 캐시 저장 — 재수집 없이 rebuild-report.js로 리포트만 다시 만들 수 있게
  fs.mkdirSync(path.dirname(CONFIG.cachePath), { recursive: true });
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify({
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    collectedAt: new Date().toISOString(),
    own,
    competitors,
  }, null, 2));
  console.log(`💾 원본 수집 데이터 캐시 저장: ${CONFIG.cachePath}`);

  const manualMatches = fs.existsSync(CONFIG.manualMatchesPath)
    ? JSON.parse(fs.readFileSync(CONFIG.manualMatchesPath, 'utf-8'))
    : {};
  const ignorePosts = fs.existsSync(CONFIG.ignorePostsPath)
    ? JSON.parse(fs.readFileSync(CONFIG.ignorePostsPath, 'utf-8'))
    : {};

  const report = buildComparisonReport({
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    own,
    competitors,
    manualMatches,
    ignorePosts,
  });

  const sheetName = await saveReportToExcel(report, CONFIG.outputPath);
  console.log(`✅ 엑셀 저장 완료: ${CONFIG.outputPath} (시트: ${sheetName})`);

  const stockHistory = fs.existsSync(STOCK_HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(STOCK_HISTORY_PATH, 'utf-8'))
    : null;
  const stockComparison = stockHistory ? buildStockComparison(stockHistory) : null;

  const htmlOutputPath = archiveAndGetPath(CONFIG.htmlOutputDir, CONFIG.htmlOutputBaseName, 'html');
  saveHtmlReport(report, htmlOutputPath, stockComparison);
  console.log(`✅ HTML 저장 완료: ${htmlOutputPath} (브라우저로 열어서 확인, 이전 파일은 reports/old/로 이동됨)`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
