/**
 * compare-periods.js가 쓰는 "기간별 총합 비교" 데이터/HTML 빌더. 여러 기간(연속 아니어도,
 * 공백 있어도 됨)을 재수집 없이 나란히 놓고 자사/경쟁사 전체 합계를 비교하는 용도 — 상품별로
 * 기간마다 어떻게 변했는지 보는 건 별도 논의 후 다음 단계에서 진행(오묶음 리스크 있어서 보류).
 */
const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };
const PLATFORM_TITLES = { twitter: 'X(트위터)', instagram: '인스타그램' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function metricLabel(key) {
  if (key === 'postCount') return '게시물 수';
  const [type, field] = key.split('_');
  return `${type === 'total' ? '총' : '평균'} ${FIELD_LABELS[field] || field}`;
}

// 경쟁사 계정이 여러 개(트위터/인스타 각각 하나씩이라 지금은 보통 1개)여도 기간 비교
// 목적에서는 "경쟁사 전체 합계" 하나로 봄 — 계정별 세부 비교는 원래 리포트(html-report.js)가 담당.
function competitorSum(platformData) {
  const sum = { postCount: 0 };
  platformData.fields.forEach(f => { sum[`total_${f}`] = 0; });
  platformData.competitors.forEach(c => {
    sum.postCount += c.postCount;
    platformData.fields.forEach(f => { sum[`total_${f}`] += (c[`total_${f}`] || 0); });
  });
  platformData.fields.forEach(f => {
    sum[`avg_${f}`] = sum.postCount > 0 ? Math.round((sum[`total_${f}`] / sum.postCount) * 10) / 10 : null;
  });
  return sum;
}

// periods: [{ label, report }] — report는 aggregate.js의 buildComparisonReport() 결과.
// 기간마다 수집된 플랫폼이 다를 수 있어서(예: 한쪽만 트위터만 수집) 전체 기간에 등장한
// 플랫폼 전부를 훑고, 특정 기간에 데이터가 없으면 그 칸만 '-'로 비워둠.
function buildPeriodSummary(periods) {
  const platformKeys = [...new Set(periods.flatMap(p => Object.keys(p.report.platforms)))];
  return platformKeys.map(platform => {
    const withData = periods.find(p => p.report.platforms[platform]);
    const fields = withData ? withData.report.platforms[platform].fields : [];
    const metricKeys = ['postCount', ...fields.flatMap(f => [`total_${f}`, `avg_${f}`])];

    const perPeriod = periods.map(p => {
      const data = p.report.platforms[platform];
      return data ? { own: data.ownTotals, competitor: competitorSum(data) } : null;
    });

    const rows = metricKeys.map(key => ({
      key,
      label: metricLabel(key),
      cells: perPeriod.map(pp => (pp ? { own: pp.own[key], competitor: pp.competitor[key] } : { own: null, competitor: null })),
    }));
    return { platform, rows };
  });
}

function buildPeriodComparisonHtml(periods) {
  const summary = buildPeriodSummary(periods);

  const sections = summary.map(({ platform, rows }) => {
    const title = PLATFORM_TITLES[platform] || platform;
    const periodHeader = `<tr><th>지표</th>${periods.map(p => `<th colspan="2">${escapeHtml(p.label)}</th>`).join('')}</tr>`;
    const subHeader = `<tr><th></th>${periods.map(() => '<th>자사</th><th>경쟁사</th>').join('')}</tr>`;
    const body = rows.map(r => `<tr>
      <td>${escapeHtml(r.label)}</td>
      ${r.cells.map(c => `<td>${c.own ?? '-'}</td><td>${c.competitor ?? '-'}</td>`).join('')}
    </tr>`).join('\n');
    return `<h2>[${title}] 기간별 비교</h2>
    <table>
      <thead>${periodHeader}${subHeader}</thead>
      <tbody>${body}</tbody>
    </table>`;
  }).join('\n');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>기간별 SNS 실적 비교</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin: 24px; color: #1b1f24; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin-bottom: 8px; }
  th, td { border-bottom: 1px solid #e9ecef; padding: 6px 10px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th { background: #f8f9fb; }
</style>
</head><body>
  <h1>기간별 SNS 실적 비교</h1>
  <p style="color:#6b7280;font-size:13px">${periods.map(p => escapeHtml(p.label)).join(' / ')} — 기간 사이에 공백(게시글 없는 날)이 있어도 상관없이, 각 기간을 따로 수집한 결과를 나란히 놓고 비교한 표입니다. 상품별 세부 비교는 아직 없고 전체 합계 기준입니다.</p>
  ${sections}
</body></html>`;
}

module.exports = { buildPeriodSummary, buildPeriodComparisonHtml };
