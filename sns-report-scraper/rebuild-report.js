/**
 * run-megahouse.js가 저장해둔 원본 수집 캐시(reports/_last-collection.json)를 다시 읽어서
 * 취합(aggregate.js)+엑셀 저장(excel.js)만 재실행. 브라우저/세션 필요 없어서 몇 초 안에 끝남.
 *
 * 언제 쓰나: aggregate.js/excel.js의 리포트 포맷만 고쳤을 때 — 매번 몇 분씩 걸리는
 * 재수집(run-megahouse.js) 없이 "아까 수집한 데이터로 리포트만 다시 뽑고 싶을 때" 사용.
 * 계정/기간을 바꿔서 새로 수집해야 하면 이 스크립트가 아니라 run-megahouse.js를 다시 돌려야 함.
 *
 * 사용법: node rebuild-report.js                        — 메가하우스(기본)
 *        node rebuild-report.js brand=goodsmile        — 굿스마일
 *        node rebuild-report.js stock=ratio            — 재고 비율/지수까지 리포트에 포함
 */
const fs = require('fs');
const path = require('path');
const { buildComparisonReport, applyManualPosts, filterCollectionsByKeyword } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');
const { buildStockComparison } = require('./stock-report');
const { archiveAndGetPath } = require('./report-archive');
const { prepareBrand, parseBrandArg } = require('./brand-config');

async function main() {
  const { brandKey, rest } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  const stockArg = rest.find(a => /^--?stock=(none|ratio)$/.test(a) || /^stock=(none|ratio)$/.test(a));
  const stockMode = stockArg ? stockArg.split('=')[1] : brand.defaultStockMode;
  // 같은 캐시로 키워드만 바꿔가며 몇 초 만에 다시 볼 수 있게 하는 것이 이 스크립트의 요점
  const keywordArg = rest.find(a => /^--?keyword=/.test(a) || /^keyword=/.test(a));
  const keyword = keywordArg ? keywordArg.slice(keywordArg.indexOf('=') + 1).trim() : '';
  console.log(`🏷️  브랜드: ${brand.label} (${brand.key})`);

  const CACHE_PATH = brand.paths.cache;
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`❌ [${brand.label}] 캐시 파일이 없음: ${path.relative(__dirname, CACHE_PATH)} — 먼저 한 번 수집해야 함(node run-megahouse.js brand=${brand.key} today)`);
    process.exit(1);
  }

  const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  console.log(`📂 캐시 로드: ${cached.startDate}~${cached.endDate} (수집 시각: ${cached.collectedAt})`);

  const manualMatches = fs.existsSync(brand.paths.manualMatches)
    ? JSON.parse(fs.readFileSync(brand.paths.manualMatches, 'utf-8'))
    : {};
  const ignorePosts = fs.existsSync(brand.paths.ignorePosts)
    ? JSON.parse(fs.readFileSync(brand.paths.ignorePosts, 'utf-8'))
    : {};
  const manualPosts = fs.existsSync(brand.paths.manualPosts)
    ? JSON.parse(fs.readFileSync(brand.paths.manualPosts, 'utf-8'))
    : {};
  const { own, competitors } = applyManualPosts(cached.own, cached.competitors, manualPosts);
  const ownFiltered = filterCollectionsByKeyword(own, keyword);
  const bhFiltered = filterCollectionsByKeyword(competitors, keyword);
  if (keyword) {
    console.log(`🔍 키워드 필터 '${keyword}' 적용 — 리포트에 넣을 게시물 PW ${ownFiltered.kept}건 / BH ${bhFiltered.kept}건 (제외 PW ${ownFiltered.excluded}건 · BH ${bhFiltered.excluded}건)`);
  }

  const report = buildComparisonReport({
    startDate: cached.startDate,
    endDate: cached.endDate,
    own: ownFiltered.collections,
    competitors: bhFiltered.collections,
    manualMatches,
    ignorePosts,
  });

  const sheetName = await saveReportToExcel(report, brand.paths.excel);
  console.log(`✅ 엑셀 저장 완료: ${brand.paths.excel} (시트: ${sheetName})`);

  // 재고는 stockMode가 'ratio'일 때만 리포트에 넣음(기본 'none' = SNS 전용 리포트).
  // 절대 수량은 대외비라 파일에 아예 안 심고, 넣을 때도 비율/지수만 넣음 — html-report.js 참고.
  const stockHistory = stockMode !== 'none' && fs.existsSync(brand.paths.stockHistory)
    ? JSON.parse(fs.readFileSync(brand.paths.stockHistory, 'utf-8'))
    : null;
  const stockComparison = stockHistory ? buildStockComparison(stockHistory) : null;

  const htmlOutputPath = archiveAndGetPath(brand.paths.htmlDir, brand.paths.htmlBaseName, 'html');
  saveHtmlReport(report, htmlOutputPath, stockComparison, {
    brandLabel: brand.label, stockMode,
    keyword, keywordExcluded: { pw: ownFiltered.excluded, bh: bhFiltered.excluded },
  });
  console.log(`✅ HTML 저장 완료: ${htmlOutputPath} (브라우저로 열어서 확인, 이전 파일은 ${path.relative(__dirname, brand.paths.htmlDir)}/old/로 이동됨)`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
