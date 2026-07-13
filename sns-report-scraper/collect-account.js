/**
 * PW/BH 비교(run.js)와 무관하게, 임의의 X(트위터) 계정 핸들 하나만 넣으면 그 계정의
 * 게시물만 수집해서 순위/합계·평균을 보여주는 단독 성과 리포트. 세션은 기존
 * x-session.json을 그대로 재사용(내 계정으로 로그인한 상태에서 공개 게시물을 조회하는
 * 방식 — run.js가 BH를 수집할 때와 동일한 방식이라 새 로그인 필요 없음).
 *
 * 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD> [plaintext]
 *   예: node collect-account.js GoodsmileP 2026-07-01 2026-07-11
 *       node collect-account.js GoodsmileP 2026-07-01 2026-07-11 plaintext
 * plaintext를 마지막에 붙이면 텍스트 파일(.txt)엔 좋아요/리트윗 없이 본문만 시각순(오래된
 * 것부터)으로 나열됨 — "뭐라고 썼는지"만 보고 싶을 때 쓰는 모드. 모드와 무관하게 엑셀
 * (account-report.xlsx, 지표 포함 순위표)은 항상 같이 저장됨.
 *
 * run.js처럼 수집한 원본 게시물을 reports/_account-<핸들>-last-collection.json에 캐시해둠 —
 * 나중에 "이번엔 다른 출력 형식으로도 보고 싶다"고 할 때 재수집 없이
 * rebuild-account-report.js로 캐시만 다시 읽어서 출력만 다시 만들 수 있음.
 */
const fs = require('fs');
const path = require('path');
const { collectTwitter } = require('./twitter');
const { summarizeAccount, parseCount } = require('./aggregate');
const { buildAccountReportHtml, buildPlaintextDump } = require('./account-report');
const { saveAccountReportToExcel } = require('./account-excel');
const { archiveAndGetPath } = require('./report-archive');

const SESSION_FILE = './x-session.json';
const OUTPUT_DIR = './reports';
const EXCEL_PATH = './reports/account-report.xlsx';

function cachePath(handle) {
  return path.join(OUTPUT_DIR, `_account-${handle}-last-collection.json`);
}

async function writeOutputs({ handle, startDate, endDate, posts, mode }) {
  const sheetName = await saveAccountReportToExcel({ handle, startDate, endDate, posts }, EXCEL_PATH);
  console.log(`✅ 엑셀 저장 완료: ${EXCEL_PATH} (시트: ${sheetName})`);

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

async function main() {
  const [handle, startDate, endDate, mode] = process.argv.slice(2);
  if (!handle || !startDate || !endDate || (mode && mode !== 'plaintext')) {
    console.error('❌ 사용법: node collect-account.js <핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD> [plaintext]');
    process.exit(1);
  }

  console.log(`📥 @${handle} 트위터 게시물 수집 시작 (${startDate} ~ ${endDate})`);
  const posts = await collectTwitter({ account: handle, sessionFile: SESSION_FILE, startDate, endDate });
  console.log(`✅ 수집 완료: 게시물 ${posts.length}건`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(cachePath(handle), JSON.stringify({ handle, startDate, endDate, collectedAt: new Date().toISOString(), posts }, null, 2));
  console.log(`💾 원본 수집 데이터 캐시 저장: ${cachePath(handle)}`);

  await writeOutputs({ handle, startDate, endDate, posts, mode });
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
