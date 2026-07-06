/**
 * twitter.js / instagram.js를 계정 하나만 빠르게 테스트해보는 CLI 도구.
 * run.js 전체 CONFIG를 채우기 전에, 세션 파일이 실제로 통하는지 + 수집 결과가
 * 화면에 보이는 것과 맞는지 눈으로 확인하기 위한 용도. headless:false로 고정해서
 * 브라우저 창이 뜨는 걸 직접 보면서 확인할 수 있음.
 *
 * 사용법:
 *   node test-collect.js twitter <계정핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>
 *   node test-collect.js instagram <계정핸들> <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>
 *
 * 예시:
 *   node test-collect.js twitter elonmusk 2026-07-01 2026-07-02
 *
 * 세션 파일은 같은 폴더의 x-session.json / instagram-session.json을 사용함
 * (table-cookies-to-storage-state.js로 미리 만들어둔 파일).
 */
const { collectTwitter } = require('./twitter');
const { collectInstagram } = require('./instagram');

async function main() {
  const [, , platform, account, startDate, endDate] = process.argv;
  if (!platform || !account || !startDate || !endDate) {
    console.error('사용법: node test-collect.js <twitter|instagram> <계정핸들> <시작일> <종료일>');
    console.error('예시: node test-collect.js twitter elonmusk 2026-07-01 2026-07-02');
    process.exit(1);
  }
  if (platform !== 'twitter' && platform !== 'instagram') {
    console.error(`알 수 없는 플랫폼: ${platform} (twitter 또는 instagram만 가능)`);
    process.exit(1);
  }

  const sessionFile = platform === 'twitter' ? './x-session.json' : './instagram-session.json';
  const collector = platform === 'twitter' ? collectTwitter : collectInstagram;

  const posts = await collector({ account, sessionFile, startDate, endDate, headless: false });

  console.log(`\n총 ${posts.length}건 수집됨:\n`);
  console.log(JSON.stringify(posts, null, 2));
}

main().catch(err => {
  console.error('❌ 에러:', err);
  process.exit(1);
});
