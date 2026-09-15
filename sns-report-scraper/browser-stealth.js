/**
 * 인스타/X처럼 봇 탐지가 엄격한 사이트에서 "의심스러운 기기"로 낙인찍히는 걸 줄이기 위한
 * 브라우저 지문(fingerprint) 위장 모음. `navigator.webdriver` 하나만 숨겨서는 부족함 —
 * 플러그인 목록이 비어있거나, WebGL 정보가 실제 사람이 쓰는 브라우저와 다르거나, 화면 크기가
 * Playwright 기본값(1280x720)처럼 자동화 도구에서 흔한 값이거나 하는 것만으로도 별도로
 * 걸러질 수 있음. `login-session.js`(로그인 자체를 하는 브라우저)와 `instagram.js`/`twitter.js`
 * (그 세션을 재사용하는 브라우저) 전부 같은 위장을 써야 세션이 "의심스러운 기기"로 낙인 안
 * 찍힘 — 위장 내용을 한 곳에서만 관리하려고 공용 모듈로 분리.
 *
 * ⚠️ 이 위장이 로그인 유도 모달/재로그인 요구를 100% 없애준다는 보장은 없음 — 실제 계정으로
 * 검증 전까지는 "낙인찍힐 가능성을 낮추는 조치" 정도로 보고, 그래도 로그인 벽이 계속 뜨면
 * 세션 자체가 만료/플래그된 것일 수 있으니 `login-session.js`로 새로 로그인해서 세션을
 * 다시 만들어야 함(TROUBLESHOOTING-sns-report-scraper.md 참고).
 */
const { chromium } = require('playwright');

const STEALTH_LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

// 흔한 데스크톱 해상도 + 한국 로케일/시간대 — Playwright 기본 뷰포트(1280x720)는 자동화
// 도구에서 흔히 보이는 값이라 실제 사람이 쓰는 해상도에 가깝게 바꿈.
const STEALTH_CONTEXT_OPTIONS = {
  viewport: { width: 1366, height: 768 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

/**
 * 로그인 전용 브라우저를 띄움 — 이 컴퓨터에 깔린 진짜 크롬을, 이 프로그램만 쓰는 전용
 * 프로필 폴더(`profileDir`)로 열어줌. 사람이 평소 쓰는 크롬 프로필과는 폴더 자체가
 * 분리돼 있어서 서로 충돌하지 않음(둘 다 인스타/X한테는 "진짜 크롬"으로 보임).
 *
 * 진짜 크롬이 이 컴퓨터에 안 깔려 있으면(팀원 PC 등) 예전처럼 내장 브라우저로 자동
 * 대체함 — 이 경우 로그인 벽에 걸릴 가능성은 이전과 동일(악화되지 않음, 개선만 없음).
 *
 * @param {string} profileDir 이 로그인 전용으로 쓸 프로필 폴더 경로(계정/플랫폼별로 분리)
 * @returns {{ context: import('playwright').BrowserContext, browser: import('playwright').Browser|null }}
 *   browser가 null이면 persistent 모드(진짜 크롬) — context.close()만으로 종료됨.
 *   browser가 있으면 대체 모드(내장 브라우저) — browser.close()로 종료해야 함.
 */
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
    return { context, browser: null };
  } catch (err) {
    console.log('ℹ️ 이 컴퓨터에 설치된 크롬을 못 찾아서 내장 브라우저로 대신 실행함:', err.message);
    const browser = await chromium.launch({ headless: false, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext(STEALTH_CONTEXT_OPTIONS);
    return { context, browser };
  }
}

/** launchLoginBrowser()로 연 걸 안전하게 닫음 — 멈추는 경우 대비 제한 시간 두고 강제 진행 */
async function closeLoginBrowser({ context, browser }) {
  await Promise.race([
    browser ? browser.close() : context.close(),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
}

async function applyStealth(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 자동화 브라우저는 플러그인 목록이 비어있는 경우가 많음 — 실제 크롬처럼 채워둠.
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3].map(i => ({ name: `Plugin ${i}` })),
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en'],
    });

    // 실제 크롬에는 있는 window.chrome.runtime이 자동화 브라우저엔 없는 경우가 있음.
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};

    // permissions.query가 자동화 브라우저에서 실제와 다르게 동작하는 경우(예: notifications
    // 상태 불일치)를 흔히 탐지 신호로 씀 — 실제 Notification 권한 상태와 맞춤.
    if (window.navigator.permissions && window.navigator.permissions.query) {
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }

    // 헤드리스/자동화 환경의 WebGL 정보(예: "Google SwiftShader")는 실제 사람의 GPU와
    // 달라서 그 자체로 탐지 신호가 됨 — 흔한 데스크톱 GPU 값으로 대체.
    if (window.WebGLRenderingContext) {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, parameter);
      };
    }
  });
}

module.exports = {
  applyStealth,
  STEALTH_LAUNCH_ARGS,
  STEALTH_CONTEXT_OPTIONS,
  launchLoginBrowser,
  closeLoginBrowser,
};
