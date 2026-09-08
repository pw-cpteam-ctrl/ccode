/**
 * ⚔️ 게시글 맞대결 리포트 — 사람이 고른 당사/경쟁사 게시물 하나씩을 나란히 놓고
 * 좋아요·리트윗·댓글을 비교하는 단발성 리포트.
 *
 * 기간 리포트(html-report.js)와 목적이 다름:
 *  - 기간 리포트는 "그 기간에 올라온 글 전부"를 상품명으로 자동 매칭해서 짝을 지음.
 *    양쪽 게시일이 며칠씩 벌어지면 애초에 짝이 안 지어져서 둘 다 "매칭 안 됨"으로 빠짐.
 *  - 맞대결은 사람이 "이 글과 이 글"이라고 지목하므로 매칭도, 날짜 범위도 필요 없음.
 *
 * ⚠️ 대신 이 리포트에는 기간 리포트에 없는 함정이 하나 있음: 게시일이 다르면 먼저 올린 쪽이
 * 그만큼 더 오래 노출돼서 누적 반응이 유리해짐. 숫자만 나란히 놓으면 "경쟁사가 더 잘했다"로
 * 잘못 읽히므로, 경과일을 항상 같이 표시하고 차이가 크면 상단에 경고를 띄움.
 */
const fs = require('fs');
const { parseCount } = require('./aggregate');

