const fs = require('fs');
const path = require('path');

const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };
const PLATFORM_TITLES = { twitter: 'X(트위터)', instagram: '인스타그램' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function verdictBadge(verdict) {
  const cls = { 우세: 'ok', 경합: 'mid', 약세: 'low' }[verdict] || 'mid';
  return `<span class="badge ${cls}">${escapeHtml(verdict)}</span>`;
}

function formatRatioCard(pwTotal, bhTotal) {
  if (!bhTotal) return 'N/A';
  return `${Math.round((pwTotal / bhTotal) * 100)}%`;
}

function renderPlatformSection(platformKey, data) {
  const { products, ownUnmatched, competitorUnmatched, displayFields } = data.productComparison;
  const title = PLATFORM_TITLES[platformKey] || platformKey;

  const pwTotals = {};
  const bhTotals = {};
  displayFields.forEach(f => {
    pwTotals[f] = products.reduce((s, p) => s + p.own[`total_${f}`], 0);
    bhTotals[f] = products.reduce((s, p) => s + p.competitor[`total_${f}`], 0);
  });

  const cards = `
    <div class="cards">
      <div class="card"><div class="k">매칭된 상품</div><div class="v">${products.length}개</div><div class="s">매칭 안 됨 PW ${ownUnmatched.length} · BH ${competitorUnmatched.length}</div></div>
      ${displayFields.map(f => `
      <div class="card pw"><div class="k">PW 총 ${FIELD_LABELS[f] || f}</div><div class="v">${pwTotals[f].toLocaleString()}</div><div class="s">매칭 상품 기준</div></div>
      <div class="card bh"><div class="k">BH 총 ${FIELD_LABELS[f] || f}</div><div class="v">${bhTotals[f].toLocaleString()}</div><div class="s">PW 대비 ${formatRatioCard(pwTotals[f], bhTotals[f])}</div></div>
      `).join('')}
    </div>`;

  const headerCells = ['순위', 'IP', '시리즈',
    ...displayFields.flatMap(f => [`PW ${FIELD_LABELS[f] || f}`, `BH ${FIELD_LABELS[f] || f}`]),
    'PW 시각', 'BH 시각',
    ...displayFields.map(f => `${FIELD_LABELS[f] || f}차이`),
    '시각차이', '결과'];

  const rows = products.map((p, i) => {
    const rank = i + 1;
    const rankCell = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const cells = [
      `<td class="rank">${rankCell}</td>`,
      `<td class="name">${escapeHtml(p.ip || '(미분류)')}</td>`,
      `<td>${escapeHtml(p.line || '-')}</td>`,
      ...displayFields.flatMap(f => [
        `<td class="num pw">${p.own[`total_${f}`].toLocaleString()}</td>`,
        `<td class="num bh">${p.competitor[`total_${f}`].toLocaleString()}</td>`,
      ]),
      `<td class="time">${escapeHtml(p.pwTime)}</td>`,
      `<td class="time">${escapeHtml(p.bhTime)}</td>`,
      ...displayFields.map(f => `<td class="diff">${escapeHtml(p.diffText[f])}</td>`),
      `<td class="diff">${p.timeDiffMinutes}분</td>`,
      `<td>${verdictBadge(p.verdict)}</td>`,
    ].join('');
    return `<tr class="${rank <= 3 ? 'top3' : ''}">${cells}</tr>`;
  }).join('');

  const unmatchedList = (label, posts, textField) => {
    if (posts.length === 0) return `<p class="unmatched-empty">매칭 안 된 ${label} 게시물 없음</p>`;
    const items = posts.map(post => {
      const link = post.link || post.url || '';
      const preview = escapeHtml((post[textField] || '').replace(/\n/g, ' ').slice(0, 70));
      return `<li><a href="${escapeHtml(link)}" target="_blank" rel="noopener">${preview || '(본문 없음)'}</a></li>`;
    }).join('');
    return `<ul class="unmatched-list">${items}</ul>`;
  };
  const textField = platformKey === 'twitter' ? 'text' : 'caption';

  return `
  <section class="platform">
    <h2>[${title}] 상품별 비교</h2>
    ${cards}
    <div class="table-wrap">
      <table>
        <thead><tr>${headerCells.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${headerCells.length}" class="empty">매칭된 상품 없음</td></tr>`}</tbody>
      </table>
    </div>
    <details class="unmatched">
      <summary>매칭 안 된 게시물 (PW ${ownUnmatched.length} · BH ${competitorUnmatched.length})</summary>
      <div class="unmatched-cols">
        <div><h3>PW</h3>${unmatchedList('PW', ownUnmatched, textField)}</div>
        <div><h3>BH</h3>${unmatchedList('BH', competitorUnmatched, textField)}</div>
      </div>
    </details>
  </section>`;
}

/**
 * 취합 리포트를 사람이 읽기 좋은 HTML로 렌더링. 엑셀(히스토리 누적용)과는 별개로,
 * 매번 최신 결과를 보기 좋게 보는 용도 — 이 파일은 매번 덮어씀(히스토리 보존 안 함).
 *
 * @param {object} report aggregate.js의 buildComparisonReport() 결과
 * @returns {string} HTML 문서 전체
 */
function buildHtmlReport(report) {
  const sections = Object.entries(report.platforms).map(([key, data]) => renderPlatformSection(key, data)).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNS 성과 비교 리포트</title><style>
*{box-sizing:border-box}body{margin:0;font-family:'Malgun Gothic',system-ui,sans-serif;background:#f4f6fb;color:#1f2937}
.wrap{max-width:1200px;margin:0 auto;padding:28px 18px}
h1{font-size:24px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin-bottom:24px}
h2{font-size:18px;margin:0 0 12px}
section.platform{margin-bottom:36px}
.cards{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.card{background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08);flex:1;min-width:150px}
.card .k{color:#6b7280;font-size:12px}.card .v{font-size:20px;font-weight:700;color:#3b5bdb;margin-top:2px}
.card .s{color:#9099a6;font-size:11px;margin-top:2px}.card.pw .v{color:#e8590c}.card.bh .v{color:#c0504d}
.table-wrap{overflow-x:auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
table{width:100%;border-collapse:collapse;white-space:nowrap}
th{background:#3b5bdb;color:#fff;font-size:12px;padding:10px 8px;position:sticky;top:0}
td{padding:9px 8px;border-bottom:1px solid #eef0f4;font-size:13px;text-align:center;vertical-align:middle}
tr.top3{background:#fffbeb}tr:hover{background:#f0f4ff}
.rank{font-size:15px;font-weight:700;width:38px}
td.name{text-align:left;font-weight:600}
td.num.pw{color:#e8590c;font-weight:600}td.num.bh{color:#c0504d;font-weight:600}
td.diff{color:#374151;font-size:12px}td.time{color:#6b7280;font-size:12px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.badge.ok{background:#ebfbee;color:#2f9e44}.badge.mid{background:#fff4e6;color:#e8590c}.badge.low{background:#fff0f0;color:#c0504d}
td.empty{color:#9099a6;padding:24px}
details.unmatched{margin-top:10px;background:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
details.unmatched summary{cursor:pointer;color:#6b7280;font-size:13px}
.unmatched-cols{display:flex;gap:24px;margin-top:10px;flex-wrap:wrap}
.unmatched-cols>div{flex:1;min-width:260px}
.unmatched-cols h3{font-size:13px;color:#6b7280;margin:0 0 6px}
.unmatched-list{list-style:none;margin:0;padding:0;font-size:12px;max-height:220px;overflow-y:auto}
.unmatched-list li{padding:4px 0;border-bottom:1px solid #f4f6fb}
.unmatched-list a{color:#374151;text-decoration:none}.unmatched-list a:hover{text-decoration:underline}
.unmatched-empty{color:#9099a6;font-size:12px}
.foot{margin-top:16px;color:#6b7280;font-size:12px;line-height:1.6;background:#fff;border-radius:10px;padding:14px 16px}
</style></head><body><div class="wrap">
<h1>📊 SNS 성과 비교 리포트</h1>
<div class="sub">수집 기간: ${escapeHtml(report.startDate)} ~ ${escapeHtml(report.endDate)} · 생성: ${escapeHtml(report.generatedAt)} · <b>PW=자사, BH=경쟁사</b> · 랭킹: PW+BH 지표 합산순</div>
${sections}
<div class="foot">
※ 상품명은 게시물 본문에서 자동 추출(당사: 첫 줄 / 경쟁사: 링크 줄 위) 후, 키워드 2개 이상 겹치는 게시물끼리 그룹화한 결과입니다.<br>
※ 표현이 서로 다르거나 상품명을 못 뽑은 게시물은 "매칭 안 됨" 목록에 별도로 있습니다 — 조용히 빠진 게 아닙니다.<br>
※ 결과(우세/경합/약세)는 표에 표시된 지표(리트윗+좋아요 또는 좋아요+댓글)가 둘 다 PW가 크면 우세, 둘 다 작으면 약세, 엇갈리면 경합입니다.
</div>
</div></body></html>`;
}

/**
 * HTML 리포트를 파일로 저장. 히스토리 누적 안 함(매번 최신 결과로 덮어씀) — 과거 데이터
 * 보존은 엑셀(saveReportToExcel)이 담당.
 */
function saveHtmlReport(report, outputPath) {
  const html = buildHtmlReport(report);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return outputPath;
}

module.exports = { buildHtmlReport, saveHtmlReport };
