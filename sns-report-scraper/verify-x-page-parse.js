/**
 * X 게시물 페이지 추출 검증 — 실제 X에 접속하지 않고, X 상세 페이지 구조를 흉내 낸
 * 페이지에 collect-by-link.js의 추출 함수(readTwitterInPage)를 **그대로** 돌려본다.
 *
 * 왜 따로 있나: 인용 수 셀렉터를 감으로 짜서 두 번 틀렸음. 첫 번째는 통계 줄이 article
 * 밖에 있는 걸 몰라서, 두 번째는 못 찾았을 때 '0'을 넣어서 실패가 정상값으로 위장됐음.
 * 화면 구조가 여러 형태일 수 있으니 형태별로 케이스를 만들어 회귀를 막는다.
 *
 * 실행: node verify-x-page-parse.js  (브라우저를 띄우므로 verify-mock.js와 분리)
 */
const assert = require('assert');
const { chromium } = require('playwright');
const { readTwitterInPage } = require('./collect-by-link');

const POST_ID = '2092115657756475773';
const ACCOUNT = 'GoodsmileP';

// 액션바(답글/리포스트/마음에 들어요) — 숫자는 버튼 안 span에 들어감
function actionBar({ reply, retweet, like, liked = false, retweeted = false }) {
  const btn = (testid, n) => `
    <button data-testid="${testid}" aria-label="${n}">
      <span data-testid="app-text-transition-container"><span>${n}</span></span>
    </button>`;
  return `<div role="group" aria-label="답글 ${reply}개, 리포스트 ${retweet}개, 마음에 들어요 ${like}개">
    ${btn('reply', reply)}
    ${btn(retweeted ? 'unretweet' : 'retweet', retweet)}
    ${btn(liked ? 'unlike' : 'like', like)}
  </div>`;
}

// 통계 줄 — "N 리포스트 · N 인용 · N 마음에 들어요"처럼 목록 링크로 그려짐
function statsRow({ retweets, quotes, likes, withQuotes = true }) {
  const link = (suffix, n, word) =>
    `<a href="/${ACCOUNT}/status/${POST_ID}/${suffix}"><span><span>${n}</span></span> <span>${word}</span></a>`;
  return `<div>
    ${link('retweets', retweets, '리포스트')}
    ${withQuotes ? link('quotes', quotes, '인용') : ''}
    ${link('likes', likes, '마음에 들어요')}
  </div>`;
}

const CASES = [
  {
    name: '통계 줄이 article 안에 있는 형태',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">토모에 넨도로이드 RT 이벤트!</div>
      ${statsRow({ retweets: 612, quotes: 37, likes: 324 })}
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>`,
    expect: { quotes: '37', retweets: '612', likes: '324', comments: '2' },
  },
  {
    name: '통계 줄이 article 밖에 있는 형태 (첫 번째로 틀렸던 경우)',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">토모에 넨도로이드 RT 이벤트!</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>
    <section>${statsRow({ retweets: 612, quotes: 37, likes: 324 })}</section>`,
    expect: { quotes: '37' },
  },
  {
    name: '자사 계정이 자기 글을 리포스트·좋아요한 상태 (버튼 이름이 unretweet/unlike로 바뀜)',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">RT 이벤트</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324, liked: true, retweeted: true })}
    </article>
    <section>${statsRow({ retweets: 612, quotes: 37, likes: 324 })}</section>`,
    expect: { retweets: '612', likes: '324', quotes: '37' },
  },
  {
    name: '목록 링크가 없고 "37 인용" 글자만 있는 형태 (텍스트 경로)',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">RT 이벤트</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>
    <section><div><span>37 인용</span></div></section>`,
    expect: { quotes: '37' },
  },
  {
    name: '영문 UI("37 Quotes")',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">Aug 25</time></a>
      <div data-testid="tweetText">RT event</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>
    <section><div><span>37 Quotes</span></div></section>`,
    expect: { quotes: '37' },
  },
  {
    name: '1.2만 같은 축약 표기',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">RT 이벤트</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>
    <section>${statsRow({ retweets: '1.2만', quotes: '1.2만', likes: '3.4만' })}</section>`,
    expect: { quotes: '1.2만' },
  },
  {
    name: '인용이 진짜 0 — 통계 줄은 있는데 인용 항목만 없음',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">일반 게시물</div>
      ${actionBar({ reply: 2, retweet: 3, like: 40 })}
    </article>
    <section>${statsRow({ retweets: 3, likes: 40, withQuotes: false })}</section>`,
    expect: { quotes: '0' },
  },
  {
    name: '통계 줄 자체가 없음 → 0으로 단정하지 않고 못 읽음(null)',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">일반 게시물</div>
      ${actionBar({ reply: 2, retweet: 3, like: 40 })}
    </article>`,
    expect: { quotes: null },
  },
  {
    name: '답글이 같이 있는 페이지 — 답글 숫자를 본문 글 숫자로 착각하면 안 됨',
    html: `<article data-testid="tweet">
      <a href="/${ACCOUNT}/status/${POST_ID}"><time datetime="2026-08-25T05:03:00.000Z">8월 25일</time></a>
      <div data-testid="tweetText">본문 글</div>
      ${actionBar({ reply: 2, retweet: 612, like: 324 })}
    </article>
    <section>${statsRow({ retweets: 612, quotes: 37, likes: 324 })}</section>
    <article data-testid="tweet">
      <a href="/someone/status/9999999"><time datetime="2026-08-26T00:00:00.000Z">8월 26일</time></a>
      <div data-testid="tweetText">남의 답글</div>
      ${actionBar({ reply: 99, retweet: 88, like: 77 })}
    </article>`,
    expect: { likes: '324', retweets: '612', comments: '2', text: '본문 글' },
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let failed = 0;

  for (const c of CASES) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><body>${c.html}</body>`);
    const got = await page.evaluate(readTwitterInPage, POST_ID);
    try {
      assert.ok(got, '게시물을 못 읽음');
      for (const [k, want] of Object.entries(c.expect)) {
        assert.strictEqual(got[k], want, `${k}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got[k])}`);
      }
      console.log(`✅ ${c.name}`);
    } catch (e) {
      failed++;
      console.error(`❌ ${c.name}\n   ${e.message}`);
    }
  }

  await browser.close();
  if (failed) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log('\nX 페이지 추출 검증 전체 통과');
})();
