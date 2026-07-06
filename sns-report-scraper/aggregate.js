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

// 경쟁사 템플릿: "바로가기"/링크가 있는 줄 바로 위 줄이 상품명
// ("✔️G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트\n\n🛍️바로가기 : https://...")
function extractCompetitorProductName(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim());
  const linkIdx = lines.findIndex(l => /바로가기|http/i.test(l));
  if (linkIdx > 0) {
    for (let i = linkIdx - 1; i >= 0; i--) {
      if (lines[i]) return lines[i].replace(/^[✔✅☑️\s]+/, '').trim() || null;
    }
  }
  // 백업: 링크 줄을 못 찾으면 ✔️로 시작하는 줄을 그냥 찾음
  const checkLine = lines.find(l => /^[✔✅☑️]/.test(l));
  return checkLine ? checkLine.replace(/^[✔✅☑️\s]+/, '').trim() || null : null;
}

// 매칭에 쓰기엔 너무 흔한 단어(브랜드/시리즈/판매/공지 관련 상용구) — 이 단어들만 겹쳐서는
// 같은 상품으로 보지 않음. **부분 포함(substring)으로 걸러냄** — 한국어는 띄어쓰기 없이
// 붙여 쓰는 경우가 많아서("예약시작", "정보공개") 정확히 일치하는 단어만 걸러내면 놓치는
// 경우가 많았음. 실제 매칭 결과 보고 계속 추가해나가면 됨.
const GENERIC_KEYWORDS = [
  '메가하우스', 'GEM', 'G.E.M', '시리즈', '피규어', '액션', '세트', '예약', '판매', '할인', '혜택',
  '마감', '발매', '캠페인', '공식', '스토어', '신제품', '특가', '한정', '재입고', '정품', '구매',
  '바로가기', '이벤트', '사전', '오픈', '입고', '정보', '공개', '쿠폰', '발급', '안내', '참여',
  '당첨', '감사', '진행', '완료', '확인', '전체', '구경', '클릭', '링크', '프로필', '알림',
  '세컨드', '재판', '리뉴얼', '복간', '한정판',
];

// 상품명 텍스트에서 매칭용 키워드만 추출 (한글/영문 토큰, 상용구/숫자 제외)
function extractKeywords(title) {
  if (!title) return [];
  const normalized = title.replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, ''); // "G.E.M." → "GEM"
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.filter(t =>
    t.length >= 2
    && !/\d/.test(t) // "26년", "7월" 같은 날짜/숫자 토큰은 거의 모든 게시물에 공통으로 등장해서
                     // 매칭 신호로 못 씀 — 이걸 걸러내지 않으면 날짜 하나로 전체 게시물이
                     // 사슬처럼 다 이어져서 하나의 "상품"으로 잘못 뭉쳐짐
    && !GENERIC_KEYWORDS.some(g => t.includes(g))
  ))];
}

/**
 * 자사/경쟁사 게시물을 상품명(본문 템플릿 위치 기반 추출) 기준으로 매칭해서
 * "상품별" 비교표를 만듦. 자사는 첫 줄, 경쟁사는 링크 줄 바로 위 줄에서 상품명을 뽑고,
 * 상품명에서 뽑은 키워드가 하나라도 겹치면 같은 상품으로 그룹화(Union-Find).
 * 상품명이 없거나(템플릿과 다른 형식) 겹치는 키워드가 없는 게시물은 매칭 안 됨(unmatched)으로
 * 분리해서 투명하게 보여줌 — 조용히 누락시키지 않음.
 *
 * ⚠️ 순수 텍스트/키워드 매칭이라 완벽하지 않음 — 표현이 아예 다르면 매칭 실패할 수 있고,
 * 흔한 단어(GENERIC_KEYWORDS)가 겹쳐서 상관없는 상품이 잘못 묶일 가능성도 있음. 실제 결과
 * 보고 이상한 매칭/과도한 미매칭 있으면 계속 다듬어야 함.
 *
 * @param {object[]} ownPosts        자사 게시물 전체 (여러 계정 합친 것)
 * @param {object[]} competitorPosts 경쟁사 게시물 전체 (여러 계정 합친 것)
 * @param {string[]} fields          집계할 숫자 필드 (예: ['likes', 'retweets'])
 * @param {string} textField         본문 필드명 ('text' 또는 'caption')
 */
function buildProductComparison(ownPosts, competitorPosts, fields, textField) {
  const ownEntries = ownPosts.map(post => ({ side: 'own', post, title: extractOwnProductName(post[textField]) }));
  const competitorEntries = competitorPosts.map(post => ({ side: 'competitor', post, title: extractCompetitorProductName(post[textField]) }));
  const entries = [...ownEntries, ...competitorEntries].map(e => ({ ...e, keywords: extractKeywords(e.title) }));

  // Union-Find: 키워드가 하나라도 겹치는 게시물들을 같은 상품 그룹으로 묶음
  const parent = entries.map((_, i) => i);
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  function union(i, j) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].keywords.length === 0) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].keywords.length === 0) continue;
      if (entries[i].keywords.some(k => entries[j].keywords.includes(k))) union(i, j);
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

    const ownSummary = summarizeAccount({ platform: null, account: '자사', posts: ownInGroup.map(e => e.post), fields });
    const competitorSummary = summarizeAccount({ platform: null, account: '경쟁사', posts: competitorInGroup.map(e => e.post), fields });
    const metrics = { postCount: compareMetric(ownSummary.postCount, competitorSummary.postCount) };
    fields.forEach(f => {
      metrics[`total_${f}`] = compareMetric(ownSummary[`total_${f}`], competitorSummary[`total_${f}`]);
      metrics[`avg_${f}`] = compareMetric(ownSummary[`avg_${f}`], competitorSummary[`avg_${f}`]);
    });

    group.forEach(e => matchedPosts.add(e.post));
    products.push({ label: ownInGroup[0].title || competitorInGroup[0].title, own: ownSummary, competitor: competitorSummary, metrics });
  });
  // 게시물 수(자사+경쟁사 합) 많은 상품 먼저 — 임팩트 큰 것부터 보이게
  products.sort((a, b) => (b.own.postCount + b.competitor.postCount) - (a.own.postCount + a.competitor.postCount));

  const ownUnmatched = ownPosts.filter(p => !matchedPosts.has(p));
  const competitorUnmatched = competitorPosts.filter(p => !matchedPosts.has(p));

  return { products, ownUnmatched, competitorUnmatched };
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
    const productComparison = buildProductComparison(ownPosts, competitorPosts, fields, PLATFORM_TEXT_FIELD[platform]);

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
  buildProductComparison,
  buildComparisonReport,
  PLATFORM_FIELDS,
  PLATFORM_TEXT_FIELD,
};
