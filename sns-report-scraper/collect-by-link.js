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
const fs = require('fs');
const path = require('path');
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

/**
 * X 게시물 페이지 **안에서** 실행되는 추출 함수(page.evaluate로 넘겨짐).
 * 별도 함수로 빼둔 이유: X 화면 구조를 흉내 낸 페이지에 이 함수를 그대로 돌려서
 * 검증할 수 있게 하려는 것 — 실제 X에 접속하지 않고도 셀렉터를 검증하기 위함
 * (인용 수를 감으로 짠 셀렉터로 두 번 틀렸어서 이렇게 바꿈).
 *
 * "1.2만", "3,456", "12K" 같은 표기를 그대로 문자열로 넘김 — 숫자 변환은 aggregate.parseCount가 담당.
 */
function readTwitterInPage(postId) {
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

    // 인용(quote) 수는 액션 버튼이 아니라 상세 페이지의 통계 줄
    // ("리포스트 · 인용 · 마음에 들어요")에 있는 "…/status/<id>/quotes" 링크에 붙어 있음.
    //
    // ⚠️ 두 번 틀렸던 부분이라 방식을 바꿈:
    //  (1) 이 통계 줄은 article **밖**에 그려지는 경우가 있어서 article 안에서만 찾으면
    //      아예 안 걸림 → 문서 전체에서 이 글의 id로 찾는다.
    //  (2) 예전엔 링크를 못 찾으면 무조건 '0'으로 읽었는데, 그 바람에 셀렉터가 틀린
    //      상황이 전부 "정상적인 0"으로 위장돼서 버그가 안 보였음(실제로 겪음).
    //      그래서 같은 줄의 형제 링크(리포스트/마음에 들어요 목록)가 있는지로
    //      "줄은 찾았는데 인용 항목만 없다(= 진짜 0)"와 "줄 자체를 못 찾았다(= 못 읽음,
    //      null → 리포트에 '-')"를 구분한다. 못 읽은 건 못 읽었다고 보여야 고칠 수 있음.
    const statLink = suffix => document.querySelector(`a[href$="/${postId}/${suffix}"]`);
    const numberIn = s => {
      const m = String(s || '').match(/[\d,.]+\s*[만천KM]?/);
      return m ? m[0].replace(/\s+/g, '') : null;
    };

    const quoteOf = () => {
      // ① 이 글의 인용 목록 링크. href가 정확히 잡히면 가장 확실함.
      const q = statLink('quotes');
      if (q) {
        const n = numberIn(q.innerText) || numberIn(q.getAttribute('aria-label'));
        if (n) return n;
      }

      // ② 화면에 보이는 글자를 그대로 찾는다 — 구조(어느 div 안에 있는지)에 의존하지
      //    않으므로 X가 레이아웃을 바꿔도 안 깨짐. "37 인용" / "37 Quotes" / "인용 37".
      //
      //    ⚠️ 예전엔 "글자 노드만 가진 요소(children.length === 0)"로 제한했는데, X는
      //    숫자와 단어를 서로 다른 span에 나눠 그림
      //    (<a><span><span>37</span></span><span>인용</span></a>) — 그래서 한 덩어리로
      //    된 요소가 아예 없어서 못 찾았음. 지금은 자식이 있어도 되고, 대신 "합친 글자가
      //    짧은 것"만 후보로 봐서 페이지를 통째로 감싼 상위 요소가 걸리지 않게 한다.
      //    (여러 개가 걸리면 가장 짧은 = 가장 안쪽 것을 택함)
      const QUOTE_RES = [
        /^([\d,.]+\s*[만천KM]?)\s*(?:인용|Quotes?|引用)$/i,
        /^(?:인용|Quotes?|引用)\s*([\d,.]+\s*[만천KM]?)(?:개)?$/i,
      ];
      let best = null;
      for (const el of document.querySelectorAll('a, span, div')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 24) continue; // 상위 컨테이너 배제(숫자+단어면 넉넉히 24자 이내)
        for (const re of QUOTE_RES) {
          const m = t.match(re);
          if (m && (!best || t.length < best.len)) best = { n: m[1], len: t.length };
        }
      }
      if (best) return best.n.replace(/\s+/g, '');

      // ③ 액션바 aria-label에 들어오는 경우("… 인용 37개 …")
      const group = article.querySelector('[role="group"]');
      const label = group ? (group.getAttribute('aria-label') || '') : '';
      const fromGroup = label.match(/(?:인용|Quotes?)\s*([\d,.]+[만천KM]?)|([\d,.]+[만천KM]?)\s*(?:인용|Quotes?)/i);
      if (fromGroup) return (fromGroup[1] || fromGroup[2]);

      // 여기까지 못 찾았으면 0으로 단정하지 않는다 — 예전엔 '0'을 넣었다가, 셀렉터가
      // 틀린 상황이 전부 "정상적인 0"으로 위장돼서 버그가 안 보였음(실제로 겪음).
      // 통계 줄의 형제 링크가 있으면 "줄은 찾았는데 인용 항목만 없다 = 진짜 0"으로 본다.
      const rowFound = Boolean(statLink('retweets') || statLink('likes'));
      return rowFound ? '0' : null;
    };

    // 셀렉터를 실제 X 화면 없이 맞출 수 없어서 남기는 계측용 — 인용을 못 읽었을 때
    // 어떤 통계 링크들이 실제로 있었는지 로그로 보고 셀렉터를 고치기 위함.
    const statHrefs = [...document.querySelectorAll('a[href*="/status/"]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && /\/(quotes|retweets|likes|reposts)(\?|$)/.test(h))
      .slice(0, 10);
    // 텍스트 경로까지 실패했을 때 무엇이 있었는지 보기 위한 계측 — "숫자 + 단어" 꼴로
    // 화면에 있던 짧은 문구들(리포스트/인용/마음에 들어요/북마크/조회 등)
    const statTexts = [...document.querySelectorAll('a, span, div')]
      .filter(el => el.children.length === 0)
      .map(el => (el.textContent || '').trim())
      .filter(t => /^[\d,.]+\s*[만천KM]?\s*\S{1,8}$/.test(t))
      .slice(0, 12);

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
      quotes: quoteOf(),
      statHrefs, statTexts,
      comments: countOf('reply'),
    };
}

