/**
 * 수집 결과(twitter.js / instagram.js 출력) 취합 로직.
 * 브라우저/세션 없이도 순수 함수로 동작 — verify-mock.js로 검증 가능.
 */

// "1.2만", "3천", "1.2K", "3.4M", "12,345" 등 표기를 숫자로 변환.
// 파싱 실패 시 null (호출 측에서 "파싱 실패 건수"로 투명하게 집계).
function parseCount(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  const m = s.match(/^([\d,]+(?:\.\d+)?)\s*(만|천|k|m)?$/i);
  if (!m) return null;

  const base = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(base)) return null;

  const unit = (m[2] || '').toLowerCase();
  switch (unit) {
    case '만': return Math.round(base * 10000);
    case '천': return Math.round(base * 1000);
    case 'k': return Math.round(base * 1000);
    case 'm': return Math.round(base * 1000000);
    default: return Math.round(base);
  }
}

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

// 당사 템플릿: 본문 첫 줄이 상품명 ("[예약시작] 은혼 GEM 피규어\n\n..." → "은혼 GEM 피규어")
function extractOwnProductName(text) {
  if (!text) return null;
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.replace(/^\[[^\]]*\]\s*/, '').trim() || null; // 앞의 "[예약시작]" 등 태그 제거
}

// 구조적 라벨 줄("박스 :", "단품 :" 등) — 경쟁사가 링크를 여러 개 나눠 걸 때 각 링크 위에
// 붙는 짧은 라벨이라 상품명이 아님. 이 줄을 만나면 무시하고 더 위쪽 줄을 찾음.
const STRUCTURAL_LABEL_LINE = /^(박스|단품|특전|특전\s*세트|일반품\s*세트?)\s*:?\s*$/;

// 경쟁사 템플릿: "바로가기"/링크가 있는 줄 바로 위(구조적 라벨 줄은 건너뜀)가 상품명
// ("✔️G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트\n\n🛍️바로가기 : https://...")
function extractCompetitorProductName(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim());
  const linkIdx = lines.findIndex(l => /바로가기|http/i.test(l));
  if (linkIdx > 0) {
    for (let i = linkIdx - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      if (STRUCTURAL_LABEL_LINE.test(lines[i])) continue;
      return lines[i].replace(/^[✔✅☑️\s]+/, '').trim() || null;
    }
  }
  // 백업: 링크 줄을 못 찾으면 ✔️로 시작하는 줄을 그냥 찾음
  const checkLine = lines.find(l => /^[✔✅☑️]/.test(l));
  return checkLine ? checkLine.replace(/^[✔✅☑️\s]+/, '').trim() || null : null;
}

// 매칭에 쓰기엔 너무 흔한 단어(브랜드/시리즈/판매/공지/URL 관련 상용구) — 이 단어들만
// 겹쳐서는 같은 상품으로 보지 않음. **부분 포함(substring)으로 걸러냄** — 한국어는
// 띄어쓰기 없이 붙여 쓰는 경우가 많아서("예약시작", "정보공개") 정확히 일치하는 단어만
// 걸러내면 놓치는 경우가 많았음. 실제 매칭 결과 보고 계속 추가해나가면 됨.
// ⚠️ KNOWN_PRODUCT_LINES(룩업/GEM/컬렉션 등)도 매칭 단계에서는 반드시 같이 제외해야 함 —
// 여러 프랜차이즈가 같은 상품 라인을 공유해서, 안 그러면 그걸로 전부 하나로 묶여버림.
const GENERIC_KEYWORDS = [
  '메가하우스', '프레젠스월드', '프레젠스', '월드', '베스트하비', 'GEM', 'G.E.M', '시리즈', '피규어',
  '액션', '세트', '예약', '판매', '할인', '혜택', '마감', '발매', '캠페인', '공식', '스토어',
  '신제품', '특가', '한정', '재입고', '정품', '구매', '바로가기', '이벤트', '사전', '오픈', '입고',
  '정보', '공개', '쿠폰', '발급', '안내', '참여', '당첨', '감사', '진행', '완료', '확인', '전체',
  '구경', '클릭', '링크', '프로필', '알림', '세컨드', '재판', '리뉴얼', '복간', '한정판', '개시',
  '시작', '기간', '예정', '상품', '제품', '품절', '가격', '박스', '단품', '특전', '일반품',
  '버전', 'Ver',
  // 팔로우 유도 등 반복 상용구(여러 프랜차이즈 게시물에 그대로 재사용돼서 매칭 오염됨)
  '팔로우하고', '기다리는', '굿즈의', '후속', '가장', '빠르게', '받아보세요',
  // 인스타 "구매는 프로필 링크를 참고해 주세요!" 등 반복 CTA 문구
  '참고해', '참조', '참고', '주세요', '해주세요', '하단', '구성', '자세한', '내용',
  'mkt', 'shopping', 'naver', 'com', 'link', 'https', 'site',
];

