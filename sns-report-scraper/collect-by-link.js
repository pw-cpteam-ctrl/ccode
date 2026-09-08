/**
 * 링크로 게시물 하나씩 직접 읽어오기 — "⚔️ 게시글 맞대결"용 수집기.
 *
 * 기존 twitter.js/instagram.js는 **프로필 타임라인을 최신순으로 스크롤**해서 기간 안에
 * 들어오는 글을 걷어오는 방식이라, 몇 주 전 글 하나를 보려고 해도 그 사이 전부를 지나가야 함
 * (8월 20일 글 하나 보려다 3주치를 스크롤하게 되는 문제). 반대로 여기서는 볼 글의 주소를
 * 사람이 직접 알려주므로, 그 페이지만 열어서 읽으면 끝 — 링크 개수만큼만 걸림.
 *
 * 그래서 이 모듈엔 날짜 범위 개념이 아예 없음. "언제 올라온 글이냐"는 결과에 담아서
 * 리포트가 경과일을 계산하는 데만 씀(맞대결은 양쪽 게시일이 다른 게 정상이라 거르면 안 됨).
 */
const { chromium } = require('playwright');
const { applyStealth, STEALTH_LAUNCH_ARGS, STEALTH_CONTEXT_OPTIONS } = require('./browser-stealth');

const X_SESSION = './x-session.json';
const IG_SESSION = './instagram-session.json';

/**
 * 주소만 보고 어느 플랫폼 글인지 판단. 여기서 못 알아보는 주소는 수집 대상에서 빼고
 * "왜 못 읽었는지"를 리포트에 그대로 남김 — 조용히 빠지면 사람이 링크를 잘못 넣은 건지
 * 도구가 실패한 건지 구분할 수 없음.
 */
function classifyUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return { ok: false, error: '주소가 비어 있음' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: '주소 형식이 아님 (http로 시작하는 링크를 넣어주세요)' };
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    const m = parsed.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
    if (!m) return { ok: false, error: 'X 게시물 주소가 아님 (…/status/숫자 형태여야 함)' };
    // 주소에 ?t=…&s=20 같은 공유용 추적 파라미터가 붙어 오는 게 흔한데, 그대로 열면
    // 리다이렉트가 한 번 더 붙어서 느려짐 — 필요한 부분만 남겨서 정규화.
    return { ok: true, platform: 'twitter', account: m[1], postId: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` };
  }

  if (host === 'instagram.com') {
    const m = parsed.pathname.match(/^\/(?:[^/]+\/)?(p|reel|tv)\/([^/]+)/);
    if (!m) return { ok: false, error: '인스타그램 게시물 주소가 아님 (…/p/… 또는 …/reel/… 형태여야 함)' };
    return { ok: true, platform: 'instagram', postId: m[2], url: `https://www.instagram.com/${m[1]}/${m[2]}/` };
  }

  return { ok: false, error: 'X(트위터)/인스타그램 링크만 읽을 수 있음' };
}

