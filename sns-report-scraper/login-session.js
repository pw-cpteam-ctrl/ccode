/**
 * 세션 파일(x-session.json/instagram-session.json) 만료됐을 때 다시 만드는 반자동 도우미.
 * 지금까지 하던 "F12 → Application → Cookies 표 전체선택/복사 → table-cookies-to-storage-state.js
 * 변환" 과정을 없애고, Playwright가 브라우저 창을 띄워주면 거기서 로그인만(2단계인증 있으면
 * 그것도 그대로) 하고 터미널에서 엔터 치면 그 시점 세션을 storageState로 바로 저장해줌.
 *
 * 로그인 자체는 사용자가 실제 브라우저 창에서 직접 하는 것 — 자동입력/자동로그인이 아님.
 * (자동 로그인은 메타/X의 봇 탐지에 더 잘 걸려서 오히려 세션이 더 자주 끊길 위험이 있음.
 * 지금처럼 "사람이 직접 로그인한 세션 재사용" 방식이 봇 탐지 관점에서 더 안전 — PLAN.md 참고)
 *
 * 사용법:
 *   node login-session.js instagram
 *   node login-session.js twitter
 */
const readline = require('readline');
const { chromium } = require('playwright');
const { applyStealth, STEALTH_LAUNCH_ARGS, STEALTH_CONTEXT_OPTIONS } = require('./browser-stealth');

const PLATFORMS = {
  instagram: { url: 'https://www.instagram.com/accounts/login/', outputPath: './instagram-session.json' },
  twitter: { url: 'https://x.com/login', outputPath: './x-session.json' },
};

function waitForEnter(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const platform = process.argv[2];
  const config = PLATFORMS[platform];
  if (!config) {
    console.error(`❌ 사용법: node login-session.js <${Object.keys(PLATFORMS).join('|')}>`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, args: STEALTH_LAUNCH_ARGS });
  const context = await browser.newContext(STEALTH_CONTEXT_OPTIONS);
  // 로그인 자체는 사람이 직접 하지만, 브라우저가 Playwright로 뜬 것 자체를 자동화로 감지하면
  // 이 세션에 처음부터 "의심스러운 기기" 낙인이 찍혀서 나중에 twitter.js/instagram.js에서
  // 정상 쿠키인데도 재로그인을 요구하는 원인이 될 수 있음 — instagram.js와 같은 위장 적용
  // (browser-stealth.js).
  await applyStealth(context);
  const page = await context.newPage();
  await page.goto(config.url);

  console.log(`\n브라우저 창에서 ${platform} 로그인을 직접 진행해줘 (2단계인증/보안 확인 있으면 그것도 그대로 진행).`);
  await waitForEnter('로그인 다 끝났으면 여기서 엔터 눌러줘 (로그인된 상태에서 세션을 저장함): ');

  await context.storageState({ path: config.outputPath });
  console.log(`✅ 세션 저장 완료: ${config.outputPath}`);

  await browser.close();
}

main().catch(err => {
  console.error('❌ 실패:', err.message);
  process.exit(1);
});
