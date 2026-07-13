/**
 * collect-account.js가 쓰는 단독 계정 성과 HTML 빌더. PW/BH 비교 리포트(html-report.js)와는
 * 다른 목적 — 비교 대상 없이 계정 하나의 게시물 순위/합계만 보여주는 훨씬 단순한 리포트.
 */
const { parseCount, formatKstTime } = require('./aggregate');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildAccountReportHtml({ handle, startDate, endDate, summary, rankedPosts }) {
  const rows = rankedPosts.map((p, i) => {
    const likes = parseCount(p.likes);
    const retweets = parseCount(p.retweets);
    const excerpt = escapeHtml((p.text || '').replace(/\n/g, ' ').slice(0, 80));
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(formatKstTime(p.datetime))}</td>
      <td><a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${escapeHtml(p.link)}</a></td>
      <td>${likes ?? '-'}</td>
      <td>${retweets ?? '-'}</td>
      <td title="${escapeHtml(p.text || '')}">${excerpt}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>@${escapeHtml(handle)} 트위터 성과</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin: 24px; color: #1b1f24; }
  h1 { font-size: 20px; }
  .cards { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
  .card { background: #f8f9fb; border: 1px solid #e9ecef; border-radius: 8px; padding: 12px 16px; min-width: 110px; }
  .card .label { font-size: 12px; color: #6b7280; }
  .card .value { font-size: 20px; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid #e9ecef; padding: 6px 8px; text-align: left; }
  th { background: #f8f9fb; }
  td:nth-child(4), td:nth-child(5) { text-align: right; }
  a { color: #1971c2; }
</style>
</head><body>
  <h1>@${escapeHtml(handle)} 트위터 성과 (${escapeHtml(startDate)} ~ ${escapeHtml(endDate)})</h1>
  <p style="color:#6b7280;font-size:13px">비교 대상 없이 이 계정 단독 성과만 보여주는 리포트입니다. 게시물은 (좋아요+리트윗) 합산 기준 내림차순 정렬.</p>
  <div class="cards">
    <div class="card"><div class="label">게시물 수</div><div class="value">${summary.postCount}</div></div>
    <div class="card"><div class="label">총 좋아요</div><div class="value">${summary.total_likes}</div></div>
    <div class="card"><div class="label">평균 좋아요</div><div class="value">${summary.avg_likes ?? '-'}</div></div>
    <div class="card"><div class="label">총 리트윗</div><div class="value">${summary.total_retweets}</div></div>
    <div class="card"><div class="label">평균 리트윗</div><div class="value">${summary.avg_retweets ?? '-'}</div></div>
  </div>
  <table>
    <thead><tr><th>순위</th><th>게시 시각</th><th>링크</th><th>좋아요</th><th>리트윗</th><th>본문 일부</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">게시물 없음</td></tr>'}</tbody>
  </table>
</body></html>`;
}

module.exports = { buildAccountReportHtml };
