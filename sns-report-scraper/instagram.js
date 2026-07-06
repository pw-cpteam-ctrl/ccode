const { chromium } = require('playwright');

/**
 * 인스타그램 프로필 게시물 수집 초안. 아직 실제 로그인 세션으로 테스트 못 해봤음.
 * 특히 좋아요/댓글수 좌표 기반 파싱(x>700, y 400~580)은 계정마다 레이아웃이
 * 밀릴 수 있어서 실제 계정으로 반드시 검증 필요.
 *
 * @param {object} opts
 * @param {string} opts.account     계정 핸들 (@ 없이)
 * @param {string} opts.sessionFile Playwright storageState 파일 경로
 * @param {string} opts.startDate   'YYYY-MM-DD' (KST 기준, 포함)
 * @param {string} opts.endDate     'YYYY-MM-DD' (KST 기준, 포함)
 * @param {boolean} [opts.headless] 기본 false
 */
async function collectInstagram({ account, sessionFile, startDate, endDate, headless = false }) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: sessionFile });
  const page = await context.newPage();
  const startTime = new Date();

  const rangeStart = new Date(`${startDate}T00:00:00+09:00`);
  const rangeEnd = new Date(`${endDate}T23:59:59+09:00`);

  // 그리드에 보이는 링크만으론 날짜를 알 수 없어서, 새로 발견한 링크 중 가장 나중 것(=그리드
  // 순서상 가장 오래됐을 가능성이 큰 것) 하나를 별도 탭으로 슬쩍 열어 날짜만 확인. 메인 page의
  // 스크롤 위치는 그대로 유지됨 (별도 탭이라 프로필 새로고침/재스크롤이 필요 없음).
  async function peekPostDate(url) {
    const probePage = await context.newPage();
    try {
      await probePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await probePage.waitForTimeout(1000);
      const iso = await probePage.evaluate(() => {
        const t = document.querySelector('time[datetime]');
        return t ? t.getAttribute('datetime') : null;
      });
      return iso ? new Date(iso) : null;
    } catch {
      return null; // 프로브 실패는 무시하고 스크롤 계속 (다음 패스에서 다시 시도됨)
    } finally {
      await probePage.close();
    }
  }

  // ── Step 1: 프로필 그리드에서 게시물 링크 수집 ──
  await page.goto(`https://www.instagram.com/${account}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const links = new Set();
  const orderedLinks = []; // 발견 순서 보존 (그리드는 최신→과거 순으로 쌓임)
  let stallCount = 0;
  const MAX_STALL = 3; // 스크롤해도 새 링크가 안 늘어나는 게 3번 연속이면 그리드 끝으로 판단
  let reachedRangeStart = false;

  while (stallCount < MAX_STALL && !reachedRangeStart) {
    const found = await page.evaluate(() => {
      return [...document.querySelectorAll('a[href*="/p/"]')]
        .map(a => a.href.split('?')[0])
        .filter(href => !href.includes('/c/') && !href.includes('liked_by'));
    });

    const before = links.size;
    found.forEach(l => {
      if (!links.has(l)) { links.add(l); orderedLinks.push(l); }
    });
    stallCount = links.size === before ? stallCount + 1 : 0;

    if (orderedLinks.length > 0) {
      const probeDate = await peekPostDate(orderedLinks[orderedLinks.length - 1]);
      if (probeDate && probeDate < rangeStart) {
        console.log(`[instagram:${account}] 그리드에서 범위 시작일 이전 게시물 발견 → 스크롤 중단`);
        reachedRangeStart = true;
        continue;
      }
    }

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
  }

  // ── Step 2: 각 게시물 개별 파싱 ──
  const results = [];
  for (const url of links) {
    let parsed = null;
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        parsed = await page.evaluate((acct) => {
          const timeEl = document.querySelector('time[datetime]');
          if (!timeEl) return null;

          // 좋아요/댓글수: 우측 액션 패널 좌표 기준 (TODO: 실제 계정으로 검증 필요)
          const numeric = /^[\d,.]+[만천KM]?$/;
          const candidates = [...document.querySelectorAll('span')]
            .map(el => ({ el, rect: el.getBoundingClientRect() }))
            .filter(({ el, rect }) => rect.x > 700 && rect.y > 400 && rect.y < 580 && numeric.test(el.innerText.trim()));
          let likes = candidates[0] ? candidates[0].el.innerText.trim() : null;
          const comments = candidates[1] ? candidates[1].el.innerText.trim() : null;

          // 대체 파싱: "N명이 좋아합니다" / "N likes" 텍스트에서 추출
          if (!likes) {
            const likeTextEl = [...document.querySelectorAll('span')]
              .find(el => /명이 좋아합니다|likes$/.test(el.innerText));
            if (likeTextEl) {
              const m = likeTextEl.innerText.match(/[\d,]+/);
              if (m) likes = m[0];
            }
          }

          // 본문 캡션: 계정명 뒤에 오는 텍스트 블록에서 추출
          const spans = [...document.querySelectorAll('span[dir="auto"]')]
            .sort((a, b) => b.innerText.length - a.innerText.length);
          let caption = '';
          if (spans[0]) {
            const raw = spans[0].innerText;
            const re = new RegExp(`${acct}\\s*\\n\\s*\\n?\\s*(?:수정됨\\s*)?(?:•\\s*)?\\d+[\\w가-힣]+\\s*\\n([\\s\\S]+)`);
            const m = raw.match(re);
            caption = m ? m[1] : raw;
          }

          return { datetime: timeEl.getAttribute('datetime'), likes, comments, caption };
        }, account);
      } catch (e) {
        console.warn(`[instagram] 재시도 ${attempt + 1}/3 (${url}): ${e.message}`);
        await page.waitForTimeout(3000 + attempt * 2000);
      }
    }
    if (parsed) results.push({ url, ...parsed });
  }

  const filtered = results.filter(r => {
    const d = new Date(r.datetime); // datetime attribute는 UTC, KST 변환은 표시 단계에서 +9h
    return d >= rangeStart && d <= rangeEnd;
  });

  const endTime = new Date();
  console.log(`[instagram:${account}] 수집 완료: ${((endTime - startTime) / 1000 / 60).toFixed(1)}분, 링크 ${links.size}개 → 파싱 성공 ${results.length}건 → 기간 필터링 후 ${filtered.length}건`);

  await browser.close();
  return filtered;
}

module.exports = { collectInstagram };