// naver.com 등 상품 링크 줄을 통째로 제거. 이 링크 뒤에 붙는 해시값(예: "6a44b667b")은
// 16진수라 a~f 알파벳 6개뿐이라, 숫자만 지우고 남기면 무관한 게시물끼리도 "ca", "ef" 같은
// 조각이 우연히 겹쳐서 전부 하나로 잘못 뭉쳐지는 문제가 있었음 — 그래서 낱말 단위 제외가
// 아니라 그 줄 자체를 통째로 지워야 함.
function stripUrlNoise(text) {
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true; // 빈 줄은 무해하니 유지
    if (/^https?:\/\//i.test(t)) return false;
    if (/naver\.com|\.com\//i.test(t)) return false;
    if (/^[a-f0-9]{8,}$/i.test(t)) return false; // 순수 16진수 해시 줄
    if (/^[.…]+$/.test(t)) return false; // "…" / "..."
    return true;
  }).join('\n');
}

// 상품명 매칭용 키워드 추출. **본문 전체**를 대상으로 함 — 자사/경쟁사 둘 다 실제
// 프랜차이즈명이 제목 한 줄이 아니라 본문 여기저기(본문 중간 줄 + 해시태그)에 흩어져
// 있어서, 좁은 "제목 한 줄"만 보면 진짜 식별 정보를 놓치는 경우가 많았음.
// (예: 경쟁사는 "원피스 #ワンピース" 프랜차이즈 줄과 "토비마스 원피스 (재판)" 상품 줄이
// 따로 떨어져 있고, 자사는 첫 줄엔 라인명만 있고 구체적 상품명은 3~4줄 아래에 있음)
// 상용구/라인명 제거는 토큰을 통째로 버리지 않고 **문자열에서 부분 제거**하는 방식 —
// "배리어블액션"처럼 붙여 쓴 단어에서 "액션"만 지우고 "배리어블"은 남기기 위함.
// 토큰은 한글/영문 글자만 인정(숫자 제외) — "26년", "7월" 같은 날짜가 자동으로 안 걸림.
function extractKeywords(text) {
  if (!text) return [];
  let cleaned = stripUrlNoise(text)
    .replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, '') // "G.E.M." → "GEM"
    .replace(/\[[^\]]*\]/g, ' '); // "[예약시작]", "[채색원형 최초공개]" 같은 브라켓 태그는 통째로
                                  // 제거 — 안 지우면 서로 다른 상품 게시물에 반복돼서 그 브라켓
                                  // 안 문구(예: "채색원형", "최초") 하나로 무관한 상품들이 엮임
  [...GENERIC_KEYWORDS, ...KNOWN_PRODUCT_LINES].forEach(g => {
    cleaned = cleaned.replace(new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  });
  const tokens = cleaned.match(/[\p{L}]+/gu) || [];
  return [...new Set(tokens.filter(t => t.length >= 2))];
}

