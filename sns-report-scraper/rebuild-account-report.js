/**
 * collect-account.js가 저장해둔 원본 수집 캐시(reports/_account-<핸들>-last-collection.json)를
 * 다시 읽어서 엑셀/HTML/텍스트 출력만 재실행. 브라우저/세션 필요 없어서 몇 초 안에 끝남.
 *
 * 언제 쓰나: 이미 수집해둔 계정 데이터로 "이번엔 다른 형식으로도 보고 싶다"(예: plaintext로
 * 수집했는데 엑셀도 필요하다)고 할 때 — 재수집(collect-account.js, 몇 분) 없이 캐시만
 * 다시 읽어서 출력만 다시 만듦. 계정/기간을 바꿔서 새로 수집해야 하면 이 스크립트가 아니라
 * collect-account.js를 다시 돌려야 함.
 *
 * 사용법: node rebuild-account-report.js <핸들> [plaintext]
 *   예: node rebuild-account-report.js GoodsmileP
 *       node rebuild-account-report.js GoodsmileP plaintext
 */
const fs = require('fs');
const path = require('path');
const { summarizeAccount, parseCount } = require('./aggregate');
const { buildAccountReportHtml, buildPlaintextDump } = require('./account-report');
const { saveAccountReportToExcel } = require('./account-excel');
const { archiveAndGetPath } = require('./report-archive');

const OUTPUT_DIR = './reports';
const EXCEL_PATH = './reports/account-report.xlsx';

async function main() {
  const [handle, mode] = process.argv.slice(2);
  if (!handle || (mode && mode !== 'plaintext')) {
    console.error('❌ 사용법: node rebuild-account-report.js <핸들> [plaintext]');
    process.exit(1);
  }

  const cachePath = path.join(OUTPUT_DIR, `_account-${handle}-last-collection.json`);
  if (!fs.existsSync(cachePath)) {
    console.error(`❌ 캐시 파일이 없음: ${cachePath} — collect-account.js를 먼저 한 번 실행해서 수집해야 함`);
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  console.log(`📂 캐시 로드: @${cached.handle} ${cached.startDate}~${cached.endDate} (수집 시각: ${cached.collectedAt})`);

  const { startDate, endDate, posts } = cached;

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
