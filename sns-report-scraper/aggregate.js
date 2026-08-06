/**
 * 수집 결과(twitter.js / instagram.js 출력) 취합 로직.
 * 브라우저/세션 없이도 순수 함수로 동작 — verify-mock.js로 검증 가능.
 *
 * 상품명/키워드/라인 추출 로직(parseCount, extractOwnProductName 등)은 matching-core.js로
 * 옮겨져 있음 — 리포트 안 "붙여넣기로 게시물 추가" 기능이 브라우저에서 동일한 로직을 써야
 * 해서 분리함(로직이 두 곳에서 갈라지지 않게 단일 소스).
 */
const {
  parseCount,
  extractOwnProductName,
  extractCompetitorProductName,
  extractKeywords,
  detectProductLine,
  splitIpAndLine,
  KNOWN_PRODUCT_LINES,
} = require('./matching-core');

// 계정 하나의 게시물 목록에서 지표 합계/평균 계산.
// fields: 이 플랫폼에서 집계할 숫자 필드명 목록 (예: ['likes', 'retweets'])
function summarizeAccount({ platform, account, posts, fields }) {
  const summary = { platform, account, postCount: posts.length, parseFailures: {} };

  fields.forEach(field => {
    let total = 0;
    let counted = 0;
    let failures = 0;
    posts.forEach(post => {
      const n = parseCount(post[field]);
      if (n === null) {
        // 원본 값이 명시적으로 없던 게 아니라(null/undefined), 파싱 실패한 경우만 카운트
        if (post[field] !== null && post[field] !== undefined && post[field] !== '') failures++;
        return;
      }
      total += n;
      counted++;
    });
    summary[`total_${field}`] = total;
    summary[`avg_${field}`] = counted > 0 ? Math.round((total / counted) * 10) / 10 : null;
    summary.parseFailures[field] = failures;
  });

  return summary;
}

// 자사 값 대비 경쟁사 값 비율. 경쟁사 값이 0/null이면 비율 계산 불가(N/A).
function compareMetric(ownValue, competitorValue) {
  if (ownValue === null || competitorValue === null || competitorValue === 0) {
    return { own: ownValue, competitor: competitorValue, ratioPercent: null, label: 'N/A' };
  }
  const ratioPercent = Math.round((ownValue / competitorValue) * 1000) / 10; // 소수 1자리
  const diffPercentPoints = Math.round((ratioPercent - 100) * 10) / 10;
  const label = diffPercentPoints >= 0
    ? `자사 우세 (+${diffPercentPoints}%p)`
    : `자사 열세 (${diffPercentPoints}%p)`;
  return { own: ownValue, competitor: competitorValue, ratioPercent, diffPercentPoints, label };
}

const PLATFORM_FIELDS = {
  twitter: ['likes', 'retweets'],
  instagram: ['likes', 'comments'],
};

// 게시물 본문 필드명 — 플랫폼마다 다름 (twitter.js는 text, instagram.js는 caption)
const PLATFORM_TEXT_FIELD = {
  twitter: 'text',
  instagram: 'caption',
};

// 자동 매칭 그룹 하나에 게시물이 비정상적으로 많이 몰리면(상용구 하나로 서로 다른 상품이
// 오묶음됐을 가능성) 매칭 로직 자체는 건드리지 않고, 리포트에 "확인 필요" 표시만 달아서
// 사람이 한 번 더 훑어보게 하는 안전장치.
const PRODUCT_GROUP_REVIEW_THRESHOLD = 5;

// 상품별 표에서 PW/BH를 나란히 놓을 때 쓰는 지표 순서 (트위터는 리트윗 먼저, 인스타는 좋아요 먼저)
const PRODUCT_TABLE_FIELD_ORDER = {
  twitter: ['retweets', 'likes'],
  instagram: ['likes', 'comments'],
};

// PW/BH 두 숫자의 차이와 배수를 "322 (24배)" 형태로. 작은 쪽이 분모가 되어 0으로
// 나뉘는 경우엔 배수 없이 차이만 표시.
function formatDiffWithMultiplier(pw, bh) {
  const diff = Math.round((pw - bh) * 10) / 10;
  if (pw === bh) return `${diff}`;
  const multiplier = pw > bh
    ? (bh === 0 ? null : Math.round((pw / bh) * 10) / 10)
    : (pw === 0 ? null : -Math.round((bh / pw) * 10) / 10);
  return multiplier === null ? `${diff}` : `${diff} (${multiplier}배)`;
}

