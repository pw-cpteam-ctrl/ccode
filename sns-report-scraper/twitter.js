const { chromium } = require('playwright');

/**
 * X(트위터) 프로필 게시물 수집 — 예전 수동 방식(브라우저 JS 주입 + 대화창 누적)을
 * Playwright 스크립트로 이식한 초안. 아직 실제 로그인 세션으로 테스트 못 해봤음.
 *
 * @param {object} opts
 * @param {string} opts.account     계정 핸들 (예: 'megahouse_pr', @ 없이)
 * @param {string} opts.sessionFile Playwright storageState 파일 경로
 * @param {string} opts.startDate   'YYYY-MM-DD' (KST 기준, 포함)
 * @param {string} opts.endDate     'YYYY-MM-DD' (KST 기준, 포함)
 * @param {boolean} [opts.headless] 기본 false — 처음엔 눈으로 확인 추천
 */
async function collectTwitter({ account, sessionFile, startDate, endDate, headless = false }) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: sessionFile });
  const page = await context.newPage();
  const startTime = new Date();

  // KST 자정 기준 범위를 UTC로 변환 (트위터 datetime은 UTC)
  const rangeStartUTC = new Date(`${startDate}T00:00:00+09:00`);
  const rangeEndUTC = new Date(`${endDate}T23:59:59+09:00`);

  await page.goto(`https://x.com/${account}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    window._tweetData = [];
    window._seenLinks = new Set();
  });

  async function collectOnce() {
    return page.evaluate(() => {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
        const timeEl = article.querySelector('time');
        const linkEl = article.querySelector('a[href*="/status/"]');
        if (!timeEl || !linkEl) return;
        const link = 'https://x.com' + linkEl.getAttribute('href');
        if (window._seenLinks.has(link)) return;

        const rtEl = article.querySelector('[data-testid="retweet"] span[data-testid="app-text-transition-container"]');
        const likeEl = article.querySelector('[data-testid="like"] span[data-testid="app-text-transition-container"]');
        const textEl = article.querySelector('[data-testid="tweetText"]');

        window._seenLinks.add(link);
        window._tweetData.push({
          link,
          datetime: timeEl.getAttribute('datetime'),
          retweets: rtEl ? rtEl.innerText : '0',
          likes: likeEl ? likeEl.innerText : '0',
          text: textEl ? textEl.innerText : '',
        });
      });
    });
  }

  let stop = false;
  let retries = 0;
  const MAX_RETRIES = 5;

  while (!stop) {
    try {
      await collectOnce();
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(2500);

      const all = await page.evaluate(() => window._tweetData);
      if (all.length === 0) { retries++; if (retries >= MAX_RETRIES) stop = true; continue; }

      const oldest = all.reduce((min, t) => {
        const d = new Date(t.datetime);
        return d < min ? d : min;
      }, new Date());

      if (oldest < rangeStartUTC) stop = true;
      retries = 0;
    } catch (e) {
      // 블랙스크린/CDP timeout 대응 — 대기 후 재시도
      retries++;
      console.warn(`[twitter] 재시도 ${retries}/${MAX_RETRIES}: ${e.message}`);
      await page.waitForTimeout(3000 + retries * 1000);
      if (retries >= MAX_RETRIES) stop = true;
    }
  }

  // RT/좋아요 0으로 잡혔던 항목 재수집 시도 (렌더링 지연 대응)
  await collectOnce();

  const allTweets = await page.evaluate(() => window._tweetData);
  const filtered = allTweets.filter(t => {
    const d = new Date(t.datetime);
    return d >= rangeStartUTC && d <= rangeEndUTC;
  });

  const endTime = new Date();
  console.log(`[twitter:${account}] 수집 완료: ${((endTime - startTime) / 1000 / 60).toFixed(1)}분, ${filtered.length}건`);

  await browser.close();
  return filtered;
}

module.exports = { collectTwitter };