// 상품별 표에서 PW/BH를 나란히 놓을 때 쓰는 지표 순서 (트위터는 리트윗 먼저, 인스타는 좋아요 먼저)
const PRODUCT_TABLE_FIELD_ORDER = {
  twitter: ['retweets', 'likes'],
  instagram: ['likes', 'comments'],
};

// 알려진 메가하우스 상품 라인명 — 본문에서 이 중 하나를 찾으면 "시리즈"로 분리하고
// 나머지를 "IP"(캐릭터/작품명)로 봄. 지금까지 실제로 나온 것들만 채워뒀으니, 새로운
// 라인명이 나오면 계속 추가해야 함(예: 여기 없는 라인명은 시리즈 칸이 빈 채로 나감).
const KNOWN_PRODUCT_LINES = [
  '룩업', 'Look Up', 'GEM', 'G.E.M', '메가캣', 'MegaCat', '테노히라', '컬렉션', 'Collection',
  'GGG', 'G.M.G', 'GMG', '쁘띠라마', 'INSIDE FANTASY',
];

// 상품명 문자열에서 "시리즈"(알려진 상품 라인)를 분리해내고, 남은 부분을 "IP"로 정리.
function splitIpAndLine(title) {
  if (!title) return { ip: null, line: null };
  let remaining = title.replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, ''); // "G.E.M." → "GEM"

  let line = null;
  for (const candidate of KNOWN_PRODUCT_LINES) {
    const idx = remaining.toLowerCase().indexOf(candidate.toLowerCase());
    if (idx !== -1) {
      line = candidate;
      remaining = remaining.slice(0, idx) + remaining.slice(idx + candidate.length);
      break;
    }
  }

  GENERIC_KEYWORDS.forEach(g => {
    remaining = remaining.replace(new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  });
  remaining = remaining
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\d+\s*(년|월|일)?/g, ' ') // "26년", "7월" 등 날짜 표현 통째로 제거
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); // 앞뒤에 남은 이모지/기호("📢", "!") 제거

  return { ip: remaining || null, line };
}

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

