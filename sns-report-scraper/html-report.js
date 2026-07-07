const fs = require('fs');
const path = require('path');

const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };
const FIELD_ICONS = { likes: '♥️', retweets: '♻️', comments: '💬' };
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

// 헤더 카드의 숫자(1,354/165)를 대체하는 게 아니라 그 옆에 병렬로 두는 원형(파이) 시각화 —
// PW/BH 두 조각짜리 원이라 CSS conic-gradient로 충분(SVG 불필요). 색상은 표와 동일한
// PW 파랑/BH 빨강 그대로 써서 식별 기준을 하나로 유지.
function pieCard(field, pwTotal, bhTotal) {
  const total = pwTotal + bhTotal;
  const pwPct = total > 0 ? (pwTotal / total) * 100 : 50;
  const pwShare = total > 0 ? Math.round((pwTotal / total) * 100) : 0;
  const bhShare = 100 - pwShare;
  return `
      <div class="card piecard">
        <div class="k">PW vs BH ${FIELD_LABELS[field] || field} 비율</div>
        <div class="pie-row">
          <div class="piechart" style="background:conic-gradient(#1971c2 0% ${pwPct}%, #c0504d ${pwPct}% 100%)"></div>
          <div class="pie-legend">
            <span class="pw">PW ${pwShare}%</span>
            <span class="bh">BH ${bhShare}%</span>
          </div>
        </div>
      </div>`;
}

function fieldIcon(f) {
  return FIELD_ICONS[f] || FIELD_LABELS[f] || f;
}

// PW vs BH 비교는 "부분 대 전체" 문제라 프로그레스 바(단일값 대 한계치)가 아니라
// 막대 하나를 두 값의 비율로 나눠 채우는 분할 바가 맞음 — 2px 표면 간극으로 두 구간을 분리.
// 값 라벨은 막대 안이 아니라 막대 양 끝 바깥에 둠 — 비율이 크게 벌어지면(예: 355:1) 작은 쪽
// 구간이 라벨을 담을 폭이 안 나오므로, "잘리는 라벨"보다 "끝에 고정된 라벨"이 항상 안전함.
function metricBar(pw, bh, diffText) {
  const total = pw + bh;
  const title = `PW ${pw.toLocaleString()} · BH ${bh.toLocaleString()}`;
  const pwPct = total > 0 ? (pw / total) * 100 : 0;
  const track = total > 0
    ? `<div class="metricbar-pw" style="width:${pwPct}%"></div><div class="metricbar-bh" style="width:${100 - pwPct}%"></div>`
    : '';
  return `<div class="metriccell" title="${escapeHtml(title)}">
    <div class="metricbar">
      <span class="metricbar-val pw">${pw.toLocaleString()}</span>
      <div class="metricbar-track">${track}</div>
      <span class="metricbar-val bh">${bh.toLocaleString()}</span>
    </div>
    <div class="metric-diff">${escapeHtml(diffText)}</div>
  </div>`;
}