// UTC ISO datetime → KST 기준 "M/D H:MM" (예: "7/2 17:06"). 날짜도 항상 같이 표시 —
// PW/BH가 같은 상품이라도 다른 날 게시하는 경우가 실제로 많아서(예: 경쟁사가 하루 전에
// 먼저 올림), 시:분만 보여주면 "시각차이"가 왜 24시간 넘게 나오는지 헷갈림.
function formatKstTime(isoDatetime) {
  const utc = new Date(isoDatetime);
  const kst = new Date(utc.getTime() + 9 * 3600 * 1000);
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  return `${month}/${day} ${kst.getUTCHours()}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

function earliestDatetime(posts) {
  return posts.reduce((min, p) => {
    const d = new Date(p.datetime);
    return !min || d < min ? d : min;
  }, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 상품 그룹화 (게시물 → "같은 상품" 묶음)
//
// ⚠️ 이 부분은 원래 Union-Find(겹치는 키워드 2개 이상이면 연결)였는데, 구조적으로 잘못된
// 선택이었음. Union-Find는 **단일연결(single-linkage)** — A-B, B-C만 연결돼도 A-C까지
// 한 그룹이 됨. 그래서 여러 상품을 동시에 언급하는 게시물(월간 신제품 공지, 이벤트/당첨자
// 발표) 하나가 "다리"가 되면 전혀 무관한 상품들이 사슬처럼 전부 한 덩어리가 됨.
// (실제 사례: 트위터 "악입문" 행에 7개 프랜차이즈 38건, 인스타는 45건이 한 덩어리)
//
// 이때 상용구 단어를 GENERIC_KEYWORDS에 계속 추가하는 방식으로 대응했었는데, 그건 사슬을
// 만드는 "방아쇠"를 하나씩 뽑는 것일 뿐 사슬 구조 자체는 그대로라서 끝이 없음 — 실제로
// 인스타는 상용구를 20개 넘게 추가해도 45건에서 거의 줄지 않았음.
// (같은 진단이 stock-report.js의 matchPwBhStockProducts 주석에도 이미 적혀 있음 — 거기선
//  재고 상품 1:1 짝짓기라서 "점수 기반 상호 최선 매칭"으로 해결했지만, SNS 게시물은 한
//  상품에 여러 게시물(원형공개/채색공개/예약시작)이 정상적으로 붙으므로 1:1이 아니라
//  N:M 그룹이 필요해서 그 방식을 그대로 쓸 수 없음)
//
// 그래서 두 가지를 바꿈:
//  (1) **IDF 가중치** — "상용구"의 정의 자체가 "여러 게시물에 반복 등장하는 말"이므로,
//      이 배치 안에서의 등장 빈도로 자동 판별한다. 절반 이상 게시물에 나오는 토큰은
//      가중치 0(사실상 무시), 그 외에는 흔할수록 낮은 가중치. 손으로 목록을 관리하지
//      않아도 새로운 상용구가 자동으로 걸러짐(GENERIC_KEYWORDS는 배치가 작을 때를 위한
//      안전망으로 그대로 유지).
//  (2) **완전연결(complete-linkage) 군집화** — 그룹에 합류하려면 기존 멤버 *전원*과
//      유사도 기준을 넘겨야 한다. 다상품 공지 게시물이 A와도 B와도 각각 닮아 보여도,
//      A와 B가 서로 안 닮으면 세 개가 한 그룹이 되지 못하므로 사슬이 원천적으로 불가능.
// ─────────────────────────────────────────────────────────────────────────────

// 두 게시물을 "같은 상품"으로 볼 최소 유사도(가중치 기준 겹침 비율).
const MIN_PAIR_SCORE = 0.34;
// 유사도와 별개로, 가중치가 살아있는(=모든 게시물에 나오는 말이 아닌) 토큰이 최소 이만큼은
// 겹쳐야 함.
const MIN_SHARED_KEYWORDS = 2;

// 배치 전체의 등장 빈도(document frequency)로 토큰별 가중치를 만듦 — IDF에 하한선을 둔 형태.
//
// ⚠️ 여기서 두 번 헛발질했고 둘 다 verify-mock 회귀 테스트가 잡아냈으니 기록해둠:
//  1) "게시물 절반 이상에 나오면 상용구니까 가중치 0"이라는 비율 하드컷 → 한 상품이 작은
//     배치의 다수를 차지하면(모의 데이터는 7건 중 5건이 같은 상품) 정작 그 상품 이름이
//     상용구로 오판돼 매칭이 통째로 실패. 임의의 비율 임계값 자체가 잘못된 발상이었음.
//  2) 순수 IDF(log(N/df)) → 게시물이 2건뿐인 배치에서는 공유 토큰이 전부 2/2에 등장하므로
//     log(1)=0, 즉 모든 가중치가 0이 되어 역시 매칭 불가.
// 그래서 `1 + log(N/df)`로 **하한선 1을 보장**한다. 어떤 토큰도 완전히 0이 되지 않아 작은
// 배치가 안전하고, 동시에 흔한 토큰(상용구)은 희귀 토큰보다 연속적으로 낮은 가중치를 받아
// 큰 배치에서 상용구의 영향력이 자동으로 줄어든다.
function buildTokenWeights(entries) {
  const df = new Map();
  entries.forEach(e => new Set(e.keywords).forEach(k => df.set(k, (df.get(k) || 0) + 1)));
  const total = entries.length;
  const weights = new Map();
  df.forEach((count, token) => weights.set(token, 1 + Math.log(total / count)));
  return weights;
}

function weightSum(keywords, weights) {
  return keywords.reduce((sum, k) => sum + (weights.get(k) || 0), 0);
}

// 두 게시물의 유사도: 겹친 토큰의 가중치 합 / 양쪽 가중치 합 중 큰 쪽.
// 분모가 "큰 쪽"이라, 키워드가 잔뜩 붙은 게시물(다상품 공지 등)이 짧은 게시물과 일부만
// 겹쳐서 우연히 붙는 것을 억제함(stock-report.js의 점수 계산과 같은 방침).
function pairScore(a, b, weights) {
  if (a.line !== b.line) return 0; // 상품 라인이 다르면 같은 상품일 수 없음(null↔라인도 금지)
  const shared = a.keywords.filter(k => b.keywords.includes(k) && (weights.get(k) || 0) > 0);
  if (shared.length < MIN_SHARED_KEYWORDS) return 0;
  const denom = Math.max(weightSum(a.keywords, weights), weightSum(b.keywords, weights));
  if (denom <= 0) return 0;
  return weightSum(shared, weights) / denom;
}

/**
 * 게시물 목록을 "같은 상품" 그룹으로 묶음(완전연결 군집화).
 * 점수가 높은 쌍부터 순서대로 병합하되, 두 그룹의 모든 교차 쌍이 기준을 넘을 때만 병합 —
 * 한 쌍만 닮았다고 두 그룹이 합쳐지는 사슬(single-linkage) 문제를 구조적으로 차단.
 *
 * @param {Array<{side:string, post:object, title:?string, keywords:string[], line:?string}>} entries
 * @returns {Map<number, Array>} 그룹 대표 인덱스 → 그룹 멤버 배열
 */
function clusterEntriesByProduct(entries) {
  const weights = buildTokenWeights(entries);
  const candidates = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].keywords.length === 0) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].keywords.length === 0) continue;
      const score = pairScore(entries[i], entries[j], weights);
      if (score >= MIN_PAIR_SCORE) candidates.push({ i, j, score });
    }
  }
  // 점수 높은 쌍부터 병합(동점이면 인덱스 순 — 실행마다 결과가 달라지지 않게 결정적으로).
  candidates.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);

  const scoreOf = new Map(candidates.map(c => [`${c.i}:${c.j}`, c.score]));
  const linked = (x, y) => (scoreOf.get(x < y ? `${x}:${y}` : `${y}:${x}`) || 0) >= MIN_PAIR_SCORE;

  // 그룹 = 인덱스 배열. 처음엔 키워드가 있는 게시물마다 1인 그룹으로 시작.
  const groupOf = new Map(); // entry index -> group id
  const members = new Map(); // group id -> [entry index]
  entries.forEach((e, i) => {
    if (e.keywords.length === 0) return;
    groupOf.set(i, i);
    members.set(i, [i]);
  });

  for (const { i, j } of candidates) {
    const gi = groupOf.get(i);
    const gj = groupOf.get(j);
    if (gi === undefined || gj === undefined || gi === gj) continue;
    const mi = members.get(gi);
    const mj = members.get(gj);
    // 완전연결 조건: 두 그룹의 모든 교차 쌍이 기준을 넘어야 병합
    const allLinked = mi.every(a => mj.every(b => linked(a, b)));
    if (!allLinked) continue;
    mj.forEach(b => groupOf.set(b, gi));
    members.set(gi, mi.concat(mj));
    members.delete(gj);
  }

  const groups = new Map();
  members.forEach((idxs, gid) => groups.set(gid, idxs.map(i => entries[i])));
  return groups;
}

/**
 * 자사/경쟁사 게시물을 상품명(본문 템플릿 위치 기반 추출) 기준으로 매칭해서
 * "상품별" 비교표를 만듦(한 상품 = 한 행, PW/BH 값이 나란히). 자사는 첫 줄, 경쟁사는
 * 링크 줄 바로 위 줄에서 상품명을 뽑고, 상품명에서 뽑은 키워드가 하나라도 겹치면
 * 같은 상품으로 그룹화(Union-Find). 상품명이 없거나 겹치는 키워드가 없는 게시물은
 * 매칭 안 됨(unmatched)으로 분리해서 투명하게 보여줌 — 조용히 누락시키지 않음.
 *
 * ⚠️ 순수 텍스트/키워드 매칭이라 완벽하지 않음 — 표현이 아예 다르면 매칭 실패할 수 있고,
 * 흔한 단어(GENERIC_KEYWORDS)가 겹쳐서 상관없는 상품이 잘못 묶일 가능성도 있음. 실제 결과
 * 보고 이상한 매칭/과도한 미매칭 있으면 계속 다듬어야 함.
 *
 * @param {object[]} ownPosts        자사 게시물 전체 (여러 계정 합친 것)
 * @param {object[]} competitorPosts 경쟁사 게시물 전체 (여러 계정 합친 것)
 * @param {string[]} fields          집계할 숫자 필드 (예: ['likes', 'retweets'])
 * @param {string} textField         본문 필드명 ('text' 또는 'caption')
 * @param {string[]} displayFields   상품별 표에 나란히 놓을 지표 순서
 * @param {Array<{pw:string[], bh:string[], label?:string}>} [manualMatches] 수동 매칭 목록
 *   (manual-matches.json) — 여기 지정된 게시물은 자동 매칭보다 먼저 확정되고, 자동 매칭
 *   대상 풀에서 빠짐
 * @param {{pw?:string[], bh?:string[]}} [ignorePosts] 상품이 아닌 공지/이벤트/쿠폰 게시물
 *   (ignore-posts.json) — 계정 총계(팔로워/전체 게시물 지표)에는 그대로 포함되지만, "매칭 안
 *   됨" 목록에는 안 보이게 걸러냄. 조용히 사라지는 게 아니라 "상품이 아니라서 일부러 뺐다"는
 *   걸 명시적으로 관리하는 목록이라는 점이 manualMatches와 다름.
 */
function buildProductComparison(ownPosts, competitorPosts, fields, textField, displayFields, manualMatches = [], ignorePosts = {}) {
  const linkField = textField === 'text' ? 'link' : 'url';
  const { manualProducts, remainingOwn, remainingCompetitor } = extractManualMatches(
    ownPosts, competitorPosts, manualMatches, linkField, fields, displayFields
  );
  ownPosts = remainingOwn;
  competitorPosts = remainingCompetitor;

  // ignorePosts(공지/이벤트 등 상품이 아닌 게시물)는 지금까지 "매칭 안 됨" 목록에서만
  // 안 보이게 걸렀고, 정작 아래 키워드 매칭/그룹화 단계에는 그대로 들어가고 있었음 — 그래서
  // 다상품을 한꺼번에 나열하는 월간 공지 게시물 하나가 서로 다른 캐릭터 그룹들을 죄다
  // 이어붙이는 다리 역할을 해버리는 문제가 있었음(실제 사례: "2026년 8월 메가하우스 신규
  // 상품 안내" 게시물이 여러 프랜차이즈명을 한 게시물에 다 언급해서, 인스타그램 쪽 상품별
  // 비교표가 거의 전부 "신규" 한 그룹으로 뭉쳐버림). 계정 총계(팔로워/전체 게시물 지표)는
  // 이 함수 밖(buildComparisonReport)에서 이미 원본 posts로 따로 계산하니, 여기서 완전히
  // 빼도 총계엔 영향 없음 — 매칭 대상 풀 자체에서 제외.
  const ignoredOwnLinks = new Set(ignorePosts.pw || []);
  const ignoredCompetitorLinks = new Set(ignorePosts.bh || []);
  ownPosts = ownPosts.filter(p => !ignoredOwnLinks.has(p[linkField]));
  competitorPosts = competitorPosts.filter(p => !ignoredCompetitorLinks.has(p[linkField]));

  const ownEntries = ownPosts.map(post => ({ side: 'own', post, title: extractOwnProductName(post[textField]) }));
  const competitorEntries = competitorPosts.map(post => ({ side: 'competitor', post, title: extractCompetitorProductName(post[textField]) }));
  // 매칭(그룹화) 판단은 좁은 title 한 줄이 아니라 본문 전체 텍스트 기준 — 프랜차이즈명이
  // title 추출 규칙이 못 잡는 다른 줄/해시태그에 있는 경우가 많아서(위 extractKeywords 설명 참고)
  const entries = [...ownEntries, ...competitorEntries].map(e => ({
    ...e,
    keywords: extractKeywords(e.post[textField]),
    line: detectProductLine(e.post[textField]),
  }));

  const groups = clusterEntriesByProduct(entries);

  const matchedPosts = new Set();
  const products = [...manualProducts];
  groups.forEach(group => {
    const ownInGroup = group.filter(e => e.side === 'own').map(e => e.post);
    const competitorInGroup = group.filter(e => e.side === 'competitor').map(e => e.post);
    if (ownInGroup.length === 0 || competitorInGroup.length === 0) return; // 양쪽 다 있어야 "비교"

    const titleHint = (group.find(e => e.side === 'own') || {}).title || (group.find(e => e.side === 'competitor') || {}).title;
    const lineHint = group.map(e => e.line).find(Boolean) || null;
    group.forEach(e => matchedPosts.add(e.post));
    products.push(buildProductEntry(ownInGroup, competitorInGroup, fields, displayFields, titleHint, lineHint));
  });
  // 표시 지표(보통 리트윗/좋아요) 합산 큰 상품 먼저 — 임팩트 큰 것부터 보이게
  const impact = p => displayFields.reduce((sum, f) => sum + p.own[`total_${f}`] + p.competitor[`total_${f}`], 0);
  products.sort((a, b) => impact(b) - impact(a));

  // ignorePosts는 위에서 이미 매칭 풀 자체에서 뺐으므로(ownPosts/competitorPosts가 이미
  // 걸러진 상태), 여기선 matchedPosts만 제외하면 됨.
  const ownUnmatched = ownPosts.filter(p => !matchedPosts.has(p));
  const competitorUnmatched = competitorPosts.filter(p => !matchedPosts.has(p));

  return { products, ownUnmatched, competitorUnmatched, displayFields };
}

// 게시물 묶음(자동 매칭이든 수동 지정이든) 하나로 "상품별 비교" 행 하나를 만듦.
// buildProductComparison(자동 매칭)과 applyManualMatches(수동 매칭)가 공통으로 사용.
function buildProductEntry(ownPosts, competitorPosts, fields, displayFields, titleHint, lineHint, isManual = false) {
  const ownSummary = summarizeAccount({ platform: null, account: 'PW', posts: ownPosts, fields });
  const competitorSummary = summarizeAccount({ platform: null, account: 'BH', posts: competitorPosts, fields });
  const { ip, line } = splitIpAndLine(titleHint, lineHint);

  const pwTime = earliestDatetime(ownPosts);
  const bhTime = earliestDatetime(competitorPosts);
  // 양수면 BH가 PW보다 늦게 올림(PW가 먼저), 음수면 BH가 먼저 — PW 시각을 기준선(0)으로 봤을 때
  // BH가 어느 쪽으로 얼마나 떨어져 있는지를 나타내는 부호 있는 값.
  const timeDiffSignedMinutes = Math.round((bhTime - pwTime) / 60000);
  const timeDiffMinutes = Math.abs(timeDiffSignedMinutes);
  // 화면의 시각은 분까지만 표시하는데(예: "17:02") 차이는 초 단위로 계산해 반올림하다 보니
  // "17:02 / 17:02 → −1분"처럼 모순돼 보이는 문제가 있었음(계산은 정확했고 표시가 헷갈렸던 것).
  // 1분 미만 차이는 초로 보여주려고 초 단위 값도 같이 넘김.
  const timeDiffSignedSeconds = Math.round((bhTime - pwTime) / 1000);

  const diffs = {};
  const diffText = {};
  displayFields.forEach(f => {
    diffs[f] = ownSummary[`total_${f}`] - competitorSummary[`total_${f}`];
    diffText[f] = formatDiffWithMultiplier(ownSummary[`total_${f}`], competitorSummary[`total_${f}`]);
  });
  const diffValues = displayFields.map(f => diffs[f]);
  // 양쪽 지표가 전부 0이면 "경합"(접전)이 아니라 판단할 근거가 없는 것 — 예전엔 리트윗 0
  // 좋아요 0인 행까지 "경합"으로 나와서 "박빙이었다"는 뜻으로 잘못 읽혔음(실제로는 둘 다
  // 반응이 없었던 것). 표시를 분리해서 오해를 없앰.
  const allZero = displayFields.every(f => ownSummary[`total_${f}`] === 0 && competitorSummary[`total_${f}`] === 0);
  const verdict = allZero ? '지표 없음'
    : diffValues.every(d => d > 0) ? '우세'
    : diffValues.every(d => d < 0) ? '약세'
    : '경합';
  const needsReview = !isManual && (ownPosts.length + competitorPosts.length) >= PRODUCT_GROUP_REVIEW_THRESHOLD;

  return {
    ip, line,
    own: ownSummary, competitor: competitorSummary,
    ownPosts, competitorPosts,
    pwTime: formatKstTime(pwTime), bhTime: formatKstTime(bhTime), timeDiffMinutes, timeDiffSignedMinutes, timeDiffSignedSeconds,
    diffText, verdict, needsReview,
  };
}

/**
 * 수동 매칭 목록(manual-matches.json)을 자동 매칭 이전에 적용. 지정된 게시물들은
 * 자동 매칭 대상 풀에서 미리 빼내서 별도로 상품 행을 만듦 — 자동/수동이 겹치지 않게.
 *
 * @param {object[]} ownPosts
 * @param {object[]} competitorPosts
 * @param {Array<{pw:string[], bh:string[], label?:string}>} manualMatches  pw/bh는 게시물 링크(link 또는 url) 목록
 * @param {string} linkField  'link'(트위터) 또는 'url'(인스타)
 * @returns {{ manualProducts: object[], remainingOwn: object[], remainingCompetitor: object[] }}
 */
function extractManualMatches(ownPosts, competitorPosts, manualMatches, linkField, fields, displayFields) {
  if (!manualMatches || manualMatches.length === 0) {
    return { manualProducts: [], remainingOwn: ownPosts, remainingCompetitor: competitorPosts };
  }

  const usedOwn = new Set();
  const usedCompetitor = new Set();
  const manualProducts = manualMatches.map(entry => {
    const own = ownPosts.filter(p => (entry.pw || []).includes(p[linkField]));
    const competitor = competitorPosts.filter(p => (entry.bh || []).includes(p[linkField]));
    own.forEach(p => usedOwn.add(p));
    competitor.forEach(p => usedCompetitor.add(p));
    const textField = linkField === 'link' ? 'text' : 'caption';
    const titleHint = entry.label || extractOwnProductName(own[0]?.[textField]) || extractCompetitorProductName(competitor[0]?.[textField]);
    const product = buildProductEntry(own, competitor, fields, displayFields, titleHint, null, true);
    // label을 사람이 직접 지정했으면 splitIpAndLine의 자동 정리(상용구 제거 등)를 거치지 않고
    // 그대로 사용 — 라벨 안에 우연히 "상품" 같은 제외 단어가 들어있어도 잘려나가면 안 되니까
    if (entry.label) product.ip = entry.label;
    return product;
  }).filter(p => p.ownPosts.length > 0 && p.competitorPosts.length > 0); // pw/bh 둘 다 실제로 매칭된 링크가 있어야 함

  return {
    manualProducts,
    remainingOwn: ownPosts.filter(p => !usedOwn.has(p)),
    remainingCompetitor: competitorPosts.filter(p => !usedCompetitor.has(p)),
  };
}

/**
 * 리포트의 "붙여넣기로 게시물 추가" 기능(html-report.js)이 내보낸 manual-posts.json을
 * 실제 수집 결과(own/competitors)에 합쳐줌 — 스크래퍼가 놓친 게시물(예: 화면 렌더링 타이밍
 * 문제로 누락된 트윗)을 사람이 직접 채워넣을 수 있게. manual-matches.json(이미 수집된
 * 게시물끼리 짝짓기)과 다르게, 이건 아예 존재하지 않던 새 게시물 데이터 자체를 추가하는
 * 것 — 그래서 "합쳐진 뒤"엔 평소 자동 매칭(buildProductComparison)이 그대로 다시 돌아서
 * 다른 게시물과 알아서 그룹화됨(수동으로 어느 상품에 넣을지 지정할 필요 없음).
 *
 * @param {Array<{platform:string, account:string, posts:object[]}>} own
 * @param {Array<{platform:string, account:string, posts:object[]}>} competitors
 * @param {object} manualPosts { twitter: { pw: object[], bh: object[] }, instagram: {...} }
 * @returns {{ own: object[], competitors: object[] }} 수동 추가분이 "(수동 추가)" 계정으로
 *   덧붙여진 새 배열(원본은 변경 안 함)
 */
function applyManualPosts(own, competitors, manualPosts = {}) {
  const extraAccount = (platform, posts) => ({ platform, account: '(수동 추가)', posts });

  const ownExtra = Object.entries(manualPosts)
    .filter(([, sides]) => (sides.pw || []).length > 0)
    .map(([platform, sides]) => extraAccount(platform, sides.pw));
  const competitorExtra = Object.entries(manualPosts)
    .filter(([, sides]) => (sides.bh || []).length > 0)
    .map(([platform, sides]) => extraAccount(platform, sides.bh));

  return {
    own: [...own, ...ownExtra],
    competitors: [...competitors, ...competitorExtra],
  };
}

/**
 * @param {object} input
 * @param {string} input.startDate
 * @param {string} input.endDate
 * @param {Array<{platform:string, account:string, posts:object[]}>} input.own       자사 계정(들)
 * @param {Array<{platform:string, account:string, posts:object[]}>} input.competitors 경쟁사 계정(들)
 * @param {object} [input.manualMatches] 플랫폼별 수동 매칭 목록 (예: { twitter: [...], instagram: [...] })
 *   — manual-matches.json 내용을 그대로 넘기면 됨. 파일 읽기는 이 함수를 호출하는 쪽(run-megahouse.js 등)
 *   책임이고, aggregate.js는 순수 함수로 유지.
 * @param {object} [input.ignorePosts] 플랫폼별 "상품 아닌 공지/이벤트" 게시물 목록 (예:
 *   { twitter: {pw:[], bh:[...]}, instagram: {...} }) — ignore-posts.json 내용을 그대로 넘기면 됨.
 * @returns {object} platform별 비교표 + 비율
 */
function buildComparisonReport({ startDate, endDate, own, competitors, manualMatches = {}, ignorePosts = {} }) {
  const platforms = {};

  const allCollections = [...own, ...competitors];
  const platformNames = [...new Set(allCollections.map(c => c.platform))];

  platformNames.forEach(platform => {
    const fields = PLATFORM_FIELDS[platform];
    if (!fields) {
      throw new Error(`알 수 없는 플랫폼: ${platform} (지원: ${Object.keys(PLATFORM_FIELDS).join(', ')})`);
    }

    const ownAccounts = own.filter(c => c.platform === platform).map(c => summarizeAccount({ ...c, fields }));
    const competitorAccounts = competitors.filter(c => c.platform === platform).map(c => summarizeAccount({ ...c, fields }));

    // 자사 여러 계정이면 합산(같은 브랜드로 취급), 경쟁사는 계정별로 각각 비교 + 평균도 별도 제공
    const ownTotals = { postCount: 0 };
    fields.forEach(f => { ownTotals[`total_${f}`] = 0; });
    ownAccounts.forEach(a => {
      ownTotals.postCount += a.postCount;
      fields.forEach(f => { ownTotals[`total_${f}`] += a[`total_${f}`]; });
    });
    fields.forEach(f => {
      ownTotals[`avg_${f}`] = ownTotals.postCount > 0
        ? Math.round((ownTotals[`total_${f}`] / ownTotals.postCount) * 10) / 10
        : null;
    });

    const perCompetitorComparison = competitorAccounts.map(comp => {
      const metrics = {};
      fields.forEach(f => {
        metrics[`total_${f}`] = compareMetric(ownTotals[`total_${f}`], comp[`total_${f}`]);
        metrics[`avg_${f}`] = compareMetric(ownTotals[`avg_${f}`], comp[`avg_${f}`]);
      });
      metrics.postCount = compareMetric(ownTotals.postCount, comp.postCount);
      return { account: comp.account, metrics };
    });

    // 경쟁사 평균(계정이 여러 개일 때 전체 트렌드 파악용)
    let competitorAverage = null;
    if (competitorAccounts.length > 0) {
      competitorAverage = { postCount: 0 };
      fields.forEach(f => { competitorAverage[`total_${f}`] = 0; competitorAverage[`avg_${f}`] = 0; });
      competitorAccounts.forEach(c => {
        competitorAverage.postCount += c.postCount;
        fields.forEach(f => {
          competitorAverage[`total_${f}`] += c[`total_${f}`];
          competitorAverage[`avg_${f}`] += (c[`avg_${f}`] || 0);
        });
      });
      const n = competitorAccounts.length;
      competitorAverage.postCount = Math.round((competitorAverage.postCount / n) * 10) / 10;
      fields.forEach(f => {
        competitorAverage[`total_${f}`] = Math.round((competitorAverage[`total_${f}`] / n) * 10) / 10;
        competitorAverage[`avg_${f}`] = Math.round((competitorAverage[`avg_${f}`] / n) * 10) / 10;
      });
    }

    const vsAverage = competitorAverage ? (() => {
      const metrics = {};
      fields.forEach(f => {
        metrics[`total_${f}`] = compareMetric(ownTotals[`total_${f}`], competitorAverage[`total_${f}`]);
        metrics[`avg_${f}`] = compareMetric(ownTotals[`avg_${f}`], competitorAverage[`avg_${f}`]);
      });
      metrics.postCount = compareMetric(ownTotals.postCount, competitorAverage.postCount);
      return metrics;
    })() : null;

    const ownPosts = own.filter(c => c.platform === platform).flatMap(c => c.posts);
    const competitorPosts = competitors.filter(c => c.platform === platform).flatMap(c => c.posts);
    const displayFields = PRODUCT_TABLE_FIELD_ORDER[platform] || fields;
    const productComparison = buildProductComparison(
      ownPosts, competitorPosts, fields, PLATFORM_TEXT_FIELD[platform], displayFields,
      manualMatches[platform] || [], ignorePosts[platform] || {}
    );

    platforms[platform] = {
      fields,
      own: ownAccounts,
      ownTotals,
      competitors: competitorAccounts,
      competitorAverage,
      perCompetitorComparison,
      vsAverage,
      productComparison,
    };
  });

  return { startDate, endDate, generatedAt: new Date().toISOString(), platforms };
}

module.exports = {
  parseCount,
  summarizeAccount,
  compareMetric,
  extractOwnProductName,
  extractCompetitorProductName,
  extractKeywords,
  splitIpAndLine,
  detectProductLine,
  formatDiffWithMultiplier,
  formatKstTime,
  buildProductEntry,
  extractManualMatches,
  buildProductComparison,
  buildComparisonReport,
  applyManualPosts,
  PLATFORM_FIELDS,
  PLATFORM_TEXT_FIELD,
  PRODUCT_TABLE_FIELD_ORDER,
  KNOWN_PRODUCT_LINES,
};