/** "1.2만", "3,456", "12K" 같은 표기를 그대로 문자열로 넘김 — 숫자 변환은 aggregate.parseCount가 담당 */
async function readTwitterPost(page, target) {
  await page.goto(target.url, { waitUntil: 'domcontentloaded' });
  // 게시물 상세 페이지엔 답글도 같은 article로 렌더링됨 — 본문 글이 그려질 때까지만 기다림.
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });
  await page.waitForTimeout(1500);

  return page.evaluate((postId) => {
    // 답글이 아니라 "이 주소의 글"을 집어야 함 — 글 안에 자기 자신의 status 링크(시각 링크)가
    // 들어 있다는 점을 이용해서 id가 일치하는 article만 고름. 못 찾으면 첫 번째 article로
    // 넘어가되(구조가 바뀐 경우 대비) 그 사실을 결과에 남김.
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    let article = articles.find(a => a.querySelector(`a[href*="/status/${postId}"]`));
    const exact = Boolean(article);
    if (!article) article = articles[0];
    if (!article) return null;

    // ⚠️ X는 **내가 이미 누른** 버튼의 이름을 바꿔 달음: retweet→unretweet, like→unlike.
    // 우리는 자사 계정으로 로그인한 채 보기 때문에, 자사가 자기 이벤트 글을 리포스트해두면
    // retweet 버튼이 아예 없어서 리트윗 수가 '-'로 빠짐(실제로 겪음 — RT 이벤트인데
    // 리트윗이 안 나오면 리포트의 핵심이 빠지는 것). 두 이름을 다 보게 함.
    //
    // 숫자는 두 군데서 읽을 수 있음: 버튼 안 텍스트(app-text-transition-container)와
    // aria-label("좋아요 1,234개"). 텍스트 쪽이 비어 있는 경우가 있어서 aria-label로 보강.
    const countOf = (...testids) => {
      let btn = null;
      for (const id of testids) {
        btn = article.querySelector(`[data-testid="${id}"]`);
        if (btn) break;
      }
      if (!btn) return null;
      const span = btn.querySelector('span[data-testid="app-text-transition-container"]');
      const text = span ? span.innerText.trim() : '';
      if (text) return text;
      const label = btn.getAttribute('aria-label') || '';
      const m = label.match(/[\d,.]+[만천KM]?/);
      return m ? m[0] : '0';
    };

    const timeEl = article.querySelector('time[datetime]');
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const authorLink = article.querySelector('a[href*="/status/"]');
    const account = authorLink ? (authorLink.getAttribute('href').match(/^\/([^/]+)\//) || [])[1] || '' : '';

    return {
      exactMatch: exact,
      account,
      datetime: timeEl ? timeEl.getAttribute('datetime') : null,
      text: textEl ? textEl.innerText : '',
      likes: countOf('like', 'unlike'),
      retweets: countOf('retweet', 'unretweet'),
      comments: countOf('reply'),
    };
  }, target.postId);
}

async function readInstagramPost(page, target) {
  await page.goto(target.url, { waitUntil: 'domcontentloaded' });
  // 인스타는 사진·캡션을 먼저 그리고 좋아요/댓글 숫자를 뒤늦게 채움 — 고정 대기로 읽으면
  // 게시물마다 성공/실패가 갈림(instagram.js에서 같은 문제를 겪고 대기 조건으로 바꿨음).
  await page.waitForFunction(() => {
    const numeric = /^[\d,.]+[만천KM]?$/;
    const byCoord = [...document.querySelectorAll('span')].some(el => {
      const r = el.getBoundingClientRect();
      return r.x > 700 && r.y > 400 && r.y < 580 && numeric.test(el.innerText.trim());
    });
    if (byCoord) return true;
    return [...document.querySelectorAll('span')].some(el => /명이 좋아합니다|likes$/.test(el.innerText));
  }, { timeout: 8000 }).catch(() => {}); // 안 나타나도 죽지 않고 그대로 진행(좋아요 숨긴 글 등)

  return page.evaluate(() => {
    const timeEl = document.querySelector('time[datetime]');
    if (!timeEl) return null;

    const numeric = /^[\d,.]+[만천KM]?$/;
    const candidates = [...document.querySelectorAll('span')]
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ el, rect }) => rect.x > 700 && rect.y > 400 && rect.y < 580 && numeric.test(el.innerText.trim()));
    let likes = candidates[0] ? candidates[0].el.innerText.trim() : null;
    const comments = candidates[1] ? candidates[1].el.innerText.trim() : null;

    if (!likes) {
      const el = [...document.querySelectorAll('span')].find(s => /명이 좋아합니다|likes$/.test(s.innerText));
      if (el) {
        const m = el.innerText.match(/[\d,]+/);
        if (m) likes = m[0];
      }
    }

    // 링크만 받았을 땐 계정 핸들을 주소에서 알 수 없어서(…/p/코드 형태) 페이지에서 읽어냄.
    // header 안에 못 찾는 레이아웃이 있어서(실제로 계정명이 빈칸으로 나옴) 대체 경로를 둠:
    // 시각 링크(/계정/p/코드)의 첫 칸, 그다음 og:title("… on Instagram" 앞부분).
    let account = '';
    const headerLink = document.querySelector('header a[href^="/"]');
    if (headerLink) account = headerLink.getAttribute('href').replace(/\//g, '');
    if (!account) {
      const permalink = [...document.querySelectorAll('a[href*="/p/"]')]
        .map(a => (a.getAttribute('href').match(/^\/([^/]+)\/p\//) || [])[1])
        .find(Boolean);
      if (permalink) account = permalink;
    }
    if (!account) {
      const og = document.querySelector('meta[property="og:title"]');
      const m = og && (og.getAttribute('content') || '').match(/^([^\s(•|]+)/);
      if (m) account = m[1].replace(/^@/, '');
    }

    const spans = [...document.querySelectorAll('span[dir="auto"]')].sort((a, b) => b.innerText.length - a.innerText.length);
    let caption = '';
    if (account) {
      const re = new RegExp(`${account}\\s*\\n\\s*\\n?\\s*(?:수정됨\\s*)?(?:•\\s*)?\\d+[\\w가-힣]+\\s*\\n([\\s\\S]+)`);
      for (const span of spans) {
        const m = span.innerText.match(re);
        if (m) { caption = m[1]; break; }
      }
    }
    if (!caption && spans[0]) caption = spans[0].innerText;

    return { exactMatch: true, account, datetime: timeEl.getAttribute('datetime'), text: caption, likes, comments, retweets: null };
  });
}

/**
 * 주소 목록을 받아 각 게시물의 지표를 읽어옴. 실패한 건도 배열에서 빼지 않고 error를 담아
 * 그대로 돌려줌 — 리포트에서 "왜 이 글은 숫자가 없는지"를 보여줘야 하기 때문.
 *
 * @param {object} opts
 * @param {string[]} opts.urls 게시물 주소 목록
 * @param {boolean} [opts.headless=true] 링크 몇 개만 여는 작업이라 기본은 창 없이
 * @returns {Promise<Array<{url,platform,ok,error?,datetime?,likes?,retweets?,comments?,text?,account?}>>}
 */
async function collectPostsByLink({ urls, headless = true, xSessionFile = X_SESSION, igSessionFile = IG_SESSION } = {}) {
  const targets = (urls || []).map(u => ({ raw: u, ...classifyUrl(u) }));
  const results = targets.map(t => ({
    url: t.ok ? t.url : t.raw,   // 못 알아본 주소는 사람이 넣은 원문 그대로 보여줘야 고칠 수 있음
    raw: t.raw,
    platform: t.platform || null,
    ok: false,
    error: t.error || null,
  }));

  const needTwitter = targets.some(t => t.ok && t.platform === 'twitter');
  const needInstagram = targets.some(t => t.ok && t.platform === 'instagram');
  if (!needTwitter && !needInstagram) return results;

  const browser = await chromium.launch({ headless, args: STEALTH_LAUNCH_ARGS });
  try {
    let twitterPage = null;
    let instagramPage = null;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.ok) continue;
      try {
        let parsed;
        if (t.platform === 'twitter') {
          if (!twitterPage) {
            const ctx = await browser.newContext({ storageState: xSessionFile });
            twitterPage = await ctx.newPage();
          }
          parsed = await readTwitterPost(twitterPage, t);
        } else {
          if (!instagramPage) {
            const ctx = await browser.newContext({ storageState: igSessionFile, ...STEALTH_CONTEXT_OPTIONS });
            await applyStealth(ctx);
            instagramPage = await ctx.newPage();
          }
          parsed = await readInstagramPost(instagramPage, t);
        }

        if (!parsed) {
          results[i].error = '페이지는 열렸는데 게시물 내용을 못 읽음 (삭제됐거나 비공개일 수 있음)';
          continue;
        }
        Object.assign(results[i], parsed, { ok: true, error: null });
        if (parsed.exactMatch === false) {
          results[i].warning = '주소의 글을 정확히 못 집어서 페이지 첫 번째 글을 읽었음 — 숫자가 맞는지 확인 필요';
        }
        console.log(`[link] ✅ ${t.platform} ${t.url} — 좋아요 ${parsed.likes ?? '-'} · 리트윗 ${parsed.retweets ?? '-'} · 댓글 ${parsed.comments ?? '-'}`);
      } catch (e) {
        results[i].error = `읽기 실패: ${e.message}`;
        console.warn(`[link] ❌ ${t.url} — ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { collectPostsByLink, classifyUrl };
