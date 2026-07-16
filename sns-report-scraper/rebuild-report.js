/**
 * run-megahouse.js가 저장해둔 원본 수집 캐시(reports/_last-collection.json)를 다시 읽어서
 * 취합(aggregate.js)+엑셀 저장(excel.js)만 재실행. 브라우저/세션 필요 없어서 몇 초 안에 끝남.
 *
 * 언제 쓰나: aggregate.js/excel.js의 리포트 포맷만 고쳤을 때 — 매번 몇 분씩 걸리는
 * 재수집(run-megahouse.js) 없이 "아까 수집한 데이터로 리포트만 다시 뽑고 싶을 때" 사용.
 * 계정/기간을 바꿔서 새로 수집해야 하면 이 스크립트가 아니라 run-megahouse.js를 다시 돌려야 함.
 *
 * 사용법: node rebuild-report.js
 */
const fs = require('fs');
const { buildComparisonReport } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');
const { buildStockComparison } = require('./stock-report');
const { HISTORY_PATH: STOCK_HISTORY_PATH } = require('./naver-stock-snapshot');
const { archiveAndGetPath } = require('./report-archive');

const CACHE_PATH = './reports/_last-collection.json';
const OUTPUT_PATH = './reports/sns-report.xlsx';
const HTML_OUTPUT_DIR = './reports';
const HTML_OUTPUT_BASE_NAME = 'sns-report';
const MANUAL_MATCHES_PATH = './manual-matches.json';
const IGNORE_POSTS_PATH = './ignore-posts.json';

async function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`❌ 캐시 파일이 없음: ${CACHE_PATH} — run-megahouse.js를 먼저 한 번 실행해서 수집해야 함`);
    process.exit(1);
  }

  const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  console.log(`📂 캐시 로드: ${cached.startDate}~${cached.endDate} (수집 시각: ${cached.collectedAt})`);

  const manualMatches = fs.existsSync(MANUAL_MATCHES_PATH)
    ? JSON.parse(fs.readFileSync(MANUAL_MATCHES_PATH, 'utf-8'))
    : {};
  const ignorePosts = fs.existsSync(IGNORE_POSTS_PATH)
    ? JSON.parse(fs.readFileSync(IGNORE_POSTS_PATH, 'utf-8'))
    : {};

  const report = buildComparisonReport({
    startDate: cached.startDate,
    endDate: cached.endDate,
    own: cached.own,
    competitors: cached.competitors,
    manualMatches,
    ignorePosts,
  });

  const sheetName = await saveReportToExcel(report, OUTPUT_PATH);
  console.log(`✅ 엑셀 저장 완료: ${OUTPUT_PATH} (시트: ${sheetName})`);

  // 재고 스냅샷 히스토리가 있으면(naver-stock-snapshot.js로 쌓은 것) HTML 맨 아래에 붙임 —
  // 없으면 조용히 건너뜀(선택 기능이라 없어도 리포트 생성엔 지장 없음).
  const stockHistory = fs.existsSync(STOCK_HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(STOCK_HISTORY_PATH, 'utf-8'))
    : null;
  const stockComparison = stockHistory ? buildStockComparison(stockHistory) : null;

  const htmlOutputPath = archiveAndGetPath(HTML_OUTPUT_DIR, HTML_OUTPUT_BASE_NAME, 'html');
  saveHtmlReport(report, htmlOutputPath, stockComparison);
  console.log(`✅ HTML 저장 완료: ${htmlOutputPath} (브라우저로 열어서 확인, 이전 파일은 reports/old/로 이동됨)`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