/**
 * X가 자기 서버에서 받아오는 원본 응답(GraphQL JSON)에서 이 글의 지표를 찾아낸다.
 *
 * 왜 이걸 주 경로로 쓰나: 화면(DOM)을 긁는 방식은 X가 마크업을 조금만 바꿔도 깨지고,
 * 특히 인용 수는 액션 버튼이 아니라 늦게 채워지는 통계 줄에 있어서 읽기가 계속 실패했음.
 * 반면 이 JSON에는 quote_count/retweet_count/favorite_count/reply_count가 **정확한 숫자로**
 * 들어있음(화면에 "1.2만"으로 축약돼 보이는 것도 여기선 12345처럼 그대로). 화면이 어떻게
 * 그려지든 무관하므로 훨씬 안정적임.
 *
 * 응답 구조(어느 키 밑에 있는지)는 X가 자주 바꾸므로 경로를 고정하지 않고, 객체 전체를
 * 훑어서 "rest_id가 이 글 id이고 legacy에 quote_count가 있는" 객체를 찾는다.
 */
function findTweetCountsInJson(root, postId) {
  const stack = [root];
  let steps = 0;
  while (stack.length && steps < 200000) {
    const node = stack.pop();
    steps++;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const v of node) stack.push(v); continue; }

    const legacy = node.legacy;
    const idMatches = String(node.rest_id || (legacy && legacy.id_str) || '') === String(postId);
    if (idMatches && legacy && typeof legacy === 'object' && legacy.quote_count !== undefined) {
      return {
        quotes: legacy.quote_count,
        retweets: legacy.retweet_count,
        likes: legacy.favorite_count,
        comments: legacy.reply_count,
      };
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return null;
}

