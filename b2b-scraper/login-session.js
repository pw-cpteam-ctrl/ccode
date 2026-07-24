/**
 * GoodSmile B2B 로그인 세션을 저장하는 반자동 도우미. 비밀번호를 코드/설정파일에 절대 넣지
 * 않는다 — 이 스크립트가 실제 크롬 창을 띄워주면, 그 창에서 사람이 직접 로그인(2단계인증/
 * 캡차가 있어도 그대로 통과)하고 터미널에서 엔터를 치면 그 시점 세션을 storageState로 저장한다.
 * 이후 scrape.js는 이 json 파일만 재사용 — 매번 다시 로그인할 필요 없음(세션 만료 전까지).
 *
 * ⚠️ 이 스크립트는 반드시 화면(GUI)이 있는 컴퓨터에서 실행해야 한다 — headless:false로 진짜
 * 브라우저 창을 띄우기 때문에, 원격/헤드리스 서버에서는 실행할 수 없다.
 *
 * 사용법: node login-session.js
 */
const path = require('path');
const readline = require('readline');
const { launchLoginBrowser, closeLoginBrowser } = require('./browser-stealth');

const CONFIG = {
  url: 'https://www.goodsmile.com/b2b/en/login',
  outputPath: path.join(__dirname, 'goodsmile-session.json'),
  profileDir: path.join(__dirname, 'chrome-profile', 'goodsmile'),
};

function waitForEnter(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const { context, browser } = await launchLoginBrowser(CONFIG.profileDir);
  const page = await context.newPage();
  await page.goto(CONFIG.url);

  console.log('\n브라우저 창에서 GoodSmile B2B 로그인을 직접 진행해줘 (2단계인증/보안 확인 있으면 그것도 그대로).');
  await waitForEnter('로그인 다 끝났으면 여기서 엔터 (그 시점 세션을 저장함): ');

  await context.storageState({ path: CONFIG.outputPath });
  console.log(`✅ 세션 저장 완료: ${CONFIG.outputPath}`);
  console.log('이제 "node recon.js <상품 목록 또는 상세 URL>"로 페이지 구조부터 확인해줘.');

  await closeLoginBrowser({ context, browser });
  process.exit(0);
}

main().catch(err => { console.error('❌ 실패:', err.message); process.exit(1); });
