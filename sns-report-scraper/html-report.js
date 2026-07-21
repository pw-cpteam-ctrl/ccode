const fs = require('fs');
const path = require('path');
const { formatTakenAt, rankStockProducts, findStockMatch, renderStockSectionHtml, STOCK_SECTION_STYLE } = require('./stock-report');

const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };
const FIELD_ICONS = { likes: '♥️', retweets: '♻️', comments: '💬' };
const PLATFORM_TITLES = { twitter: 'X(트위터)', instagram: '인스타그램' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function verdictBadge(verdict, needsReview) {
  const cls = { 우세: 'ok', 경합: 'mid', 약세: 'low' }[verdict] || 'mid';
  const reviewBadge = needsReview
    ? ` <span class="badge review" title="게시물이 많이 묶여서 서로 다른 상품이 잘못 묶였을 수 있음 — 한 번 확인해보세요">⚠️ 확인 필요</span>`
    : '';
  return `<span class="badge ${cls}">${escapeHtml(verdict)}</span>${reviewBadge}`;
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

// SNS 상품(ip/line) 하나에 매칭된 PW/BH 네이버 재고 항목을 표 우측 끝에 한 칸으로 렌더링.
// 예전엔 PW/BH 칸이 따로 있어서(각자 순위+개수 텍스트) 어느 쪽이 더 파는지 숫자를 눈으로
// 대조해야 했음 — 리트윗/좋아요 칸(metricBar)과 형식을 통일해서 "부분 대 전체" 분할 바로
// 바꿈. 재고 매칭은 PW/BH가 서로 다른 store 안에서 각자 순위가 매겨지는 거라(총 판매
// 추정치, stock-report.js) 그 절대 개수를 막대 비율로 비교.
function salesBar(pwMatch, bhMatch) {
  const pwVal = pwMatch && typeof pwMatch.totalSold === 'number' ? pwMatch.totalSold : null;
  const bhVal = bhMatch && typeof bhMatch.totalSold === 'number' ? bhMatch.totalSold : null;
  if (pwVal === null && bhVal === null) return '<td class="metric sm-none">-</td>';

  // 재입고(음수)는 막대 비율 계산에서 0으로 취급 — 라벨엔 실제 값("재입고+N")을 그대로 보여줌.
  const pwBar = Math.max(pwVal ?? 0, 0);
  const bhBar = Math.max(bhVal ?? 0, 0);
  const total = pwBar + bhBar;
  const pwPct = total > 0 ? (pwBar / total) * 100 : 50;
  const track = total > 0
    ? `<div class="metricbar-pw" style="width:${pwPct}%"></div><div class="metricbar-bh" style="width:${100 - pwPct}%"></div>`
    : '';

  const label = (match, val) => {
    if (val === null) return '매칭 안 됨';
    const mark = match.totalSoldIsEstimated ? '*' : '';
    return val < 0 ? `재입고+${Math.abs(val).toLocaleString()}${mark}` : `${val.toLocaleString()}개${mark}`;
  };
  const title = `PW: ${pwMatch ? (pwMatch.name || '매칭 안 됨') : '매칭 안 됨'} · BH: ${bhMatch ? (bhMatch.name || '매칭 안 됨') : '매칭 안 됨'}`;

  // 리트윗/좋아요 칸의 "2400 (3.4배)" 캡션(metric-diff)과 같은 자리에, 매출도 PW:BH
  // 점유율을 "77:23"처럼 병기 — 반올림한 PW 쪽 값으로 BH를 역산해서 합이 항상 100이 되게 함.
  const pwShare = Math.round(pwPct);
  const shareCaption = total > 0 ? `<div class="metric-diff">${pwShare}:${100 - pwShare}</div>` : '';

  return `<td class="metric" title="${escapeHtml(title)}">
    <div class="metriccell">
      <div class="metricbar">
        <span class="metricbar-val pw">${label(pwMatch, pwVal)}</span>
        <div class="metricbar-track">${track}</div>
        <span class="metricbar-val bh">${label(bhMatch, bhVal)}</span>
      </div>
      ${shareCaption}
    </div>
  </td>`;
}

function renderPlatformSection(platformKey, data, stockComparison) {
  const { products, ownUnmatched, competitorUnmatched, displayFields } = data.productComparison;
  const title = PLATFORM_TITLES[platformKey] || platformKey;

  // 재고 스냅샷이 있으면 store(PW/BH)별로 순위 매긴 목록을 미리 만들어두고, 상품 행마다
  // ip/line으로 근사 매칭 — SNS 실적 순위표 우측에 매출순위 컬럼으로 붙임(별도 섹션 아님).
  const hasStock = Boolean(stockComparison);
  const pwStockRanked = hasStock ? rankStockProducts(stockComparison.stores.PW || []) : null;
  const bhStockRanked = hasStock ? rankStockProducts(stockComparison.stores.BH || []) : null;

  const pwTotals = {};
  const bhTotals = {};
  displayFields.forEach(f => {
    pwTotals[f] = products.reduce((s, p) => s + p.own[`total_${f}`], 0);
    bhTotals[f] = products.reduce((s, p) => s + p.competitor[`total_${f}`], 0);
  });

  // 큰 카드(매칭된 상품)를 좌측에 두고, 우측엔 지표별 PW/BH/파이 그룹을 세로로 쌓음 — 지표가
  // 2개면 3칸+3칸으로 균형 잡힘(예전엔 큰카드+그룹1이 한 줄에 있어서 4칸/3칸으로 언밸런스했음).
  const cards = `
    <div class="cards">
      <div class="card card-hero"><div class="k">매칭된 상품</div><div class="v">${products.length}개</div><div class="s">매칭 안 됨 PW ${ownUnmatched.length} · BH ${competitorUnmatched.length}</div></div>
      <div class="card-groups">
        ${displayFields.map(f => `
        <div class="card-group">
          <div class="card pw"><div class="k">PW 총 ${FIELD_LABELS[f] || f}</div><div class="v">${pwTotals[f].toLocaleString()}</div><div class="s">매칭 상품 기준</div></div>
          <div class="card bh"><div class="k">BH 총 ${FIELD_LABELS[f] || f}</div><div class="v">${bhTotals[f].toLocaleString()}</div><div class="s">PW 대비 ${formatRatioCard(pwTotals[f], bhTotals[f])}</div></div>
          ${pieCard(f, pwTotals[f], bhTotals[f])}
        </div>
        `).join('')}
      </div>
    </div>`;

  const headerCells = ['순위', 'IP', '시리즈',
    ...displayFields.map(f => `${fieldIcon(f)} ${FIELD_LABELS[f] || f}`),
    '⏰ 시각', '결과', '게시물',
    ...(hasStock ? ['📦 매출 (PW vs BH)'] : [])];

  const rows = products.map((p, i) => {
    const rank = i + 1;
    const rankCell = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const embedRowId = `embed-${platformKey}-${i}`;
    const verdictRowClass = { 경합: 'verdict-mid', 약세: 'verdict-low' }[p.verdict] || '';
    const cells = [
      `<td class="rank">${rankCell}</td>`,
      `<td class="name" title="${escapeHtml(p.ip || '(미분류)')}">${escapeHtml(p.ip || '(미분류)')}</td>`,
      `<td>${escapeHtml(p.line || '-')}</td>`,
      ...displayFields.map(f => `<td class="metric">${metricBar(p.own[`total_${f}`], p.competitor[`total_${f}`], p.diffText[f])}</td>`),
      `<td class="metric">${timeCell(p.pwTime, p.bhTime, p.timeDiffSignedMinutes)}</td>`,
      `<td>${verdictBadge(p.verdict, p.needsReview)}</td>`,
      `<td><button class="toggle-btn" onclick="toggleEmbeds('${embedRowId}','${platformKey}',this)">▶ 보기</button></td>`,
      ...(hasStock ? [
        salesBar(findStockMatch(p.ip, p.line, pwStockRanked), findStockMatch(p.ip, p.line, bhStockRanked)),
      ] : []),
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
  // 번호로 바로 가리킬 수 있게. data-post에 게시물 원본을 그대로 심어둬서, "표에 추가" 버튼을
  // 눌렀을 때 다시 파싱할 필요 없이(이미 아는 값이라) 바로 표에 넣을 수 있게 함.
  const unmatchedList = (label, posts, textField) => {
    if (posts.length === 0) return `<p class="unmatched-empty">매칭 안 된 ${label} 게시물 없음</p>`;
    const side = label === 'PW' ? 'pw' : 'bh';
    const items = posts.map((post, i) => {
      const link = post.link || post.url || '';
      const preview = escapeHtml((post[textField] || '').replace(/\n/g, ' ').slice(0, 70));
      const postJson = escapeHtml(JSON.stringify(post));
      return `<li data-post="${postJson}">
        <b>${label} #${i + 1}</b> <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${preview || '(본문 없음)'}</a>
        <button class="add-btn" onclick="promoteUnmatched(this,'${platformKey}','${side}')">표에 추가</button>
      </li>`;
    }).join('');
    return `<ul class="unmatched-list">${items}</ul>`;
  };
  const textField = platformKey === 'twitter' ? 'text' : 'caption';

  return `
  <section class="platform" id="platform-${platformKey}">
    <div class="section-head">
      <h2>[${title}] 상품별 비교</h2>
      <div class="toggle-all">
        <button class="toggle-all-btn" onclick="toggleAllEmbeds('${platformKey}',true)">전체 펼치기</button>
        <button class="toggle-all-btn" onclick="toggleAllEmbeds('${platformKey}',false)">전체 접기</button>
        <button class="toggle-all-btn" onclick="captureSection('${platformKey}','${title}')">📷 스크린샷</button>
      </div>
    </div>
    ${hasStock ? `<div class="sub">📦 재고 매칭 기준 스냅샷: ${escapeHtml(formatTakenAt(stockComparison.latestTakenAt))} (KST) · 초기 판매한도 가정 역산 기준 총 판매추정치(*는 초기 한도 추정임을 표시) — 표 우측 끝(가로 스크롤) 참고</div>` : ''}
    ${cards}
    <div class="table-wrap">
      <table>
        <colgroup>${headerCells.map((_, i) => i === 1 ? '<col style="width:130px">' : '<col>').join('')}</colgroup>
        <thead><tr>${headerCells.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody id="tbody-${platformKey}" data-cols="${headerCells.length}" data-fields="${displayFields.join(',')}" data-has-stock="${hasStock ? '1' : '0'}">${rows || `<tr><td colspan="${headerCells.length}" class="empty">매칭된 상품 없음</td></tr>`}</tbody>
      </table>
    </div>
    <details class="unmatched">
      <summary>매칭 안 된 게시물 (PW ${ownUnmatched.length} · BH ${competitorUnmatched.length})</summary>
      <div class="unmatched-cols">
        <div><h3>PW</h3>${unmatchedList('PW', ownUnmatched, textField)}</div>
        <div><h3>BH</h3>${unmatchedList('BH', competitorUnmatched, textField)}</div>
      </div>
    </details>
    <details class="manual-add">
      <summary>📋 스크래퍼가 놓친 게시물 — 붙여넣기로 표에 추가</summary>
      <div class="manual-add-body">
        <p class="manual-add-help">게시물 상세페이지(트위터는 게시물 클릭해서 들어간 화면)에서 전체 선택 + 복사한 텍스트를 그대로 붙여넣으면, 본문/시각/좋아요·리트윗 수를 자동으로 읽어옵니다. 실패하면 아래 칸에 직접 입력해도 됩니다.
        ${platformKey === 'instagram' ? ' (인스타그램은 자동 파싱 대상이 아니라 전부 직접 입력해야 함)' : ''}</p>
        <div class="manual-add-row">
          <label>어느 쪽? <select id="side-${platformKey}"><option value="pw">PW(자사)</option><option value="bh">BH(경쟁사)</option></select></label>
          <label>링크 <input type="text" id="link-${platformKey}" placeholder="https://x.com/... 또는 https://www.instagram.com/p/..." /></label>
        </div>
        <textarea id="paste-${platformKey}" class="manual-add-textarea" placeholder="게시물 상세페이지에서 복사한 내용을 여기에 붙여넣으세요"></textarea>
        <div class="manual-add-row">
          <button class="add-btn primary" onclick="parseAndAddPost('${platformKey}')">붙여넣은 내용 분석해서 추가</button>
        </div>
        <div id="manual-add-error-${platformKey}" class="manual-add-error"></div>
        <details class="manual-add-fallback">
          <summary>자동 분석이 실패했거나 인스타그램인 경우 — 직접 입력</summary>
          <div class="manual-add-row">
            <label>본문 <textarea id="fallback-text-${platformKey}" class="manual-add-textarea small" placeholder="상품 설명이 들어간 본문(첫 줄 또는 링크 위 줄에 상품명이 있어야 자동 인식됨)"></textarea></label>
          </div>
          <div class="manual-add-row">
            <label>게시 시각(KST) <input type="datetime-local" id="fallback-dt-${platformKey}" /></label>
            <label>좋아요 <input type="text" id="fallback-likes-${platformKey}" placeholder="예: 373 또는 1.2만" /></label>
            <label>${platformKey === 'twitter' ? '리트윗' : '댓글'} <input type="text" id="fallback-metric2-${platformKey}" placeholder="예: 445" /></label>
          </div>
          <div class="manual-add-row">
            <button class="add-btn primary" onclick="addFallbackPost('${platformKey}')">직접 입력한 값으로 추가</button>
          </div>
        </details>
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
 * @param {object|null} [stockComparison] stock-report.js의 buildStockComparison() 결과 —
 *   있으면 각 상품 행 우측 끝에 매칭된 재고 매출순위 컬럼 2개(PW/BH)를 추가함. 별도 섹션으로
 *   안 빼고 같은 표 안(가로 스크롤)에 두는 게 방침 — 위아래로 왔다갔다하며 대조하지 않게.
 * @returns {string} HTML 문서 전체
 */
function buildHtmlReport(report, stockComparison = null) {
  const platformKeys = Object.keys(report.platforms);
  const sections = platformKeys.map(key => renderPlatformSection(key, report.platforms[key], stockComparison)).join('\n');
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
.card-hero{flex:0 0 200px;display:flex;flex-direction:column;justify-content:center}
.card-groups{display:flex;flex-direction:column;gap:12px;flex:1;min-width:0}
.card-group{display:flex;gap:12px;flex:none;flex-wrap:wrap}
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
td.name{text-align:left;font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis}
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
td.sm-none{color:#c9ced8;font-size:12px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.badge.ok{background:#ebfbee;color:#2f9e44}.badge.mid{background:#fff4e6;color:#e8590c}.badge.low{background:#fff0f0;color:#c0504d}
.badge.review{background:#fff9db;color:#997404;cursor:help}
td.empty{color:#9099a6;padding:24px}
.toggle-btn{border:1px solid #d0d5e0;background:#fff;color:#3b5bdb;font-size:11px;padding:4px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.toggle-btn:hover{background:#eef2ff}
tr.embed-row{display:none;background:#fafbfd}
tr.embed-row.open{display:table-row}
tr.embed-row td{white-space:normal;text-align:left}
.embed-cols{display:flex;gap:20px;padding:12px 4px;width:60%}
.embed-col{flex:1;min-width:0;max-height:640px;overflow-y:auto}
.embed-col h4{margin:0 0 8px;font-size:12px;padding-bottom:6px;border-bottom:2px solid #eef0f4}
.embed-col h4.pw{color:#1971c2}.embed-col h4.bh{color:#c0504d}
.embed-empty{color:#9099a6;font-size:12px}
details.unmatched{margin-top:10px;background:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
details.unmatched summary{cursor:pointer;color:#6b7280;font-size:13px}
.unmatched-cols{display:flex;gap:24px;margin-top:10px;flex-wrap:wrap}
.unmatched-cols>div{flex:1;min-width:260px}
.unmatched-cols h3{font-size:13px;color:#6b7280;margin:0 0 6px}
.unmatched-list{list-style:none;margin:0;padding:0;font-size:12px}
.unmatched-list li{padding:4px 0;border-bottom:1px solid #f4f6fb;display:flex;align-items:center;gap:8px}
.unmatched-list a{color:#374151;text-decoration:none;flex:1;min-width:0}.unmatched-list a:hover{text-decoration:underline}
.unmatched-empty{color:#9099a6;font-size:12px}
.add-btn{border:1px solid #d0d5e0;background:#fff;color:#2f9e44;font-size:11px;padding:3px 8px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none}
.add-btn:hover{background:#ebfbee}
.add-btn.primary{color:#fff;background:#3b5bdb;border-color:#3b5bdb;padding:6px 14px;font-size:12px}
.add-btn.primary:hover{background:#2f4bc7}
.add-btn.danger{color:#c0504d;border-color:#f3d4d3}
.add-btn.danger:hover{background:#fff0f0}
details.manual-add{margin-top:10px;background:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
details.manual-add summary{cursor:pointer;color:#6b7280;font-size:13px}
.manual-add-body{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.manual-add-help{font-size:12px;color:#6b7280;margin:0}
.manual-add-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
.manual-add-row label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#374151}
.manual-add-row input,.manual-add-row select{border:1px solid #d0d5e0;border-radius:8px;padding:6px 8px;font-size:12px;min-width:160px}
.manual-add-textarea{width:100%;min-height:90px;border:1px solid #d0d5e0;border-radius:8px;padding:8px;font-size:12px;font-family:inherit;resize:vertical}
.manual-add-textarea.small{min-height:60px;min-width:280px}
.manual-add-error{color:#c0504d;font-size:12px;white-space:pre-line}
details.manual-add-fallback{margin-top:4px}
details.manual-add-fallback summary{cursor:pointer;color:#9099a6;font-size:12px}
tr.manual-row{background:#f2fbf4}
tr.manual-row td.name{position:relative}
.manual-tag{display:inline-block;font-size:10px;font-weight:700;color:#2f9e44;background:#ebfbee;border-radius:999px;padding:1px 6px;margin-right:4px}
.export-box{margin-top:16px;background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.export-box h3{font-size:14px;margin:0 0 6px}
.export-box p{font-size:12px;color:#6b7280;margin:0 0 8px}
.export-box textarea{width:100%;min-height:120px;font-family:monospace;font-size:11px;border:1px solid #d0d5e0;border-radius:8px;padding:8px}
.foot{margin-top:16px;color:#6b7280;font-size:12px;line-height:1.6;background:#fff;border-radius:10px;padding:14px 16px}
@media (max-width:860px){
  .wrap{padding:20px 12px}
  .cards{flex-direction:column}
  .card-hero{width:100%}
  .card-groups{width:100%}
}
${STOCK_SECTION_STYLE}
</style></head><body><div class="wrap">
<h1>📊 SNS 성과 비교 리포트</h1>
<div class="sub">수집 기간: ${escapeHtml(report.startDate)} ~ ${escapeHtml(report.endDate)} · 생성: ${escapeHtml(report.generatedAt)} · <b>PW=자사, BH=경쟁사</b> · 랭킹: PW+BH 지표 합산순</div>
${sections}
<div class="foot">
※ 상품명은 게시물 본문에서 자동 추출(당사: 첫 줄 / 경쟁사: 링크 줄 위) 후, 키워드 2개 이상 겹치는 게시물끼리 그룹화한 결과입니다.<br>
※ 표현이 서로 다르거나 상품명을 못 뽑은 게시물은 "매칭 안 됨" 목록에 별도로 있습니다 — 조용히 빠진 게 아닙니다.<br>
※ 결과(우세/경합/약세)는 표에 표시된 지표(리트윗+좋아요 또는 좋아요+댓글)가 둘 다 PW가 크면 우세, 둘 다 작으면 약세, 엇갈리면 경합입니다.<br>
※ "게시물 보기"는 인터넷 연결된 브라우저에서 열어야 실제 카드로 보입니다 — 오프라인/차단 상태면 링크만 보임.<br>
※ ⏰ 칸: 파란 선(중앙)이 PW 게시 시각 기준선. 밑의 숫자는 PW 기준 시간차 — <b>파란 +분</b>은 PW가 먼저, <b>빨간 -분</b>은 BH가 먼저 올렸다는 뜻. 스케일은 10분 고정 — 이보다 큰 차이는 점이 커짐(실제 시:분은 마우스 올리면 보임).${stockComparison ? '<br>※ 📦 매출 칸(표 우측 끝, 가로 스크롤): 상품명으로 네이버 재고 데이터와 근사 매칭한 결과를 리트윗/좋아요 칸과 같은 분할 바로 표시 — 막대는 PW/BH 총 판매추정치(개수) 비율, 숫자 뒤 "*"는 현재 재고를 가장 가까운 1000단위로 올려 "초기 판매한도였을 것"으로 가정하고 역산한 추정치라는 표시. "매칭 안 됨"은 그 스토어에서 이름이 비슷한 재고 상품을 못 찾은 경우, "-"는 PW/BH 둘 다 못 찾은 경우. 마우스 올리면 실제로 매칭된 재고 상품명이 보이니 매칭이 맞는지 확인해보세요.' : ''}
</div>
${renderStockSectionHtml(stockComparison)}
<div class="export-box" id="export-box" style="display:none">
  <h3>💾 표에 추가한 게시물 저장</h3>
  <p>아래 내용을 통째로 복사해서 <code>manual-posts.json</code> 파일에 붙여넣으면, 다음에 리포트를 다시 만들 때도(재수집 없이 <code>rebuild-report.js</code>만 돌려도) 계속 반영됩니다. 이 리포트 파일을 다시 열면 지금 추가한 내용은 초기화됩니다 — 저장하지 않으면 이 화면에서만 보인 미리보기일 뿐입니다.</p>
  <textarea id="export-textarea" readonly onclick="this.select()"></textarea>
  <div class="manual-add-row" style="margin-top:8px">
    <button class="add-btn primary" onclick="copyExport()">복사</button>
  </div>
</div>
</div>
<script>
${fs.readFileSync(path.join(__dirname, 'node_modules/html2canvas/dist/html2canvas.min.js'), 'utf-8')}
</script>
<script>
${fs.readFileSync(path.join(__dirname, 'matching-core.js'), 'utf-8')}
${fs.readFileSync(path.join(__dirname, 'paste-parser.js'), 'utf-8')}

// 트위터/인스타 표 영역만 통째로 이미지(PNG)로 캡처해서 다운로드 — 오프라인 리포트
// 파일 하나로 완결되게 html2canvas 원본을 그대로 위에 심어둠(인터넷 연결 불필요).
// 접힌 게시물 임베드(트위터/인스타 위젯 iframe)는 다른 사이트 콘텐츠라 캡처가 안 되거나
// 빈 칸으로 나올 수 있음 — 표 자체(핵심 내용)는 정상적으로 찍힘.
function captureSection(platformKey, title) {
  var el = document.getElementById('platform-' + platformKey);
  if (!el || typeof html2canvas === 'undefined') {
    alert('스크린샷 기능을 불러오지 못했습니다.');
    return;
  }
  // 버튼 자체나 원형 그래프(html2canvas가 conic-gradient를 못 그려서 빈 회색 원으로 나옴)가
  // 스크린샷 안에 같이 찍히지 않게, 캡처 직전에만 잠깐 숨겼다가 끝나면 되돌림.
  var toggleRow = el.querySelector('.toggle-all');
  var pies = el.querySelectorAll('.piechart');
  toggleRow.style.visibility = 'hidden';
  pies.forEach(function (p) { p.style.visibility = 'hidden'; });
  html2canvas(el, { backgroundColor: '#f4f6fb', scale: 2 }).then(function (canvas) {
    canvas.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.download = 'SNS리포트-' + title.replace(/[()]/g, '') + '.png';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }).catch(function (err) {
    alert('스크린샷 캡처 중 문제가 생겼어요: ' + err.message);
  }).finally(function () {
    toggleRow.style.visibility = '';
    pies.forEach(function (p) { p.style.visibility = ''; });
  });
}

// 리포트 안 "붙여넣기로 게시물 추가" 기능 — 브라우저 세션 동안만 유지되는 미리보기용
// 임시 상태(리포트 파일을 다시 열면 초기화됨). 실제로 다음에도 유지하려면 화면 하단
// "저장" 박스에서 JSON을 복사해 manual-posts.json에 붙여넣어야 함(run-megahouse.js/
// rebuild-report.js가 그 파일을 읽어서 실제 수집분에 합쳐줌 — aggregate.js의
// applyManualPosts 참고).
window._manualAdditions = { twitter: { pw: [], bh: [] }, instagram: { pw: [], bh: [] } };

function platformTextField(platform) { return platform === 'twitter' ? 'text' : 'caption'; }
function platformMetric2Label(platform) { return platform === 'twitter' ? '리트윗' : '댓글'; }
function platformMetric2Field(platform) { return platform === 'twitter' ? 'retweets' : 'comments'; }

function refreshExportBox() {
  var box = document.getElementById('export-box');
  var total = window._manualAdditions.twitter.pw.length + window._manualAdditions.twitter.bh.length +
    window._manualAdditions.instagram.pw.length + window._manualAdditions.instagram.bh.length;
  if (total === 0) { box.style.display = 'none'; return; }
  box.style.display = '';
  // _manualId는 화면 안에서 삭제 버튼이 대상을 찾기 위한 임시 표시일 뿐, manual-posts.json에
  // 저장되는 실제 게시물 데이터엔 필요 없어서 내보낼 때는 빼고 씀.
  var clean = {};
  ['twitter', 'instagram'].forEach(function (platform) {
    clean[platform] = { pw: [], bh: [] };
    ['pw', 'bh'].forEach(function (side) {
      clean[platform][side] = window._manualAdditions[platform][side].map(function (p) {
        var copy = Object.assign({}, p);
        delete copy._manualId;
        return copy;
      });
    });
  });
  document.getElementById('export-textarea').value = JSON.stringify(clean, null, 2);
}
function removeManualPost(btn) {
  var tr = btn.closest('tr');
  var platform = tr.dataset.platform;
  var side = tr.dataset.side;
  var manualId = parseInt(tr.dataset.manualId, 10);
  window._manualAdditions[platform][side] = window._manualAdditions[platform][side].filter(function (p) {
    return p._manualId !== manualId;
  });
  var tbody = tr.parentElement;
  tr.remove();
  if (!tbody.querySelector('tr')) {
    var cols = parseInt(tbody.dataset.cols, 10);
    tbody.innerHTML = '<tr><td colspan="' + cols + '" class="empty">매칭된 상품 없음</td></tr>';
  }
  refreshExportBox();
}
function copyExport() {
  var ta = document.getElementById('export-textarea');
  ta.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).catch(function () { document.execCommand('copy'); });
  } else {
    document.execCommand('copy');
  }
}

// 게시물 하나(post: {link/url, datetime, likes, retweets 또는 comments, text/caption})를
// 표에 미리보기로 추가 + window._manualAdditions에 기록(저장 버튼용). 실제 "어느 상품과
// 같은 건지"는 다음에 rebuild-report.js를 돌릴 때 평소 자동 매칭 로직이 다시 판단하므로,
// 여기선 그룹화를 흉내내지 않고 "PW만/BH만 아는 새 게시물"이라는 걸 명확히 보여주는
// 별도 행으로만 추가함(과도하게 복잡해지지 않게 하려는 의도적 단순화).
window._manualIdCounter = 0;

function addManualPost(platform, side, post) {
  var textField = platformTextField(platform);
  var text = post[textField] || '';
  var title = side === 'pw' ? extractOwnProductName(text) : extractCompetitorProductName(text);
  var line = detectProductLine(text);
  var split = splitIpAndLine(title, line);
  var ip = split.ip || '(미분류)';

  // _manualId는 화면에서 "삭제" 버튼이 어느 행/어느 배열 항목을 지워야 하는지 찾기 위한
  // 표시용 태그일 뿐 — 저장(export) 시에는 실제 게시물 데이터가 아니므로 빼고 내보냄.
  var manualId = ++window._manualIdCounter;
  var taggedPost = Object.assign({}, post, { _manualId: manualId });
  window._manualAdditions[platform][side].push(taggedPost);
  refreshExportBox();

  var link = post.link || post.url || '';
  var kst = new Date(new Date(post.datetime).getTime() + 9 * 3600 * 1000);
  var timeText = (kst.getUTCMonth() + 1) + '/' + kst.getUTCDate() + ' ' + kst.getUTCHours() + ':' + String(kst.getUTCMinutes()).padStart(2, '0');
  var sideLabel = side === 'pw' ? 'PW' : 'BH';
  var fieldLabels = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };

  var tbody = document.getElementById('tbody-' + platform);
  var fields = tbody.dataset.fields.split(',');
  var hasStock = tbody.dataset.hasStock === '1';
  var tr = document.createElement('tr');
  tr.className = 'manual-row';
  tr.dataset.platform = platform;
  tr.dataset.side = side;
  tr.dataset.manualId = String(manualId);
  var escName = ip.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  var cells = ['<td class="rank">🆕</td>',
    '<td class="name"><span class="manual-tag">수동추가·' + sideLabel + '만</span>' + escName + '</td>',
    '<td>' + (split.line || '-') + '</td>'];
  // 지표 칸(리트윗/좋아요 등)마다 이 게시물이 아는 쪽(PW 또는 BH) 값만 채우고 반대쪽은
  // "짝 없음"으로 표시 — metricBar처럼 두 값을 나눈 막대로 그리진 않음(그러려면 이 파일의
  // metricBar 함수를 브라우저 JS로도 그대로 옮겨야 해서 과하게 복잡해짐. 실제 정확한
  // 비교 막대는 다음에 rebuild-report.js로 다시 만들 때 정식으로 반영됨).
  fields.forEach(function (f) {
    var val = parseCount(post[f]);
    cells.push('<td>' + sideLabel + ' ' + (val !== null ? val.toLocaleString() : '-') + ' ' + (fieldLabels[f] || f) + '<br><span style="color:#9099a6;font-size:11px">(반대쪽 짝 없음)</span></td>');
  });
  cells.push('<td>' + timeText + '</td>');
  cells.push('<td>-</td>');
  cells.push('<td>' + (link ? '<a href="' + link + '" target="_blank" rel="noopener">링크</a>' : '') +
    ' <button class="add-btn danger" onclick="removeManualPost(this)">삭제</button></td>');
  if (hasStock) cells.push('<td>-</td>');
  tr.innerHTML = cells.join('');
  var emptyRow = tbody.querySelector('td.empty');
  if (emptyRow) emptyRow.closest('tr').remove();
  tbody.insertBefore(tr, tbody.firstChild);
}

function promoteUnmatched(btn, platform, side) {
  var li = btn.closest('li');
  var post = JSON.parse(li.dataset.post);
  addManualPost(platform, side, post);
  li.remove();
}

function parseAndAddPost(platform) {
  var errorBox = document.getElementById('manual-add-error-' + platform);
  errorBox.textContent = '';
  var raw = document.getElementById('paste-' + platform).value;
  var link = document.getElementById('link-' + platform).value.trim();
  var side = document.getElementById('side-' + platform).value;
  if (!link) { errorBox.textContent = '링크를 입력해주세요 — 붙여넣은 본문엔 링크가 없어서 직접 입력해야 합니다.'; return; }

  var result = parsePastedPost(raw);
  if (!result.ok) { errorBox.textContent = result.error; return; }

  var textField = platformTextField(platform);
  var post = { link: link, url: link, datetime: result.datetime, likes: String(result.likes), retweets: String(result.retweets) };
  post[textField] = result.text;
  addManualPost(platform, side, post);
  document.getElementById('paste-' + platform).value = '';
  document.getElementById('link-' + platform).value = '';
}

function addFallbackPost(platform) {
  var errorBox = document.getElementById('manual-add-error-' + platform);
  errorBox.textContent = '';
  var link = document.getElementById('link-' + platform).value.trim();
  var side = document.getElementById('side-' + platform).value;
  var text = document.getElementById('fallback-text-' + platform).value;
  var dtLocal = document.getElementById('fallback-dt-' + platform).value; // "YYYY-MM-DDTHH:MM", KST로 입력받음
  var likes = document.getElementById('fallback-likes-' + platform).value;
  var metric2 = document.getElementById('fallback-metric2-' + platform).value;

  if (!link) { errorBox.textContent = '링크를 입력해주세요.'; return; }
  if (!dtLocal) { errorBox.textContent = '게시 시각을 입력해주세요.'; return; }

  var datetime = new Date(dtLocal + ':00+09:00').toISOString();
  var textField = platformTextField(platform);
  var metric2Field = platformMetric2Field(platform);
  var post = { link: link, url: link, datetime: datetime, likes: likes };
  post[metric2Field] = metric2;
  post[textField] = text;
  addManualPost(platform, side, post);
}

// 인스타그램 embed.js는 트위터 widgets.js와 달리 async 로딩이 늦게 끝나면(느린 네트워크 등)
// 토글을 누른 시점에 window.instgrm이 아직 없어서 조용히 아무 일도 안 일어남 — 예전엔
// dataset.rendered를 그때 바로 '1'로 찍어버려서 다시 열어도 재시도가 안 됐던 게 "네트워크는
// 되는데 임베드만 안 뜨는" 버그의 원인. widgets.load/Embeds.process는 여러 번 불러도
// 이미 처리된 임베드는 건드리지 않으므로(멱등) rendered 플래그 없이 열 때마다 시도하고,
// 스크립트가 아직 안 뜬 경우 잠깐 폴링해서 뜨자마자 처리한다.
function tryRenderEmbeds(platform, row, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 20; // 300ms * 20 = 최대 6초까지 대기
  if (platform === 'twitter' && window.twttr && window.twttr.widgets) { window.twttr.widgets.load(row); return; }
  if (platform === 'instagram' && window.instgrm && window.instgrm.Embeds) { window.instgrm.Embeds.process(); return; }
  if (attemptsLeft > 0) setTimeout(function () { tryRenderEmbeds(platform, row, attemptsLeft - 1); }, 300);
}
function toggleEmbeds(rowId, platform, btn) {
  var row = document.getElementById(rowId);
  var opening = !row.classList.contains('open');
  row.classList.toggle('open');
  btn.textContent = opening ? '▼ 접기' : '▶ 보기';
  if (opening) tryRenderEmbeds(platform, row);
}
function toggleAllEmbeds(platform, forceOpen) {
  document.querySelectorAll('tr.embed-row[id^="embed-' + platform + '-"]').forEach(function (row) {
    var isOpen = row.classList.contains('open');
    if (forceOpen === isOpen) return;
    var btn = row.previousElementSibling.querySelector('.toggle-btn');
    toggleEmbeds(row.id, platform, btn);
  });
}
function toggleStockTrend(rowId, btn) {
  var row = document.getElementById(rowId);
  var opening = !row.classList.contains('open');
  row.classList.toggle('open');
  btn.textContent = opening ? '▼ 접기' : '▶ 보기';
}
function toggleAllStockTrends(forceOpen) {
  document.querySelectorAll('tr.trend-row[id^="stock-trend-"]').forEach(function (row) {
    var isOpen = row.classList.contains('open');
    if (forceOpen === isOpen) return;
    var btn = row.previousElementSibling.querySelector('.toggle-btn');
    toggleStockTrend(row.id, btn);
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
function saveHtmlReport(report, outputPath, stockComparison = null) {
  const html = buildHtmlReport(report, stockComparison);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return outputPath;
}

module.exports = { buildHtmlReport, saveHtmlReport };