async function readTwitterPost(page, target) {
  // ⚠️ 응답 가로채기는 goto **전에** 붙여야 함 — 페이지를 열고 나서 붙이면 이미 지나간
  // 응답을 놓침.
  const seen = { counts: null, graphqlUrls: [] };
  const onResponse = async (res) => {
    const url = res.url();
    if (!/\/(graphql|i\/api)\//.test(url)) return;
    seen.graphqlUrls.push(url.split('?')[0]);
    try {
      if (!/json/.test(res.headers()['content-type'] || '')) return;
      const json = await res.json();
      const found = findTweetCountsInJson(json, target.postId);
      if (found) seen.counts = found;
    } catch (e) { /* 응답 하나 못 읽는 건 무시 — 다른 응답에 또 들어옴 */ }
  };
  page.on('response', onResponse);

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    // 게시물 상세 페이지엔 답글도 같은 article로 렌더링됨 — 본문 글이 그려질 때까지만 기다림.
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });

    // 통계 줄("N 리포스트 · N 인용 · N 마음에 들어요")은 본문·버튼보다 늦게 채워짐.
    // 예전엔 1.5초 고정으로 기다리고 바로 읽어서, 좋아요·리트윗은 읽히는데 인용만 계속
    // 비어 있었음(인스타에서 겪은 것과 같은 레이스 컨디션). 이제 원본 응답이 오거나
    // 화면에 그 줄이 나타날 때까지 기다린다 — 안 나타나도 죽지 않고 그대로 진행.
    // 화면 밖 요소는 아예 안 그려질 수 있어서(가상 렌더링) 살짝 스크롤해 렌더링을 유도.
    await page.evaluate(() => window.scrollBy(0, 220)).catch(() => {});
    await page.waitForFunction((postId) => {
      if (document.querySelector(`a[href$="/${postId}/quotes"]`)) return true;
      if (document.querySelector(`a[href$="/${postId}/retweets"]`)) return true;
      return [...document.querySelectorAll('a, span, div')].some(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return t.length <= 24 && /(인용|Quotes?|引用)/i.test(t) && /[\d,.]/.test(t);
      });
    }, target.postId, { timeout: 10000 }).catch(() => {});
    // 응답이 살짝 늦게 오는 경우가 있어 조금 더 기다림
    for (let i = 0; i < 10 && !seen.counts; i++) await page.waitForTimeout(400);

    const parsed = await page.evaluate(readTwitterInPage, target.postId);
    if (!parsed) return null;

    // 원본 응답에서 찾았으면 그 값이 화면 글자보다 정확함(축약 없음) — 우선 적용.
    // 화면에서 못 읽은 칸도 여기서 채워짐.
    if (seen.counts) {
      const pick = (v, fallback) => (typeof v === 'number' ? String(v) : fallback);
      parsed.quotes = pick(seen.counts.quotes, parsed.quotes);
      parsed.retweets = pick(seen.counts.retweets, parsed.retweets);
      parsed.likes = pick(seen.counts.likes, parsed.likes);
      parsed.comments = pick(seen.counts.comments, parsed.comments);
      parsed.countsFrom = 'api';
    } else {
      parsed.countsFrom = 'dom';
    }
    parsed.graphqlUrls = seen.graphqlUrls.slice(0, 20);
    parsed.pageHtml = parsed.quotes === null ? await page.content() : null;
    return parsed;
  } finally {
    page.off('response', onResponse);
  }
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
async function collectPostsByLink({ urls, headless = true, xSessionFile = X_SESSION, igSessionFile = IG_SESSION, debugDir = null } = {}) {
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
            // 화면을 크게 잡음 — X는 화면 밖 요소를 아예 안 그리는 경우가 있어서(가상 렌더링)
            // 창이 작으면 게시물 아래 통계 줄(인용 수가 있는 곳)이 렌더링되지 않을 수 있음.
            // stealth도 같이 적용 — 인스타에만 쓰고 있었는데, X도 자동화 브라우저로 보이면
            // 마크업을 줄여서 주는 경우가 있어 원인 후보를 하나 없앰.
            const ctx = await browser.newContext({
              storageState: xSessionFile,
              ...STEALTH_CONTEXT_OPTIONS,
              viewport: { width: 1400, height: 1800 },
            });
            await applyStealth(ctx);
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
        const pageHtml = parsed.pageHtml; // 결과에 담아 리포트로 흘려보내지 않게 여기서 빼둠
        delete parsed.pageHtml;
        Object.assign(results[i], parsed, { ok: true, error: null });
        if (parsed.exactMatch === false) {
          results[i].warning = '주소의 글을 정확히 못 집어서 페이지 첫 번째 글을 읽었음 — 숫자가 맞는지 확인 필요';
        }
        console.log(`[link] ✅ ${t.platform} ${t.url} — 좋아요 ${parsed.likes ?? '-'} · 리트윗 ${parsed.retweets ?? '-'} · 인용 ${parsed.quotes ?? '-'} · 댓글 ${parsed.comments ?? '-'}${parsed.countsFrom ? ` (출처: ${parsed.countsFrom === 'api' ? 'X 원본 응답' : '화면'})` : ''}`);

        // 인용을 못 읽었으면 **추측을 반복하지 않기 위해** 그 페이지를 파일로 남긴다.
        // 그 파일만 있으면 실제 구조를 보고 한 번에 고칠 수 있음(지금까지 실제 X 화면을
        // 볼 수 없어서 셀렉터를 추측으로 짰고 그래서 두 번 틀렸음).
        if (t.platform === 'twitter' && parsed.quotes === null) {
          console.log(`[link] ⓘ 인용 수를 못 읽었음 — 통계 링크: ${JSON.stringify(parsed.statHrefs || [])} / 통계 문구: ${JSON.stringify(parsed.statTexts || [])}`);
          console.log(`[link] ⓘ 받아온 X 응답 주소: ${JSON.stringify(parsed.graphqlUrls || [])}`);
          if (debugDir && pageHtml) {
            try {
              fs.mkdirSync(debugDir, { recursive: true });
              const dumpPath = path.join(debugDir, `_debug-x-${t.postId}.html`);
              fs.writeFileSync(dumpPath, pageHtml);
              console.log(`[link] ⓘ 원인을 정확히 짚을 수 있게 이 페이지를 파일로 남겼습니다: ${dumpPath}`);
              console.log('[link] ⓘ 인용 수가 계속 안 나오면 이 파일을 개발자에게 보내주세요.');
            } catch (e) {
              console.warn(`[link] 페이지 저장 실패: ${e.message}`);
            }
          }
        }
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

module.exports = { collectPostsByLink, classifyUrl, readTwitterInPage, findTweetCountsInJson, readTwitterPost };
