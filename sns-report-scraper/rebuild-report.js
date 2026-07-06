/**
 * run.js가 저장해둔 원본 수집 캐시(reports/_last-collection.json)를 다시 읽어서
 * 취합(aggregate.js)+엑셀 저장(excel.js)만 재실행. 브라우저/세션 필요 없어서 몇 초 안에 끝남.
 *
 * 언제 쓰나: aggregate.js/excel.js의 리포트 포맷만 고쳤을 때 — 매번 몇 분씩 걸리는
 * 재수집(run.js) 없이 "아까 수집한 데이터로 리포트만 다시 뽑고 싶을 때" 사용.
 * 계정/기간을 바꿔서 새로 수집해야 하면 이 스크립트가 아니라 run.js를 다시 돌려야 함.
 *
 * 사용법: node rebuild-report.js
 */
const fs = require('fs');
const { buildComparisonReport } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');

const CACHE_PATH = './reports/_last-collection.json';
const OUTPUT_PATH = './reports/sns-report.xlsx';
const HTML_OUTPUT_PATH = './reports/sns-report.html';
const MANUAL_MATCHES_PATH = './manual-matches.json';

async function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`❌ 캐시 파일이 없음: ${CACHE_PATH} — run.js를 먼저 한 번 실행해서 수집해야 함`);
    process.exit(1);
  }

  const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  console.log(`📂 캐시 로드: ${cached.startDate}~${cached.endDate} (수집 시각: ${cached.collectedAt})`);

  const manualMatches = fs.existsSync(MANUAL_MATCHES_PATH)
    ? JSON.parse(fs.readFileSync(MANUAL_MATCHES_PATH, 'utf-8'))
    : {};

  const report = buildComparisonReport({
    startDate: cached.startDate,
    endDate: cached.endDate,
    own: cached.own,
    competitors: cached.competitors,
    manualMatches,
  });

  const sheetName = await saveReportToExcel(report, OUTPUT_PATH);
  console.log(`✅ 엑셀 저장 완료: ${OUTPUT_PATH} (시트: ${sheetName})`);

  saveHtmlReport(report, HTML_OUTPUT_PATH);
  console.log(`✅ HTML 저장 완료: ${HTML_OUTPUT_PATH} (브라우저로 열어서 확인)`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
