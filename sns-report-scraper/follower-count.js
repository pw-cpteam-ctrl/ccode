/**
 * 계정 팔로워 수 읽기 — 트위터·인스타 공용.
 *
 * 왜 따로 빼뒀나: 수집기(twitter.js / instagram.js)는 이미 프로필 페이지를 열고 들어간다.
 * 거기서 팔로워만 같이 주워오면 페이지를 한 번 더 열 필요가 없다(시간도 아끼고, 같은 계정을
 * 두 번 긁어서 차단당할 위험도 줄인다). 두 수집기가 같은 코드를 복사하지 않게 여기 모았다.
 *
 * 읽는 방법이 두 가지인 이유 — 화면에 보이는 숫자는 '1.2만', '12.3K'처럼 줄여서 나온다.
 * 추이를 보려고 기록하는 값인데 몇 주 내내 '1.2만'이면 아무 변화도 안 보인다. 그래서
 *   1순위: 페이지가 받아오는 원본 응답을 가로채 정확한 숫자를 쓴다
 *   2순위: 그게 안 잡히면 화면 글자를 읽는다(줄임 표기라 근사치, approx 표시를 남김)
 * 1순위가 실패했는지 알 수 있게 출처(from)를 같이 돌려준다 — 값만 보면 정확한 건지
 * 근사치인지 구분이 안 돼서 나중에 추이를 잘못 읽게 된다.
 */

/** 중첩된 응답 어디에 들어있든 찾아낸다 — 경로가 수시로 바뀌어서 경로를 고정하면 금방 깨진다. */
function deepFind(root, pick, maxNodes = 60000) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (++n > maxNodes) return null;        // 응답이 거대할 때 무한정 돌지 않게
    if (!cur || typeof cur !== 'object') continue;
    const hit = pick(cur);
    if (hit !== null && hit !== undefined) return hit;
    for (const v of Object.values(cur)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

const sameAccount = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** 트위터 응답에서 이 계정의 팔로워 수. 다른 계정(추천 유저 등)의 숫자를 집지 않도록 핸들을 대조한다. */
function findTwitterFollowers(json, account) {
  return deepFind(json, node => {
    // 신버전: { legacy: { screen_name, followers_count } } / 구버전: 평평한 객체
    const screen = node.screen_name ?? node.legacy?.screen_name ?? node.core?.screen_name;
    if (!sameAccount(screen, account)) return null;
    const c = node.followers_count ?? node.legacy?.followers_count
      ?? node.relationship_counts?.followers ?? node.followers?.count;
    return typeof c === 'number' ? c : null;
  });
}

/** 인스타 응답에서 이 계정의 팔로워 수. */
function findInstagramFollowers(json, account) {
  return deepFind(json, node => {
    if (!sameAccount(node.username, account)) return null;
    const c = node.follower_count ?? node.edge_followed_by?.count ?? node.followers_count;
    return typeof c === 'number' ? c : null;
  });
}

/**
 * 화면에 보이는 줄임 표기를 숫자로. '12.3K'·'1.2만'·'8,432'·'1.1M' 등.
 * 줄임 표기는 되돌릴 때 반올림 오차가 그대로 남는다(12.3K → 12300, 실제론 12,251일 수 있음).
 * 그래서 이 경로로 읽은 값에는 반드시 approx 표시를 붙인다.
 */
function parseCount(text) {
  if (!text) return null;
  const s = String(text).replace(/\s|,/g, '');
  const m = s.match(/([\d.]+)\s*([KkMmBb만천억]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, k: 1e3, M: 1e6, m: 1e6, B: 1e9, b: 1e9, 천: 1e3, 만: 1e4, 억: 1e8 }[m[2]] || 1;
  return Math.round(n * mult);
}

/**
 * 프로필 페이지를 열기 "전에" 호출해서 응답 가로채기를 걸어둔다.
 * goto 뒤에 걸면 이미 지나간 응답을 놓친다(인스타 릴스 지표에서 겪었던 것과 같은 함정).
 * @returns {{ read: (page) => Promise<{count:number|null, from:string, approx:boolean}> }}
 */
function watchFollowers(page, { platform, account }) {
  const isX = platform === 'twitter';
  let fromApi = null;

  const onResponse = async (res) => {
    if (fromApi !== null) return;
    const url = res.url();
    if (!/graphql|api\/v1|UserBy|web_profile_info/i.test(url)) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const json = await res.json();
      const c = isX ? findTwitterFollowers(json, account) : findInstagramFollowers(json, account);
      if (typeof c === 'number') fromApi = c;
    } catch { /* 본문이 이미 사라졌거나 JSON이 아님 — 조용히 넘어간다 */ }
  };
  page.on('response', onResponse);

  return {
    async read() {
      try {
        if (typeof fromApi === 'number') return { count: fromApi, from: 'api', approx: false };

        // 2순위 — 화면 글자. 못 읽어도 수집 자체는 계속돼야 하므로 예외를 밖으로 던지지 않는다.
        const text = await page.evaluate((isX) => {
          if (isX) {
            const a = document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');
            return a ? a.innerText : null;
          }
          // 인스타는 og:description에 "1,234 Followers, ..." 형태로 정확한 수가 들어있는 경우가 많다
          const og = document.querySelector('meta[property="og:description"]')?.content || '';
          const m = og.match(/([\d.,]+[KkMm만천]?)\s*Followers/i) || og.match(/팔로워\s*([\d.,]+[KkMm만천]?)/);
          if (m) return m[1];
          const li = [...document.querySelectorAll('header li, header a')]
            .find(e => /followers|팔로워/i.test(e.innerText));
          return li ? li.innerText : null;
        }, isX).catch(() => null);

        const n = parseCount(text);
        if (typeof n === 'number') return { count: n, from: 'dom', approx: true };
        return { count: null, from: 'none', approx: false };
      } finally {
        page.off('response', onResponse);
      }
    },
  };
}

module.exports = { watchFollowers, parseCount, findTwitterFollowers, findInstagramFollowers };
