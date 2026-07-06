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
const { collectTwitter } = require('./twitter');
const { collectInstagram } = require('./instagram');
const { buildComparisonReport } = require('./aggregate');
const { saveReportToExcel } = require('./excel');

const CONFIG = {
  startDate: '2026-07-01',
  endDate: '2026-07-02',
  outputPath: './reports/sns-report.xlsx',

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

  const report = buildComparisonReport({
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    own,
    competitors,
  });

  const sheetName = await saveReportToExcel(report, CONFIG.outputPath);
  console.log(`✅ 저장 완료: ${CONFIG.outputPath} (시트: ${sheetName})`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
