/**
 * PW/BH 비교(run.js)와 무관하게, 임의의 X(트위터) 계정 핸들 하나만 넣으면 그 계정의
 * 게시물만 수집해서 순위/합계·평균을 보여주는 단독 성과 리포트. 세션은 기존
 * x-session.json을 그대로 재사용(내 계정으로 로그인한 상태에서 공개 게시물을 조회하는
 * 방식 — run.js가 BH를 수집할 때와 동일한 방식이라 새 로그인 필요 없음).
 *
 * 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>
 *   예: node collect-account.js GoodsmileP 2026-07-01 2026-07-11
 */
const fs = require('fs');
const { collectTwitter } = require('./twitter');
const { summarizeAccount, parseCount } = require('./aggregate');
const { buildAccountReportHtml } = require('./account-report');
const { archiveAndGetPath } = require('./report-archive');

const SESSION_FILE = './x-session.json';
const HTML_OUTPUT_DIR = './reports';

async function main() {
  const [handle, startDate, endDate] = process.argv.slice(2);
  if (!handle || !startDate || !endDate) {
    console.error('❌ 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>');
    process.exit(1);
  }

  console.log(`📥 @${handle} 트위터 게시물 수집 시작 (${startDate} ~ ${endDate})`);
  const posts = await collectTwitter({ account: handle, sessionFile: SESSION_FILE, startDate, endDate });

  const summary = summarizeAccount({ platform: 'twitter', account: handle, posts, fields: ['likes', 'retweets'] });
  console.log(`✅ 수집 완료: 게시물 ${summary.postCount}건`);
  console.log(`   총 좋아요 ${summary.total_likes} (평균 ${summary.avg_likes ?? '-'}) · 총 리트윗 ${summary.total_retweets} (평균 ${summary.avg_retweets ?? '-'})`);

  const score = p => (parseCount(p.likes) || 0) + (parseCount(p.retweets) || 0);
  const ranked = [...posts].sort((a, b) => score(b) - score(a));

  const htmlPath = archiveAndGetPath(HTML_OUTPUT_DIR, `account-${handle}`, 'html');
  fs.writeFileSync(htmlPath, buildAccountReportHtml({ handle, startDate, endDate, summary, rankedPosts: ranked }));
  console.log(`✅ HTML 저장 완료: ${htmlPath}`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
