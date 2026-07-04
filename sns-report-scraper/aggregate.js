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

    platforms[platform] = {
      fields,
      own: ownAccounts,
      ownTotals,
      competitors: competitorAccounts,
      competitorAverage,
      perCompetitorComparison,
      vsAverage,
    };
  });

  return { startDate, endDate, generatedAt: new Date().toISOString(), platforms };
}

module.exports = { parseCount, summarizeAccount, compareMetric, buildComparisonReport, PLATFORM_FIELDS };
