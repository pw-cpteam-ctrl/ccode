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

// 본문에서 해시태그만 뽑음 (한글 포함). "#은혼", "#메가하우스공식스토어" 등
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(matches.map(h => h.slice(1)))];
}

/**
 * 자사/경쟁사 게시물을 해시태그 기준으로 매칭해서 "상품별" 비교표를 만듦.
 * 브랜드/스토어명처럼 한쪽만 쓰는 태그는 자동으로 제외됨 — 자사와 경쟁사 둘 다 사용한
 * 해시태그(교집합)만 "같은 상품"으로 보고 매칭하기 때문에 수동 제외 목록이 필요 없음.
 * 해시태그가 없거나 양쪽이 다른 표현을 쓴 게시물은 매칭 안 됨(unmatched)으로 분리해서
 * 투명하게 보여줌 — 조용히 누락시키지 않음.
 *
 * @param {object[]} ownPosts        자사 게시물 전체 (여러 계정 합친 것)
 * @param {object[]} competitorPosts 경쟁사 게시물 전체 (여러 계정 합친 것)
 * @param {string[]} fields          집계할 숫자 필드 (예: ['likes', 'retweets'])
 * @param {string} textField         본문 필드명 ('text' 또는 'caption')
 */
function buildProductComparison(ownPosts, competitorPosts, fields, textField) {
  const withTags = posts => posts.map(p => ({ post: p, tags: extractHashtags(p[textField]) }));
  const ownTagged = withTags(ownPosts);
  const competitorTagged = withTags(competitorPosts);

  const ownTagSet = new Set(ownTagged.flatMap(t => t.tags));
  const competitorTagSet = new Set(competitorTagged.flatMap(t => t.tags));
  const sharedTags = [...ownTagSet].filter(t => competitorTagSet.has(t));

  const products = sharedTags.map(tag => {
    const ownMatched = ownTagged.filter(t => t.tags.includes(tag)).map(t => t.post);
    const competitorMatched = competitorTagged.filter(t => t.tags.includes(tag)).map(t => t.post);

    const ownSummary = summarizeAccount({ platform: null, account: '자사', posts: ownMatched, fields });
    const competitorSummary = summarizeAccount({ platform: null, account: '경쟁사', posts: competitorMatched, fields });

    const metrics = { postCount: compareMetric(ownSummary.postCount, competitorSummary.postCount) };
    fields.forEach(f => {
      metrics[`total_${f}`] = compareMetric(ownSummary[`total_${f}`], competitorSummary[`total_${f}`]);
      metrics[`avg_${f}`] = compareMetric(ownSummary[`avg_${f}`], competitorSummary[`avg_${f}`]);
    });

    return { tag, own: ownSummary, competitor: competitorSummary, metrics };
  });
  // 게시물 수(자사+경쟁사 합) 많은 상품 먼저 — 임팩트 큰 것부터 보이게
  products.sort((a, b) => (b.own.postCount + b.competitor.postCount) - (a.own.postCount + a.competitor.postCount));

  const isMatched = tags => tags.some(t => sharedTags.includes(t));
  const ownUnmatched = ownTagged.filter(t => !isMatched(t.tags)).map(t => t.post);
  const competitorUnmatched = competitorTagged.filter(t => !isMatched(t.tags)).map(t => t.post);

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
  extractHashtags,
  buildProductComparison,
  buildComparisonReport,
  PLATFORM_FIELDS,
  PLATFORM_TEXT_FIELD,
};
