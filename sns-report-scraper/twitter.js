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
    window._loggedSkips = new Set(); // 같은 링크로 스킵 사유를 여러 번 안 찍기 위한 중복 방지용
  });

  // 페르소나3 리로드 게시물처럼 "이유 없이 누락되는" 사례가 반복돼서, 추측으로 또 고치는 대신
  // 실제로 어느 조건에서 걸러지는지 콘솔에 그대로 남기게 함(원인 확정 전까지 임시 계측용).
  // skip 사유가 하나도 안 찍히는데 그 트윗이 여전히 안 잡히면, 이 필터들 문제가 아니라
  // X가 그 카드를 querySelectorAll이 도는 시점에 아예 DOM에 렌더링을 안 해준 것 — 원인이
  // 완전히 다른 범주(가상 스크롤 타이밍)라는 뜻.
  async function collectOnce() {
    const skipped = await page.evaluate(() => {
      const skippedThisTick = [];
      document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
        const timeEl = article.querySelector('time');
        const linkEl = article.querySelector('a[href*="/status/"]');
        if (!timeEl || !linkEl) return;
        const link = 'https://x.com' + linkEl.getAttribute('href');
        if (window._seenLinks.has(link)) return;
        if (window._loggedSkips.has(link)) return;

        // 리트윗/고정 게시물엔 socialContext 라벨("OO님이 리트윗함", "고정된 게시물")이 붙는데,
        // 이 경우 <time>이 "지금 이 계정이 리트윗한 시점"이 아니라 "원본 게시물이 처음 올라간
        // 날짜"를 그대로 보여줌. 그래서 오늘 옛날 글을 리트윗하면 실제로는 최신 타임라인인데도
        // 날짜만 보면 옛날 글처럼 보여서, 기간 시작일 판단 로직(아래)이 스크롤을 시작하기도
        // 전에 "범위 벗어남"으로 착각해 멈춰버림. 좋아요/RT수도 이 계정 자신의 성과가 아니라
        // 원본 게시물 것이라 집계에도 안 맞음 — 그래서 리트윗/고정 게시물은 통째로 제외.
        //
        // 단, 여기서 seenLinks에 추가하면 안 됨: 자사의 예전 주요 게시물을 "다시 리트윗"하면
        // 피드 맨 위에 이 부스트된 카드로 먼저 마주치는데, 이때 링크를 seenLinks에 넣어버리면
        // 스크롤이 내려가서 이 게시물의 원래(자연스러운, socialContext 없는) 위치에 도달했을 때도
        // "이미 처리함"으로 오인해 두 번 다 놓쳐버림 — 실제로 이 버그로 매출 1위 상품의 원본
        // 게시물이 통째로 누락된 사례를 발견함. seenLinks에 안 넣어도 이 카드는 스크롤 중
        // 화면에 남아있는 동안 매 tick마다 다시 스킵될 뿐이라 안전함.
        const socialContext = article.querySelector('[data-testid="socialContext"]');
        if (socialContext) {
          window._loggedSkips.add(link);
          skippedThisTick.push({ link, reason: `socialContext("${socialContext.innerText.replace(/\s+/g, ' ').trim()}")` });
          return;
        }

        // 인용 트윗(quote tweet) 안에 인용된 원본 게시물이 똑같은 article[data-testid="tweet"]
        // 구조로 중첩 렌더링되는 경우가 있음 — querySelectorAll이 이 중첩 카드까지 별도
        // "게시물"로 잡아버리면, 인용된 옛날 글의 날짜가 그대로 들어와서 똑같이 날짜 판단
        // 로직을 오작동시킴. 최상위 피드 게시물이 아니라 카드 안에 중첩된 것이면 제외.
        // (같은 이유로 여기도 seenLinks에는 추가하지 않음 — 위 socialContext 케이스와 동일)
        if (article.parentElement && article.parentElement.closest('article[data-testid="tweet"]')) {
          window._loggedSkips.add(link);
          skippedThisTick.push({ link, reason: 'nested-article(인용 트윗 안에 중첩된 카드로 판단)' });
          return;
        }

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
      return skippedThisTick;
    });
    skipped.forEach(s => console.log(`[twitter:${account}:skip] ${s.reason} — ${s.link}`));
  }

  let stop = false;
  let retries = 0;
  const MAX_RETRIES = 5;
  // 링크가 여러 개(제품별 상세페이지 링크 등) 붙은 게시물은 그만큼 카드 미리보기도 여러 개
  // 붙어서 세로로 훨씬 길어짐 — 예전 3000px 점프는 이런 유난히 긴 게시물 하나를 통째로
  // 건너뛰어서(가상 스크롤 목록이 그 사이에 화면 밖으로 밀려나 다시 렌더링 안 됨) 한 번도
  // 안 걸리고 누락시키는 사례가 실제로 있었음(회귀 방지). 스크롤 폭을 줄여서 스냅샷 간
  // 겹치는 구간을 넓혀 이런 누락 확률을 낮춤 — 대신 전체 수집 시간은 늘어남.
  const SCROLL_STEP_PX = 900;
  // "인용/멘션으로 옛날 글 끌올" 등 다양한 방식으로 오래된 게시물 하나가 최신 게시물들
  // 사이에 섞여 나올 수 있어서, 그 1건만 보고 바로 멈추면 오탐. 새로 발견된 순서(=피드 순서)
  // 기준으로 연속 N건이 전부 범위 시작일보다 오래돼야 "진짜로 과거로 넘어갔다"고 판단.
  const OLD_STREAK_THRESHOLD = 3;

  while (!stop) {
    try {
      await collectOnce();
      await page.mouse.wheel(0, SCROLL_STEP_PX);
      await page.waitForTimeout(2500);

      const all = await page.evaluate(() => window._tweetData);
      if (all.length === 0) { retries++; if (retries >= MAX_RETRIES) stop = true; continue; }

      let streak = 0;
      for (let i = all.length - 1; i >= 0; i--) {
        if (new Date(all[i].datetime) < rangeStartUTC) streak++;
        else break;
      }

      if (streak >= OLD_STREAK_THRESHOLD) {
        console.log(`[twitter:${account}] 최근 발견된 게시물 ${streak}건 연속으로 범위 시작일 이전 → 스크롤 중단`);
        stop = true;
      }
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
  console.log(`[twitter:${account}] 수집 완료: ${((endTime - startTime) / 1000 / 60).toFixed(1)}분, 원본 ${allTweets.length}건 → 기간 필터링 후 ${filtered.length}건 (리트윗/고정 게시물은 원본 수집 단계에서 이미 제외됨)`);

  await browser.close();
  return filtered;
}

module.exports = { collectTwitter };
