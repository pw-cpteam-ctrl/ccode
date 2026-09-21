/**
 * 인스타 게시물/릴스 추출 검증 — 실제 인스타에 접속하지 않고, 화면 구조를 흉내 낸 페이지에
 * collect-by-link.js의 추출 경로를 **그대로** 돌려본다.
 *
 * 왜 따로 있나: 릴스(/reel/) 링크 2건이 "삭제됐거나 비공개"로 떨어졌는데 실제로는 멀쩡히
 * 공개된 글이었음. 원인은 화면 읽기가 `time[datetime]`이 없으면 통째로 null을 돌려주던 것 —
 * 릴스 화면엔 그 요소가 없다. 실데이터로 확인: 일반 게시물 10건 성공 / 릴스 2건 전부 실패.
 * 같은 실수를 막으려고 릴스 형태를 픽스처로 박아둔다.
 *
 * ⚠️ 한계: 여기 픽스처는 인스타 실제 마크업이 아니라 "이런 형태일 때 우리 코드가 어떻게
 * 동작하는지"를 재는 것이다. 그래서 화면 읽기보다 **원본 응답 가로채기**를 주 경로로 두고,
 * 응답 경로는 실제 흐름(페이지 열기 → 응답 수신 → 가로채기)으로 검증한다.
 *
 * 실행: node verify-ig-page-parse.js
 */
const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
const { readInstagramInPage, findInstagramCountsInJson, readInstagramPost } = require('./collect-by-link');

const CODE = 'DWqrF7zk2p0';
const ACCOUNT = 'megahouse_korea_dt_bh';
let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (e) { failed++; console.error(`❌ ${label}\n   ${e.message}`); }
};

// ── 1. 응답 JSON에서 지표 뽑기 (순수 함수) ──
check('응답 JSON — REST 형태(items[0])에서 좋아요/댓글/시각/캡션을 뽑음', () => {
  const body = { items: [{ code: CODE, like_count: 209, comment_count: 65, taken_at: 1789000000,
    caption: { text: '사이키 쿠스오 이벤트' }, user: { username: ACCOUNT } }] };
  const r = findInstagramCountsInJson(body, CODE);
  assert.ok(r, '못 찾음');
  assert.strictEqual(r.likes, 209);
  assert.strictEqual(r.comments, 65);
  assert.strictEqual(r.account, ACCOUNT);
  assert.strictEqual(r.caption, '사이키 쿠스오 이벤트');
  assert.ok(r.datetime.startsWith('20'), '시각이 ISO로 변환돼야 함');
});

check('응답 JSON — GraphQL 형태(shortcode_media/edge_*)에서도 뽑음', () => {
  const body = { data: { xdt_shortcode_media: { shortcode: CODE,
    edge_media_preview_like: { count: 331 },
    edge_media_to_parent_comment: { count: 202 },
    taken_at_timestamp: 1789000000,
    edge_media_to_caption: { edges: [{ node: { text: '9월 알림받기' } }] },
    owner: { username: ACCOUNT } } } };
  const r = findInstagramCountsInJson(body, CODE);
  assert.ok(r, '못 찾음');
  assert.strictEqual(r.likes, 331);
  assert.strictEqual(r.comments, 202);
  assert.strictEqual(r.caption, '9월 알림받기');
});

check('응답 JSON — 추천 릴스가 같이 실려와도 남의 숫자를 집지 않음', () => {
  const body = { items: [
    { code: 'OTHER_ONE', like_count: 99999, comment_count: 8888, user: { username: 'someone' } },
    { code: CODE, like_count: 209, comment_count: 65, user: { username: ACCOUNT } },
  ] };
  assert.strictEqual(findInstagramCountsInJson(body, CODE).likes, 209);
});

check('응답 JSON — 이 글이 없으면 아무거나 집지 말고 null (실패를 정상값으로 위장 금지)', () => {
  const body = { items: [{ code: 'OTHER_ONE', like_count: 99999, comment_count: 8888 }] };
  assert.strictEqual(findInstagramCountsInJson(body, CODE), null);
});

// ── 2. 화면 읽기 — 릴스 형태(time 요소 없음) ──
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  // 릴스 화면 흉내: time[datetime]이 없고, /p/ 링크도 없음(릴스 링크만 있음)
  await page.setContent(`<!doctype html><meta charset="utf-8"><body>
    <a href="/${ACCOUNT}/reel/${CODE}/">릴스</a>
    <span dir="auto">${ACCOUNT}\n\n3주\n사이키 쿠스오 초능력 발동 이벤트 본문</span>
  </body>`);
  const reel = await page.evaluate(readInstagramInPage);
  check('화면 읽기 — 릴스처럼 time 요소가 없어도 통째로 버리지 않음', () => {
    assert.ok(reel, '예전처럼 null을 돌려주면 릴스는 영원히 "삭제됨"으로 떨어진다');
    assert.strictEqual(reel.datetime, null, '시각은 없으니 null이어야 함(지어내면 안 됨)');
    assert.strictEqual(reel.account, ACCOUNT, '릴스 링크에서도 계정을 읽어야 함');
  });

  // 진짜로 아무것도 없는 페이지(로그인 벽 등)는 여전히 null이어야 함
  await page.setContent('<!doctype html><meta charset="utf-8"><body><div>로그인하세요</div></body>');
  const empty = await page.evaluate(readInstagramInPage);
  check('화면 읽기 — 빈 페이지는 null (빈 껍데기 성공 금지)', () => {
    assert.strictEqual(empty, null);
  });
  await page.close();

  // ── 3. 실제 흐름: 릴스 페이지를 열고 응답을 가로채서 지표를 채우는지 ──
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [{ code: CODE, like_count: 209, comment_count: 65,
        taken_at: 1789000000, caption: { text: '릴스 본문' }, user: { username: ACCOUNT } }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // 릴스 화면: 시각도 없고 좋아요 숫자도 화면에 없음 — 응답만으로 채워져야 함
    res.end(`<!doctype html><meta charset="utf-8"><body>
      <a href="/${ACCOUNT}/reel/${CODE}/">릴스</a>
      <script>fetch('/api/v1/media/123/info/');</script>
    </body>`);
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  try {
    const p2 = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const got = await readInstagramPost(p2, { url: `http://127.0.0.1:${port}/reel/${CODE}/`, postId: CODE });
    check('실제 흐름 — 릴스 화면에 숫자가 없어도 원본 응답에서 좋아요/댓글을 읽어옴', () => {
      assert.ok(got && !got.failed, `실패로 떨어짐: ${JSON.stringify(got)}`);
      assert.strictEqual(got.likes, '209');
      assert.strictEqual(got.comments, '65');
      assert.strictEqual(got.countsFrom, 'api', '출처가 원본 응답으로 표시돼야 함');
      assert.ok(got.datetime, '응답의 taken_at으로 게시 시각이 채워져야 함');
    });
    await p2.close();
  } finally { server.close(); }

  await browser.close();
  if (failed) { console.error(`\n${failed}건 실패`); process.exit(1); }
  console.log('\n인스타 페이지 추출 검증 전체 통과');
})();
