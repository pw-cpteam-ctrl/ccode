// 전용 크롬 프로필로 세션(로그인)을 "기억"시키는 도우미.
// playwright-core + channel:'chrome' 사용 — 팀원 PC에 이미 깔린 진짜 크롬을 그대로 쓰므로
// playwright 패키지처럼 브라우저를 별도로 300MB 다운로드할 필요가 없다 (최초 npm install이 가벼워짐).
const { chromium } = require('playwright-core');

const CONTEXT_OPTIONS = {
  viewport: { width: 1366, height: 768 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

// profileDir 폴더가 로그인 쿠키를 며칠간(쿠키 수명만큼) 기억한다 — 세션이 살아있으면 매번
// 다시 로그인할 필요가 없다. 세션이 없거나 만료되어 loginUrlPattern에 걸리는 페이지로
// 튕기면, 사람이 그 창에서 직접 로그인할 때까지 기다렸다가(엔터 불필요, URL 변화로 자동 감지)
// startUrl로 다시 이동해서 돌려준다.
async function openPersistentSession(profileDir, { startUrl, loginUrlPattern, onWaitingForLogin }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false, // 로그인이 필요할 수 있으므로 항상 창을 보여줌
    viewport: CONTEXT_OPTIONS.viewport,
    locale: CONTEXT_OPTIONS.locale,
    timezoneId: CONTEXT_OPTIONS.timezoneId,
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(startUrl, { waitUntil: 'networkidle' });

  if (loginUrlPattern.test(page.url())) {
    if (onWaitingForLogin) onWaitingForLogin();
    // 로그인 성공 시 loginUrlPattern을 벗어난다는 가정 — 실제 로그인 후 이동 URL을 보고 조정할 것.
    await page.waitForURL(u => !loginUrlPattern.test(u.toString()), { timeout: 5 * 60 * 1000 });
    await page.goto(startUrl, { waitUntil: 'networkidle' });
  }

  return { context, page };
}

module.exports = { CONTEXT_OPTIONS, openPersistentSession };
