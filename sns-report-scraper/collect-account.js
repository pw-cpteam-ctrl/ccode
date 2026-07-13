/**
 * PW/BH 비교(run.js)와 무관하게, 임의의 X(트위터) 계정 핸들 하나만 넣으면 그 계정의
 * 게시물만 수집해서 순위/합계·평균을 보여주는 단독 성과 리포트. 세션은 기존
 * x-session.json을 그대로 재사용(내 계정으로 로그인한 상태에서 공개 게시물을 조회하는
 * 방식 — run.js가 BH를 수집할 때와 동일한 방식이라 새 로그인 필요 없음).
 *
 * 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD> [plaintext]
 *   예: node collect-account.js GoodsmileP 2026-07-01 2026-07-11
 *       node collect-account.js GoodsmileP 2026-07-01 2026-07-11 plaintext
 * plaintext를 마지막에 붙이면 좋아요/리트윗 같은 지표 없이, "뭐라고 썼는지"만 보고 싶을 때
 * 쓰는 모드 — 게시 시각순(오래된 것부터)으로 본문 텍스트만 .txt 파일에 그대로 나열함.
 */
const fs = require('fs');
const { collectTwitter } = require('./twitter');
const { summarizeAccount, parseCount } = require('./aggregate');
const { buildAccountReportHtml, buildPlaintextDump } = require('./account-report');
const { archiveAndGetPath } = require('./report-archive');

const SESSION_FILE = './x-session.json';
const OUTPUT_DIR = './reports';

async function main() {
  const [handle, startDate, endDate, mode] = process.argv.slice(2);
  if (!handle || !startDate || !endDate || (mode && mode !== 'plaintext')) {
    console.error('❌ 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD> [plaintext]');
    process.exit(1);
  }

  console.log(`📥 @${handle} 트위터 게시물 수집 시작 (${startDate} ~ ${endDate})`);
  const posts = await collectTwitter({ account: handle, sessionFile: SESSION_FILE, startDate, endDate });
  console.log(`✅ 수집 완료: 게시물 ${posts.length}건`);

  if (mode === 'plaintext') {
    const chronological = [...posts].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const txtPath = archiveAndGetPath(OUTPUT_DIR, `account-${handle}-text`, 'txt');
    fs.writeFileSync(txtPath, buildPlaintextDump({ handle, startDate, endDate, chronologicalPosts: chronological }));
    console.log(`✅ 텍스트 저장 완료: ${txtPath}`);
    return;
  }

  const summary = summarizeAccount({ platform: 'twitter', account: handle, posts, fields: ['likes', 'retweets'] });
  console.log(`   총 좋아요 ${summary.total_likes} (평균 ${summary.avg_likes ?? '-'}) · 총 리트윗 ${summary.total_retweets} (평균 ${summary.avg_retweets ?? '-'})`);

  const score = p => (parseCount(p.likes) || 0) + (parseCount(p.retweets) || 0);
  const ranked = [...posts].sort((a, b) => score(b) - score(a));

  const htmlPath = archiveAndGetPath(OUTPUT_DIR, `account-${handle}`, 'html');
  fs.writeFileSync(htmlPath, buildAccountReportHtml({ handle, startDate, endDate, summary, rankedPosts: ranked }));
  console.log(`✅ HTML 저장 완료: ${htmlPath}`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
