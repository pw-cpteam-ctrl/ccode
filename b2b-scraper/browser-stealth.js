// sns-report-scraper/browser-stealth.js에서 가져온 로그인 브라우저 실행 도우미.
// B2B 업무포털은 인스타/X처럼 봇탐지가 엄격하지 않을 가능성이 높아서, 위장(applyStealth)은
// 옮기지 않고 "진짜 크롬을 전용 프로필로 띄우는" 핵심 launch 패턴만 가져왔다 — 나중에
// 로그인이 자꾸 자동화로 의심돼 막히면 그때 원본의 applyStealth()를 추가로 가져오면 된다.
const { chromium } = require('playwright');

const STEALTH_LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

const STEALTH_CONTEXT_OPTIONS = {
  viewport: { width: 1366, height: 768 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

// 이 컴퓨터에 깔린 진짜 크롬을 전용 프로필로 띄움 — 자동화 의심으로 로그인 거부되는 걸 줄여줌.
// 진짜 크롬이 없으면 내장 브라우저로 자동 대체.
async function launchLoginBrowser(profileDir) {
  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      args: STEALTH_LAUNCH_ARGS,
      viewport: STEALTH_CONTEXT_OPTIONS.viewport,
      locale: STEALTH_CONTEXT_OPTIONS.locale,
      timezoneId: STEALTH_CONTEXT_OPTIONS.timezoneId,
    });
    return { context, browser: null }; // browser=null이면 context.close()만으로 종료
  } catch (err) {
    console.log('이 컴퓨터에 설치된 크롬을 못 찾아서 내장 브라우저로 대신 실행함:', err.message);
    const browser = await chromium.launch({ headless: false, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext(STEALTH_CONTEXT_OPTIONS);
    return { context, browser };
  }
}

async function closeLoginBrowser({ context, browser }) {
  await Promise.race([
    browser ? browser.close() : context.close(),
    new Promise(resolve => setTimeout(resolve, 5000)), // 안 끝나면 강제 진행
  ]);
}

module.exports = { STEALTH_LAUNCH_ARGS, STEALTH_CONTEXT_OPTIONS, launchLoginBrowser, closeLoginBrowser };