// UTC ISO datetime → KST 기준 "H:MM" (예: "3:26")
function formatKstTime(isoDatetime) {
  const utc = new Date(isoDatetime);
  const kst = new Date(utc.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCHours()}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

function earliestDatetime(posts) {
  return posts.reduce((min, p) => {
    const d = new Date(p.datetime);
    return !min || d < min ? d : min;
  }, null);
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
 */
function buildProductComparison(ownPosts, competitorPosts, fields, textField, displayFields) {
  const ownEntries = ownPosts.map(post => ({ side: 'own', post, title: extractOwnProductName(post[textField]) }));
  const competitorEntries = competitorPosts.map(post => ({ side: 'competitor', post, title: extractCompetitorProductName(post[textField]) }));
  // 매칭(그룹화) 판단은 좁은 title 한 줄이 아니라 본문 전체 텍스트 기준 — 프랜차이즈명이
  // title 추출 규칙이 못 잡는 다른 줄/해시태그에 있는 경우가 많아서(위 extractKeywords 설명 참고)
  const entries = [...ownEntries, ...competitorEntries].map(e => ({ ...e, keywords: extractKeywords(e.post[textField]) }));

  // Union-Find: 키워드가 **2개 이상** 겹치는 게시물들을 같은 상품 그룹으로 묶음.
  // 딱 1개만 겹쳐도 매칭시켰을 때, 실제 데이터에서 상용구 제외 목록에 없는 단어 하나
  // (예: "SET", "버전")가 우연히 겹치는 것만으로 서로 다른 프랜차이즈 게시물들이 사슬처럼
  // 전부 연결돼버리는 문제가 반복적으로 나왔음. 2개 이상 요구하면 그런 우연한 단일 단어
  // 충돌은 걸러지고, 진짜 같은 상품(프랜차이즈명 + 구체적 단어 등 최소 2개 겹침)은 잘 잡힘.
  const MIN_SHARED_KEYWORDS = 2;
  const parent = entries.map((_, i) => i);
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  function union(i, j) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].keywords.length === 0) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].keywords.length === 0) continue;
      const overlap = entries[i].keywords.filter(k => entries[j].keywords.includes(k));
      if (overlap.length >= MIN_SHARED_KEYWORDS) union(i, j);
    }
  }

  const groups = new Map();
  entries.forEach((e, i) => {
    if (e.keywords.length === 0) return; // 상품명을 못 뽑았으면 그룹화 대상 아님(매칭 안 됨으로)
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  });

  const matchedPosts = new Set();
  const products = [];
  groups.forEach(group => {
    const ownInGroup = group.filter(e => e.side === 'own');
    const competitorInGroup = group.filter(e => e.side === 'competitor');
    if (ownInGroup.length === 0 || competitorInGroup.length === 0) return; // 양쪽 다 있어야 "비교"

    const ownSummary = summarizeAccount({ platform: null, account: 'PW', posts: ownInGroup.map(e => e.post), fields });
    const competitorSummary = summarizeAccount({ platform: null, account: 'BH', posts: competitorInGroup.map(e => e.post), fields });
    const { ip, line } = splitIpAndLine(ownInGroup[0].title || competitorInGroup[0].title);

    const pwTime = earliestDatetime(ownInGroup.map(e => e.post));
    const bhTime = earliestDatetime(competitorInGroup.map(e => e.post));
    const timeDiffMinutes = Math.round(Math.abs(pwTime - bhTime) / 60000);

    const diffs = {};
    const diffText = {};
    displayFields.forEach(f => {
      diffs[f] = ownSummary[`total_${f}`] - competitorSummary[`total_${f}`];
      diffText[f] = formatDiffWithMultiplier(ownSummary[`total_${f}`], competitorSummary[`total_${f}`]);
    });
    const diffValues = displayFields.map(f => diffs[f]);
    const verdict = diffValues.every(d => d > 0) ? '우세' : diffValues.every(d => d < 0) ? '약세' : '경합';

    group.forEach(e => matchedPosts.add(e.post));
    products.push({
      ip, line,
      own: ownSummary, competitor: competitorSummary,
      ownPosts: ownInGroup.map(e => e.post), competitorPosts: competitorInGroup.map(e => e.post),
      pwTime: formatKstTime(pwTime), bhTime: formatKstTime(bhTime), timeDiffMinutes,
      diffText, verdict,
    });
  });
  // 표시 지표(보통 리트윗/좋아요) 합산 큰 상품 먼저 — 임팩트 큰 것부터 보이게
  const impact = p => displayFields.reduce((sum, f) => sum + p.own[`total_${f}`] + p.competitor[`total_${f}`], 0);
  products.sort((a, b) => impact(b) - impact(a));

  const ownUnmatched = ownPosts.filter(p => !matchedPosts.has(p));
  const competitorUnmatched = competitorPosts.filter(p => !matchedPosts.has(p));

  return { products, ownUnmatched, competitorUnmatched, displayFields };
}

/**
 * @param {object} input
 * @param {string} input.startDate
 * @param {string} input.endDate
 * @param {Array<{platform:string, account:string, posts:object[]}>} input.own       자사 계정(들)
 * @param {Array<{platform:string, account:string, posts:object[]}>} input.competitors 경쟁사 계정(들)
 * @returns {object} platform별 비교표 + 비율
 */
function buildComparisonReport({ startDate, endDate, own, competitors }) {
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
    const productComparison = buildProductComparison(ownPosts, competitorPosts, fields, PLATFORM_TEXT_FIELD[platform], displayFields);

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
  formatDiffWithMultiplier,
  formatKstTime,
  buildProductComparison,
  buildComparisonReport,
  PLATFORM_FIELDS,
  PLATFORM_TEXT_FIELD,
  PRODUCT_TABLE_FIELD_ORDER,
  KNOWN_PRODUCT_LINES,
};