const PLATFORM_LABEL = { twitter: 'X(트위터)', instagram: '인스타그램' };
// 게시일 차이가 이 정도를 넘으면 "그냥 비교하면 안 된다"고 상단에 경고를 띄움.
// 하루 이틀은 SNS 반응 특성상 큰 영향이 없어서 매번 경고하면 오히려 무뎌짐.
const GAP_WARN_DAYS = 2;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function kstText(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

/** 게시 후 지금(수집 시각)까지 며칠 지났는지. 비교의 공정성을 판단하는 유일한 근거라 소수점까지 씀 */
function elapsedDays(iso, collectedAt) {
  if (!iso) return null;
  const posted = new Date(iso).getTime();
  const now = new Date(collectedAt).getTime();
  if (Number.isNaN(posted) || Number.isNaN(now)) return null;
  return Math.max((now - posted) / 86400000, 0);
}

function elapsedText(days) {
  if (days === null) return '';
  if (days < 1) return `${Math.round(days * 24)}시간 전`;
  return `${days.toFixed(1)}일 전`;
}

/**
 * 한 지표를 PW:BH 분할 바 하나로. 한쪽이라도 숫자를 못 읽었으면 막대를 그리지 않고
 * 왜 없는지 알 수 있게 '-'로 둠 — 0으로 채워서 그리면 "반응이 0이었다"로 오해됨.
 */
function metricRow(label, icon, pwRaw, bhRaw, extra) {
  const pw = pwRaw === null || pwRaw === undefined || pwRaw === '' ? null : parseCount(pwRaw);
  const bh = bhRaw === null || bhRaw === undefined || bhRaw === '' ? null : parseCount(bhRaw);
  if (pw === null && bh === null) {
    return `<tr><th>${icon} ${escapeHtml(label)}</th><td colspan="2" class="na">읽을 수 없었음</td></tr>`;
  }
  const fmt = v => (v === null ? '-' : v.toLocaleString());

  // ⚠️ 한쪽만 읽혔을 때 막대를 그리면 그쪽이 100%를 채워서 "압승"처럼 보임 — 실제로는
  // 상대 숫자를 모르는 것뿐이라 정반대의 오해가 됨. 그래서 이 경우 막대를 아예 안 그림.
  if (pw === null || bh === null) {
    return `<tr>
      <th>${icon} ${escapeHtml(label)}</th>
      <td class="barcell" colspan="2">
        <div class="bar nobar">
          <span class="v pw">${fmt(pw)}</span>
          <div class="track empty"></div>
          <span class="v bh">${fmt(bh)}</span>
        </div>
        <div class="sub-extra">한쪽 숫자를 못 읽어서 비교는 못 합니다</div>
      </td>
    </tr>`;
  }

  const total = pw + bh;
  const pwPct = total > 0 ? Math.round((pw / total) * 100) : 50;
  return `<tr>
    <th>${icon} ${escapeHtml(label)}</th>
    <td class="barcell" colspan="2">
      <div class="bar">
        <span class="v pw">${fmt(pw)}</span>
        <div class="track"><div class="pw" style="width:${pwPct}%"></div><div class="bh" style="width:${100 - pwPct}%"></div></div>
        <span class="v bh">${fmt(bh)}</span>
      </div>
      ${extra ? `<div class="sub-extra">${escapeHtml(extra)}</div>` : ''}
    </td>
  </tr>`;
}

function embedBlock(post) {
  if (!post || !post.url) return '<p class="na">링크 없음</p>';
  const url = escapeHtml(post.url);
  if (post.platform === 'instagram') {
    return `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14"><a href="${url}">${url}</a></blockquote>`;
  }
  return `<blockquote class="twitter-tweet" data-dnt="true"><a href="${url}">${url}</a></blockquote>`;
}

function sideHead(sideLabel, cls, post, collectedAt) {
  if (!post) return `<div class="side ${cls}"><h4>${sideLabel}</h4><p class="na">링크 없음</p></div>`;
  const days = elapsedDays(post.datetime, collectedAt);
  const err = post.ok ? '' : `<p class="err">⚠️ ${escapeHtml(post.error || '읽지 못했습니다')}</p>`;
  const warn = post.warning ? `<p class="err">⚠️ ${escapeHtml(post.warning)}</p>` : '';
  return `<div class="side ${cls}">
    <h4>${sideLabel} <span class="plat">${escapeHtml(PLATFORM_LABEL[post.platform] || '')}</span></h4>
    <p class="when">${escapeHtml(kstText(post.datetime))}${days !== null ? ` <b>(${escapeHtml(elapsedText(days))})</b>` : ''}</p>
    <p class="who">${post.account ? '@' + escapeHtml(post.account) : ''}</p>
    ${err}${warn}
    <p class="link"><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener">원본 열기 ↗</a></p>
  </div>`;
}

function renderPair(pair, index, collectedAt) {
  const { pw, bh, label } = pair;
  const pwDays = pw ? elapsedDays(pw.datetime, collectedAt) : null;
  const bhDays = bh ? elapsedDays(bh.datetime, collectedAt) : null;
  const gap = pwDays !== null && bhDays !== null ? Math.abs(pwDays - bhDays) : null;

  // 하루 평균은 "노출 기간이 다르다"는 걸 보정해보려는 참고치일 뿐 정답이 아님 —
  // SNS 반응은 올린 직후 1~2일에 대부분 몰려서, 오래 걸어둔 글일수록 하루 평균이 낮게 나옴.
  // 그래서 원본 숫자를 주인공으로 두고 평균은 작은 글씨 참고로만 붙임.
  const perDay = (raw, days) => {
    if (raw === null || raw === undefined || raw === '' || days === null || days < 0.5) return null;
    const n = parseCount(raw);
    return n === null ? null : (n / days);
  };
  const avgText = (pwRaw, bhRaw) => {
    const a = perDay(pwRaw, pwDays);
    const b = perDay(bhRaw, bhDays);
    if (a === null && b === null) return '';
    const f = v => (v === null ? '-' : v.toFixed(1));
    return `하루 평균 — 당사 ${f(a)} · 경쟁사 ${f(b)}`;
  };

  const gapNote = gap !== null && gap >= GAP_WARN_DAYS
    ? `<div class="gapnote">⚠️ 두 글의 게시일이 <b>${gap.toFixed(1)}일</b> 차이납니다 — 먼저 올라온 쪽이 그만큼 더 오래 노출됐습니다. 아래 숫자는 <b>지금까지 쌓인 누적</b>이라 그대로 승패로 읽으면 안 됩니다.</div>`
    : '';

  return `
  <section class="pair">
    <h2>${index + 1}. ${escapeHtml(label || '맞대결')}</h2>
    ${gapNote}
    <div class="sides">
      ${sideHead('당사 (PW)', 'pw', pw, collectedAt)}
      ${sideHead('경쟁사 (BH)', 'bh', bh, collectedAt)}
    </div>
    <table class="metrics">
      ${metricRow('좋아요', '❤️', pw && pw.likes, bh && bh.likes, avgText(pw && pw.likes, bh && bh.likes))}
      ${metricRow('리트윗', '🔁', pw && pw.retweets, bh && bh.retweets, avgText(pw && pw.retweets, bh && bh.retweets))}
      ${metricRow('댓글', '💬', pw && pw.comments, bh && bh.comments, avgText(pw && pw.comments, bh && bh.comments))}
    </table>
    <div class="embeds">
      <div class="embed-col"><h4 class="pw">당사 (PW)</h4>${embedBlock(pw)}</div>
      <div class="embed-col"><h4 class="bh">경쟁사 (BH)</h4>${embedBlock(bh)}</div>
    </div>
  </section>`;
}

/**
 * @param {object} opts
 * @param {string} opts.title 이 맞대결의 이름 (예: '토모에 넨도로이드 이벤트')
 * @param {string} [opts.brandLabel] 브랜드 이름 (메가하우스/굿스마일)
 * @param {string} opts.collectedAt 수집 시각 ISO — 경과일 계산 기준
 * @param {Array<{label?:string, pw:object|null, bh:object|null}>} opts.pairs
 */
function buildMatchupReportHtml({ title, brandLabel = '', collectedAt, pairs }) {
  const heading = `⚔️ ${brandLabel ? brandLabel + ' ' : ''}게시글 맞대결`;
  const needTwitter = pairs.some(p => [p.pw, p.bh].some(x => x && x.platform === 'twitter'));
  const needInstagram = pairs.some(p => [p.pw, p.bh].some(x => x && x.platform === 'instagram'));

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)} — ${escapeHtml(title || '')}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:'Malgun Gothic',system-ui,sans-serif;background:#f4f6fb;color:#1f2937}
.wrap{max-width:1100px;margin:0 auto;padding:28px 18px}
h1{font-size:22px;margin:0 0 6px}
.sub{color:#6b7280;font-size:13px;margin-bottom:18px}
.pair{background:#fff;border-radius:12px;padding:18px 20px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pair h2{font-size:17px;margin:0 0 12px}
.gapnote{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;line-height:1.6;border-radius:8px;padding:10px 12px;margin-bottom:14px}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.side{border:1px solid #e3e8f0;border-radius:10px;padding:10px 12px}
.side h4{margin:0 0 6px;font-size:13px}
.side.pw h4{color:#2563eb}.side.bh h4{color:#dc2626}
.side .plat{color:#9099a6;font-weight:400;font-size:11px}
.side p{margin:2px 0;font-size:12px;color:#4b5563}
.side .who{color:#9099a6}
.side .err{color:#b91c1c}
.na{color:#9099a6;font-size:12px}
table.metrics{width:100%;border-collapse:collapse;margin-bottom:14px}
table.metrics th{text-align:left;font-size:12px;color:#6b7280;font-weight:600;width:90px;padding:8px 6px;vertical-align:middle}
table.metrics td{padding:8px 6px;border-top:1px solid #eef1f6}
.bar{display:flex;align-items:center;gap:8px}
.bar .v{font-size:13px;font-weight:700;min-width:56px}
.bar .v.pw{color:#2563eb;text-align:right}
.bar .v.bh{color:#dc2626}
.bar .track{flex:1;display:flex;height:12px;border-radius:6px;overflow:hidden;background:#eef1f6}
.bar .track .pw{background:#3b82f6}
.bar .track .bh{background:#ef4444}
.bar .track.empty{background:repeating-linear-gradient(45deg,#eef1f6,#eef1f6 4px,#e3e8f0 4px,#e3e8f0 8px)}
.sub-extra{font-size:11px;color:#9099a6;margin-top:4px;text-align:center}
.embeds{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.embed-col h4{margin:0 0 8px;font-size:12px}
.embed-col h4.pw{color:#2563eb}.embed-col h4.bh{color:#dc2626}
.foot{color:#6b7280;font-size:12px;line-height:1.7;background:#fff;border-radius:10px;padding:14px 16px}
@media (max-width:860px){.sides,.embeds{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>${escapeHtml(heading)}</h1>
<div class="sub">${escapeHtml(title || '')} · 수집: ${escapeHtml(kstText(collectedAt))} (KST) · <b>PW=자사, BH=경쟁사</b></div>
${pairs.map((p, i) => renderPair(p, i, collectedAt)).join('\n')}
<div class="foot">
※ 이 리포트는 <b>사람이 지목한 게시물</b>만 비교합니다 — 기간이나 상품명 매칭과 무관합니다.<br>
※ 숫자는 <b>수집 시각까지 쌓인 누적</b>입니다. 게시일이 다르면 먼저 올린 쪽이 더 오래 노출됐다는 뜻이라, 경과일을 같이 보고 판단해주세요.<br>
※ 하루 평균은 참고용입니다 — SNS 반응은 올린 직후 1~2일에 몰리는 편이라, 오래 걸어둔 글일수록 평균이 낮게 나옵니다.<br>
※ 인스타그램은 <b>좋아요 수를 숨긴 게시물</b>이면 좋아요를 읽을 수 없습니다(댓글 수만 나옴). 리트윗은 X에만 있는 지표라 인스타는 항상 '-'입니다.<br>
※ 게시물 미리보기는 인터넷이 연결된 브라우저에서 열어야 카드로 보입니다.
</div>
</div>
${needTwitter ? '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>' : ''}
${needInstagram ? '<script async src="https://www.instagram.com/embed.js"></script>' : ''}
</body></html>`;
}

function saveMatchupReport(opts, outputPath) {
  fs.writeFileSync(outputPath, buildMatchupReportHtml(opts));
  return outputPath;
}

module.exports = { buildMatchupReportHtml, saveMatchupReport, elapsedDays, GAP_WARN_DAYS };