// 시각은 "PW 대비 BH가 얼마나 앞/뒤로 떨어져 있나"(기준선 대비 편차)라 부분-전체(분할 바) 문제가
// 아니라 diverging 문제임 — PW 시각을 컬럼 중앙 기준선(0)으로 놓고, BH가 그보다 늦으면 오른쪽,
// 빠르면 왼쪽으로 뻗는 막대(도트+선)로 표시. 실제 데이터는 대다수가 10분 이내 차이라 스케일을
// 10분으로 고정해서 그 안에서의 편차를 크게 벌려 보여주고, 228분/1855분 같은 말 안 되는
// 이상치는 막대를 끝까지 채운 뒤 점 반경을 눈에 띄게 키워서 "스케일 밖"임을 표시. 밑에는 원본
// 시:분을 양옆에 그대로 두고, 그 사이 중앙에 PW 기준 부호 있는 분 차이를 색으로 표기
// (+분=PW가 먼저=파란색, -분=BH가 먼저=빨간색) — 원본 값과 계산된 차이를 둘 다 보여줌.
const TIME_SCALE_CAP_MINUTES = 10;
function timeOnly(kstTimeText) {
  return kstTimeText.split(' ').pop(); // "7/1 12:20" -> "12:20"
}
function timeCell(pwTime, bhTime, diffSignedMinutes) {
  const abs = Math.abs(diffSignedMinutes);
  const pct = Math.min(abs / TIME_SCALE_CAP_MINUTES, 1) * 46;
  const clipped = abs > TIME_SCALE_CAP_MINUTES;
  const later = diffSignedMinutes > 0; // BH가 PW보다 늦게 올림 = PW 기준 +
  const dotLeftPct = later ? 50 + pct : 50 - pct;
  const lineStyle = later ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%`;
  const numClass = diffSignedMinutes > 0 ? 'pw' : diffSignedMinutes < 0 ? 'bh' : '';
  const numText = abs === 0 ? '0분' : `${diffSignedMinutes > 0 ? '+' : '−'}${abs}분`;
  return `<div class="metriccell" title="PW ${escapeHtml(pwTime)} · BH ${escapeHtml(bhTime)}">
    <div class="divbar">
      <div class="divbar-track"></div>
      <div class="divbar-baseline"></div>
      ${abs > 0 ? `<div class="divbar-line" style="${lineStyle}"></div>` : ''}
      <div class="divbar-dot${clipped ? ' clipped' : ''}" style="left:${dotLeftPct}%"></div>
    </div>
    <div class="time-row">
      <span class="time-raw">${escapeHtml(timeOnly(pwTime))}</span>
      <span class="time-diff-num ${numClass}">${numText}</span>
      <span class="time-raw">${escapeHtml(timeOnly(bhTime))}</span>
    </div>
  </div>`;
}

// 트위터/인스타 공식 oEmbed 마크업. 실제 카드로 렌더링되려면 각 서비스의 위젯 스크립트가
// 네트워크로 로드돼야 함(사용자가 인터넷 되는 본인 브라우저로 열 때 정상 동작) — 네트워크가
// 없으면 이 blockquote가 그냥 "게시물로 이동" 링크로 보임(oEmbed 기본 동작, 이 정도도 하이퍼링크
// 역할은 함).
function embedBlockquote(platformKey, post) {
  if (platformKey === 'twitter') {
    const link = escapeHtml(post.link || '');
    return `<blockquote class="twitter-tweet" data-dnt="true"><a href="${link}">${link}</a></blockquote>`;
  }
  if (platformKey === 'instagram') {
    const url = escapeHtml(post.url || '');
    return `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14"><a href="${url}">${url}</a></blockquote>`;
  }
  return '';
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

  // 지표별 PW카드/BH카드/파이 3개를 한 그룹으로 묶어서 폭이 좁아 줄바꿈되더라도 그룹 전체가
  // 통째로 다음 줄로 넘어가게 함 — 그룹 내부가 갈라지면 짝이 안 맞는 카드만 남아 유독
  // 커 보이거나(flex 늘어남) 관계가 끊겨 보이는 문제가 있었음.
  const cards = `
    <div class="cards">
      <div class="card"><div class="k">매칭된 상품</div><div class="v">${products.length}개</div><div class="s">매칭 안 됨 PW ${ownUnmatched.length} · BH ${competitorUnmatched.length}</div></div>
      ${displayFields.map(f => `
      <div class="card-group">
        <div class="card pw"><div class="k">PW 총 ${FIELD_LABELS[f] || f}</div><div class="v">${pwTotals[f].toLocaleString()}</div><div class="s">매칭 상품 기준</div></div>
        <div class="card bh"><div class="k">BH 총 ${FIELD_LABELS[f] || f}</div><div class="v">${bhTotals[f].toLocaleString()}</div><div class="s">PW 대비 ${formatRatioCard(pwTotals[f], bhTotals[f])}</div></div>
        ${pieCard(f, pwTotals[f], bhTotals[f])}
      </div>
      `).join('')}
    </div>`;

  const headerCells = ['순위', 'IP', '시리즈',
    ...displayFields.map(f => fieldIcon(f)),
    '⏰', '결과', '게시물'];

  const rows = products.map((p, i) => {
    const rank = i + 1;
    const rankCell = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const embedRowId = `embed-${platformKey}-${i}`;
    const verdictRowClass = { 경합: 'verdict-mid', 약세: 'verdict-low' }[p.verdict] || '';
    const cells = [
      `<td class="rank">${rankCell}</td>`,
      `<td class="name">${escapeHtml(p.ip || '(미분류)')}</td>`,
      `<td>${escapeHtml(p.line || '-')}</td>`,
      ...displayFields.map(f => `<td class="metric">${metricBar(p.own[`total_${f}`], p.competitor[`total_${f}`], p.diffText[f])}</td>`),
      `<td class="metric">${timeCell(p.pwTime, p.bhTime, p.timeDiffSignedMinutes)}</td>`,
      `<td>${verdictBadge(p.verdict)}</td>`,
      `<td><button class="toggle-btn" onclick="toggleEmbeds('${embedRowId}','${platformKey}',this)">▶ 보기</button></td>`,
    ].join('');

    const embedCol = (label, cls, posts) => `
      <div class="embed-col">
        <h4 class="${cls}">${label} (${posts.length})</h4>
        ${posts.length === 0 ? '<p class="embed-empty">게시물 없음</p>' : posts.map(post => embedBlockquote(platformKey, post)).join('')}
      </div>`;
    const embedRow = `<tr class="embed-row" id="${embedRowId}"><td colspan="${headerCells.length}">
      <div class="embed-cols">
        ${embedCol('PW', 'pw', p.ownPosts)}
        ${embedCol('BH', 'bh', p.competitorPosts)}
      </div>
    </td></tr>`;

    return `<tr class="${verdictRowClass}">${cells}</tr>${embedRow}`;
  }).join('');

  // 번호(PW #1, BH #1...)를 붙여둠 — 수동 매칭 지시할 때 "PW 3번 BH 1번 매칭해줘"처럼
  // 번호로 바로 가리킬 수 있게.
  const unmatchedList = (label, posts, textField) => {
    if (posts.length === 0) return `<p class="unmatched-empty">매칭 안 된 ${label} 게시물 없음</p>`;
    const items = posts.map((post, i) => {
      const link = post.link || post.url || '';
      const preview = escapeHtml((post[textField] || '').replace(/\n/g, ' ').slice(0, 70));
      return `<li><b>${label} #${i + 1}</b> <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${preview || '(본문 없음)'}</a></li>`;
    }).join('');
    return `<ul class="unmatched-list">${items}</ul>`;
  };
  const textField = platformKey === 'twitter' ? 'text' : 'caption';

  return `
  <section class="platform">
    <div class="section-head">
      <h2>[${title}] 상품별 비교</h2>
      <div class="toggle-all">
        <button class="toggle-all-btn" onclick="toggleAllEmbeds('${platformKey}',true)">전체 펼치기</button>
        <button class="toggle-all-btn" onclick="toggleAllEmbeds('${platformKey}',false)">전체 접기</button>
      </div>
    </div>
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
 * 각 상품 행의 "보기" 버튼을 누르면 PW/BH 게시물을 2열로 임베드해서 보여줌(다시 누르면 접힘).
 * 실제 트위터/인스타 카드로 렌더링되려면 브라우저가 인터넷에 연결돼서 각 서비스의 위젯
 * 스크립트를 불러와야 함 — 오프라인이면 게시물 링크로만 보임(그래도 클릭하면 이동 가능).
 *
 * @param {object} report aggregate.js의 buildComparisonReport() 결과
 * @returns {string} HTML 문서 전체
 */
function buildHtmlReport(report) {
  const platformKeys = Object.keys(report.platforms);
  const sections = platformKeys.map(key => renderPlatformSection(key, report.platforms[key])).join('\n');
  const needsTwitterWidget = platformKeys.includes('twitter');
  const needsInstagramWidget = platformKeys.includes('instagram');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNS 성과 비교 리포트</title><style>
*{box-sizing:border-box}body{margin:0;font-family:'Malgun Gothic',system-ui,sans-serif;background:#f4f6fb;color:#1f2937}
.wrap{max-width:1200px;margin:0 auto;padding:28px 18px}
h1{font-size:24px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin-bottom:24px}
h2{font-size:18px;margin:0}
section.platform{margin-bottom:36px}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.toggle-all{display:flex;gap:8px}
.toggle-all-btn{border:1px solid #d0d5e0;background:#fff;color:#3b5bdb;font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer}
.toggle-all-btn:hover{background:#eef2ff}
.cards{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.card-group{display:flex;gap:12px;flex:none}
.card{background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08);flex:0 1 190px;min-width:150px}
.card .k{color:#6b7280;font-size:12px}.card .v{font-size:20px;font-weight:700;color:#3b5bdb;margin-top:2px}
.card .s{color:#9099a6;font-size:11px;margin-top:2px}.card.pw .v{color:#1971c2}.card.bh .v{color:#c0504d}
.card.piecard{flex:0 0 auto;min-width:auto}
.pie-row{display:flex;align-items:center;gap:10px;margin-top:4px}
.piechart{width:44px;height:44px;border-radius:50%;flex:none;box-shadow:0 0 0 1px #eef0f4 inset}
.pie-legend{display:flex;flex-direction:column;gap:2px;font-size:12px;font-weight:700}
.pie-legend .pw{color:#1971c2}.pie-legend .bh{color:#c0504d}
.table-wrap{overflow-x:auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
table{width:100%;border-collapse:collapse;white-space:nowrap}
th{background:#3b5bdb;color:#fff;font-size:12px;padding:10px 8px;position:sticky;top:0}
td{padding:9px 8px;border-bottom:1px solid #eef0f4;font-size:13px;text-align:center;vertical-align:middle}
tr.verdict-mid{background:#fff9db}tr.verdict-low{background:#fff0f0}tr:hover{background:#f0f4ff}
.rank{font-size:15px;font-weight:700;width:38px}
td.name{text-align:left;font-weight:600}
td.metric{min-width:170px}
.metriccell{display:flex;flex-direction:column;align-items:center;gap:3px}
.metricbar{display:flex;align-items:center;gap:6px;width:100%}
.metricbar-val{font-size:12px;font-weight:700;white-space:nowrap}
.metricbar-val.pw{color:#1971c2}.metricbar-val.bh{color:#c0504d}
.metricbar-track{flex:1;display:flex;height:10px;border-radius:5px;overflow:hidden;background:#eef0f4;min-width:40px}
.metricbar-pw{background:#1971c2;border-right:2px solid #fff}
.metricbar-bh{background:#c0504d}
.metric-diff{font-size:11px;color:#6b7280}
.divbar{position:relative;width:100%;height:16px}
.divbar-track{position:absolute;top:50%;left:0;right:0;height:2px;background:#eef0f4;transform:translateY(-50%)}
.divbar-baseline{position:absolute;top:2px;bottom:2px;left:50%;width:2px;background:#1971c2;transform:translateX(-1px)}
.divbar-line{position:absolute;top:50%;height:2px;background:#c0504d;transform:translateY(-50%)}
.divbar-dot{position:absolute;top:50%;width:8px;height:8px;border-radius:50%;background:#c0504d;transform:translate(-50%,-50%);box-shadow:0 0 0 2px #fff}
.divbar-dot.clipped{width:14px;height:14px;box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(192,80,77,.35)}
.time-row{display:flex;align-items:baseline;width:100%;margin-top:4px;gap:6px}
.time-raw{flex:1;font-size:11px;color:#6b7280;font-variant-numeric:tabular-nums}
.time-raw:first-child{text-align:left}.time-raw:last-child{text-align:right}
.time-diff-num{flex:none;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:#6b7280}
.time-diff-num.pw{color:#1971c2}.time-diff-num.bh{color:#c0504d}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.badge.ok{background:#ebfbee;color:#2f9e44}.badge.mid{background:#fff4e6;color:#e8590c}.badge.low{background:#fff0f0;color:#c0504d}
td.empty{color:#9099a6;padding:24px}
.toggle-btn{border:1px solid #d0d5e0;background:#fff;color:#3b5bdb;font-size:11px;padding:4px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.toggle-btn:hover{background:#eef2ff}
tr.embed-row{display:none;background:#fafbfd}
tr.embed-row.open{display:table-row}
tr.embed-row td{white-space:normal;text-align:left}
.embed-cols{display:flex;gap:20px;padding:12px 4px}
.embed-col{flex:1;min-width:0;max-height:640px;overflow-y:auto}
.embed-col h4{margin:0 0 8px;font-size:12px;padding-bottom:6px;border-bottom:2px solid #eef0f4}
.embed-col h4.pw{color:#1971c2}.embed-col h4.bh{color:#c0504d}
.embed-empty{color:#9099a6;font-size:12px}
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
※ 결과(우세/경합/약세)는 표에 표시된 지표(리트윗+좋아요 또는 좋아요+댓글)가 둘 다 PW가 크면 우세, 둘 다 작으면 약세, 엇갈리면 경합입니다.<br>
※ "게시물 보기"는 인터넷 연결된 브라우저에서 열어야 실제 카드로 보입니다 — 오프라인/차단 상태면 링크만 보임.<br>
※ ⏰ 칸: 파란 선(중앙)이 PW 게시 시각 기준선. 밑의 숫자는 PW 기준 시간차 — <b>파란 +분</b>은 PW가 먼저, <b>빨간 -분</b>은 BH가 먼저 올렸다는 뜻. 스케일은 10분 고정 — 이보다 큰 차이는 점이 커짐(실제 시:분은 마우스 올리면 보임).
</div>
</div>
<script>
function toggleEmbeds(rowId, platform, btn) {
  var row = document.getElementById(rowId);
  var opening = !row.classList.contains('open');
  row.classList.toggle('open');
  btn.textContent = opening ? '▼ 접기' : '▶ 보기';
  if (opening && !row.dataset.rendered) {
    row.dataset.rendered = '1';
    if (platform === 'twitter' && window.twttr) window.twttr.widgets.load(row);
    if (platform === 'instagram' && window.instgrm) window.instgrm.Embeds.process();
  }
}
function toggleAllEmbeds(platform, forceOpen) {
  document.querySelectorAll('tr.embed-row[id^="embed-' + platform + '-"]').forEach(function (row) {
    var isOpen = row.classList.contains('open');
    if (forceOpen === isOpen) return;
    var btn = row.previousElementSibling.querySelector('.toggle-btn');
    toggleEmbeds(row.id, platform, btn);
  });
}
</script>
${needsTwitterWidget ? '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>' : ''}
${needsInstagramWidget ? '<script async src="https://www.instagram.com/embed.js"></script>' : ''}
</body></html>`;
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
