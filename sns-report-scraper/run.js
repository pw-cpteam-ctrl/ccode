/**
 * 전체 실행 스크립트: 계정별 수집(twitter.js/instagram.js) → 취합(aggregate.js) → 엑셀 저장(excel.js)
 *
 * ⚠️ 현재 상태: 아래 CONFIG는 예시용 placeholder. 실제로 돌리려면
 *   1) 로그인 세션 파일(x-session.json / instagram-session.json)을 PLAN.md 안내대로 생성해서 채우고
 *   2) 자사/경쟁사 실제 계정 핸들로 교체해야 함.
 * twitter.js, instagram.js는 아직 실제 세션으로 검증되지 않은 초안이므로,
 * 처음 실행할 땐 headless:false로 브라우저 창을 직접 보면서 확인 권장.
 * (특히 instagram.js의 좋아요/댓글 좌표 파싱은 계정마다 레이아웃이 다를 수 있음)
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
    { platform: 'twitter', account: 'YOUR_BRAND_TWITTER', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'YOUR_BRAND_INSTAGRAM', sessionFile: './instagram-session.json' },
  ],
  competitors: [
    { platform: 'twitter', account: 'COMPETITOR_A_TWITTER', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'COMPETITOR_A_INSTAGRAM', sessionFile: './instagram-session.json' },
    // 경쟁사 계정 여러 개면 이렇게 계속 추가
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
