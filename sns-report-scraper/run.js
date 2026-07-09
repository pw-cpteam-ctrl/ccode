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
 * 매번 돌릴 때 startDate/endDate만 그 달 리포트 기간에 맞게 바꿔주면 됨.
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
  const own = await collectAll(CONFIG.own);
  const competitors = await collectAll(CONFIG.competitors);

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

  const report = buildComparisonReport({
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    own,
    competitors,
    manualMatches,
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
