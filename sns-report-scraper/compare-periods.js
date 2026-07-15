/**
 * 여러 기간을 따로 수집한 뒤(run.js를 각 기간마다 실행하면 reports/period-cache/에 자동
 * 저장됨) 그 기간들을 한 화면에 나란히 비교하는 리포트를 만듦. 재수집 없이 캐시만 읽어서
 * 몇 초 안에 끝남.
 *
 * 이어져 있는 기간(공백 없음)을 한 번에 보고 싶으면 이 스크립트가 아니라 run.js에 전체
 * 기간을 통으로 넣어서 한 번에 수집하는 게 더 간단함(같은 상품 게시물은 어차피 자동으로
 * 합산됨). 이 스크립트는 기간 사이에 공백(게시글 없는 날)이 있어서 따로따로 수집한
 * 경우를 나란히 비교하고 싶을 때 씀.
 *
 * 사용법: node compare-periods.js <시작일_종료일> <시작일_종료일> ... (2개 이상)
 *   예: node compare-periods.js 2026-06-10_2026-06-13 2026-06-18_2026-06-22 2026-06-27_2026-06-30
 * 각 값은 run.js 실행 시 자동 저장된 reports/period-cache/<시작일_종료일>.json 파일명과 같아야 함
 * (즉 run.js를 그 기간으로 먼저 한 번 실행해서 수집해둔 상태여야 함).
 *
 * 지금은 자사/경쟁사 전체 합계만 기간별로 비교함 — 상품별로 기간마다 어떻게 변했는지 보는
 * 기능은 다음 단계(오묶음 리스크 논의 후 진행).
 */
const fs = require('fs');
const path = require('path');
const { buildComparisonReport } = require('./aggregate');
const { buildPeriodComparisonHtml } = require('./period-comparison');
const { savePeriodComparisonToExcel } = require('./period-excel');
const { archiveAndGetPath } = require('./report-archive');

const PERIOD_CACHE_DIR = './reports/period-cache';
const OUTPUT_DIR = './reports';
const EXCEL_PATH = './reports/period-comparison.xlsx';

function loadPeriod(id) {
  const cachePath = path.join(PERIOD_CACHE_DIR, `${id}.json`);
  if (!fs.existsSync(cachePath)) {
    console.error(
      `❌ 캐시 없음: ${cachePath}\n` +
      `   "${id}" 기간을 run.js로 아직 수집 안 한 것 같음 — 먼저 "node run.js ${id.replace('_', ' ')}"로 수집해야 함`
    );
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const report = buildComparisonReport(cached);
  return { label: `${cached.startDate}~${cached.endDate}`, report };
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length < 2) {
    console.error('❌ 사용법: node compare-periods.js <시작일_종료일> <시작일_종료일> ... (2개 이상)');
    console.error('   예: node compare-periods.js 2026-06-10_2026-06-13 2026-06-18_2026-06-22');
    process.exit(1);
  }

  const periods = ids.map(loadPeriod);
  console.log(`📂 ${periods.length}개 기간 캐시 로드: ${periods.map(p => p.label).join(' / ')}`);

  const sheetName = await savePeriodComparisonToExcel(periods, EXCEL_PATH);
  console.log(`✅ 엑셀 저장 완료: ${EXCEL_PATH} (시트: ${sheetName})`);

  const htmlPath = archiveAndGetPath(OUTPUT_DIR, 'period-comparison', 'html');
  fs.writeFileSync(htmlPath, buildPeriodComparisonHtml(periods));
  console.log(`✅ HTML 저장 완료: ${htmlPath}`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
