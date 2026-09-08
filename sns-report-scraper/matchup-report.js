/**
 * ⚔️ 게시글 맞대결 리포트 — 사람이 고른 당사/경쟁사 게시물 하나씩을 나란히 놓고
 * 좋아요·리트윗·댓글을 비교하는 단발성 리포트.
 *
 * 기간 리포트(html-report.js)와 목적이 다름:
 *  - 기간 리포트는 "그 기간에 올라온 글 전부"를 상품명으로 자동 매칭해서 짝을 지음.
 *    양쪽 게시일이 며칠씩 벌어지면 애초에 짝이 안 지어져서 둘 다 "매칭 안 됨"으로 빠짐.
 *  - 맞대결은 사람이 "이 글과 이 글"이라고 지목하므로 매칭도, 날짜 범위도 필요 없음.
 *
 * 게시일이 다르면 먼저 올린 쪽이 그만큼 더 오래 노출된 상태이므로 경과일을 항상 같이 표시함.
 * (예전엔 여기에 "그대로 승패로 읽으면 안 된다"는 경고 박스도 띄웠는데, 변명처럼 읽히고
 * 실제로 도움이 안 된다는 피드백을 받아서 뺌 — 날짜·경과일이라는 사실만 두고 판단은 사람 몫.)
 */
const fs = require('fs');
const path = require('path');
const { parseCount } = require('./aggregate');

const PLATFORM_LABEL = { twitter: 'X(트위터)', instagram: '인스타그램' };
const METRICS = [
  { key: 'likes', label: '좋아요', icon: '❤️' },
  { key: 'retweets', label: '리트윗', icon: '🔁' },
  { key: 'quotes', label: '인용', icon: '🗨️' },
  { key: 'comments', label: '댓글', icon: '💬' },
];
// 리트윗·인용은 X에만 있는 개념 — 인스타에서 값이 없는 걸 "못 읽음"으로 세면 합계 밑에
// "못 읽어서 빠짐"이라는 있지도 않은 문제가 표시됨. 그래서 아예 해당 없음으로 처리.
const X_ONLY_METRICS = new Set(['retweets', 'quotes']);

function metricApplies(key, platform) {
  if (!X_ONLY_METRICS.has(key)) return true;
  return platform !== 'instagram';
}

function platformOf(pair) {
  return (pair.pw && pair.pw.platform) || (pair.bh && pair.bh.platform) || null;
}

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

/**
 * 쌍별 지표를 세로 나열(행)에서 가로 나열(열)로 바꾼 셀. 지표가 3~4개인데 행으로 깔면
 * 쌍 하나가 화면 한 장을 잡아먹어서, 같은 이벤트의 X/인스타를 나란히 훑을 수 없었음.
 * 좁은 열에서는 숫자를 막대 좌우에 두면 자리가 안 나와서 막대 위에 올림.
 */
function metricCell(m, pwRaw, bhRaw, extra) {
  const pw = pwRaw === null || pwRaw === undefined || pwRaw === '' ? null : parseCount(pwRaw);
  const bh = bhRaw === null || bhRaw === undefined || bhRaw === '' ? null : parseCount(bhRaw);
  const head = `<div class="mhead">${m.icon} ${escapeHtml(m.label)}</div>`;

  if (pw === null && bh === null) {
    return `<div class="mcol">${head}<div class="mna">읽을 수 없었음</div></div>`;
  }
  const fmt = v => (v === null ? '-' : v.toLocaleString());
  // 한쪽만 읽혔을 때 막대를 그리면 그쪽이 100%를 채워 "압승"으로 오해됨 — 빗금 처리
  const oneSided = pw === null || bh === null;
  const total = oneSided ? 0 : pw + bh;
  const pwPct = total > 0 ? Math.round((pw / total) * 100) : 50;
  const track = oneSided
    ? '<div class="track empty"></div>'
    : `<div class="track"><div class="pw" style="width:${pwPct}%"></div><div class="bh" style="width:${100 - pwPct}%"></div></div>`;

  return `<div class="mcol">
    ${head}
    <div class="mvals"><span class="v pw">${fmt(pw)}</span><span class="v bh">${fmt(bh)}</span></div>
    ${track}
    <div class="mnote">${oneSided ? '한쪽만 읽혀서 비교 불가' : escapeHtml(extra || '')}</div>
  </div>`;
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

/** 본문 미리보기 — 임베드가 막히거나(사내 차단·오프라인) 위젯이 실패하면 링크만 남고
 *  아무것도 안 보임. 그때도 "무슨 글이었는지"는 알 수 있게 본문 앞부분을 같이 심어둠. */
function bodyPreview(post, sideLabel) {
  const text = (post && post.text ? String(post.text) : '').trim();
  if (!text) return '';
  const short = text.length > 400 ? text.slice(0, 400) + '…' : text;
  // 임베드가 막힌 특수한 상황에만 필요한 내용이라 기본은 접어둠 — 펼쳐두면 스크롤만 늘어남
  return `<details class="body-details">
    <summary>본문 그대로 보기 (${escapeHtml(sideLabel)})</summary>
    <div class="body-preview">${escapeHtml(short).replace(/\n/g, '<br>')}</div>
  </details>`;
}

/** 표시된 지표 중 PW가 몇 개나 앞섰는지로 우세/경합/약세 — 기간 리포트와 같은 말을 씀 */
function verdictOf(pw, bh) {
  let win = 0; let lose = 0; let counted = 0;
  const platform = (pw && pw.platform) || (bh && bh.platform) || null;
  for (const m of METRICS) {
    if (!metricApplies(m.key, platform)) continue;
    const a = pw ? parseCount(pw[m.key]) : null;
    const b = bh ? parseCount(bh[m.key]) : null;
    if (a === null || b === null) continue;
    counted++;
    if (a > b) win++; else if (a < b) lose++;
  }
  if (counted === 0) return null;
  if (win > 0 && lose === 0) return { text: '우세', cls: 'v-win' };
  if (lose > 0 && win === 0) return { text: '약세', cls: 'v-lose' };
  return { text: '경합', cls: 'v-mid' };
}

/**
 * 맨 위 통합 요약. 같은 이벤트를 X와 인스타에 나눠 올리는 게 보통이라, 섹션만 있으면
 * 두 플랫폼 숫자를 사람이 머리로 더해야 함 — 그걸 대신 해줌.
 * 못 읽은 값은 0으로 치지 않고 합계에서 빼되, 몇 건이 빠졌는지 옆에 적어둠
 * (0으로 더하면 합계가 조용히 작아져서 그쪽이 진 것처럼 보임).
 */
function renderSummary(pairs, collectedAt) {
  if (pairs.length === 0) return '';

  // 인스타만 넣은 리포트에서 리트윗·인용 줄이 "읽을 수 없었음"으로 남으면 있지도 않은
  // 문제처럼 보임 — 어느 쌍에도 해당되지 않는 지표는 요약에서도 줄 자체를 안 만듦
  const shown = METRICS.filter(m => pairs.some(p => metricApplies(m.key, platformOf(p))));

  const sums = {};
  for (const m of shown) {
    const acc = { pw: null, bh: null, pwMissing: 0, bhMissing: 0 };
    for (const p of pairs) {
      if (!metricApplies(m.key, platformOf(p))) continue;
      for (const side of ['pw', 'bh']) {
        const post = p[side];
        if (!post) continue;
        const v = parseCount(post[m.key]);
        if (v === null) { acc[`${side}Missing`]++; continue; }
        acc[side] = (acc[side] || 0) + v;
      }
    }
    sums[m.key] = acc;
  }

  // 한쪽 지표를 하나도 못 읽었으면 합계를 0으로 내놓으면 안 됨 — 0은 "반응이 없었다"는
  // 뜻이 돼서 상대가 100%를 채운 막대로 그려지고, 못 읽은 게 압패한 것처럼 보임.
  const totalOf = side => (shown.every(m => sums[m.key][side] === null)
    ? null
    : shown.reduce((n, m) => (sums[m.key][side] === null ? n : n + sums[m.key][side]), 0));
  const anyTotal = shown.some(m => sums[m.key].pw !== null || sums[m.key].bh !== null);
  // 무엇을 더한 값인지는 실제로 합계에 들어간 지표로 적음 — 인스타만 넣은 리포트에서
  // "좋아요 + 리트윗 + 인용 + 댓글"이라고 써두면 있지도 않은 지표를 더한 것처럼 보임
  const totalCaption = shown
    .filter(m => sums[m.key].pw !== null || sums[m.key].bh !== null)
    .map(m => m.label).join(' + ');
  const missingNote = acc => {
    const parts = [];
    if (acc.pwMissing) parts.push(`당사 ${acc.pwMissing}건`);
    if (acc.bhMissing) parts.push(`경쟁사 ${acc.bhMissing}건`);
    return parts.length ? `못 읽어서 합계에서 빠짐 — ${parts.join(' · ')}` : '';
  };

  // 플랫폼별 소계 — 어느 채널에서 갈렸는지가 합계만 보면 안 보임
  const platforms = [...new Set(pairs.map(p => (p.pw && p.pw.platform) || (p.bh && p.bh.platform)).filter(Boolean))];
  const byPlatform = platforms.map(plat => {
    const inPlat = pairs.filter(p => ((p.pw && p.pw.platform) || (p.bh && p.bh.platform)) === plat);
    const cells = METRICS.filter(m => metricApplies(m.key, plat)).map(m => {
      const pick = side => inPlat.reduce((n, p) => {
        const v = p[side] ? parseCount(p[side][m.key]) : null;
        return v === null ? n : (n || 0) + v;
      }, null);
      const a = pick('pw'); const b = pick('bh');
      if (a === null && b === null) return '';
      return `${m.icon} ${a === null ? '-' : a.toLocaleString()} : ${b === null ? '-' : b.toLocaleString()}`;
    }).filter(Boolean);
    return `<div class="plat-line"><b>${escapeHtml(PLATFORM_LABEL[plat] || plat)}</b> ${escapeHtml(cells.join('  ·  '))}</div>`;
  }).join('');

  return `
  <section class="pair summary" id="summary">
    <div class="pair-head">
      <h2>📊 전체 합산 <span class="ptag">${pairs.length}쌍</span></h2>
      <div class="pair-tools"><button class="cap-btn" onclick="capturePair('summary')">📷 스크린샷</button></div>
    </div>
    <table class="metrics">
      ${anyTotal ? metricRow('총 반응', '🔥', totalOf('pw'), totalOf('bh'), totalCaption) : ''}
      ${shown.map(m => metricRow(m.label, m.icon, sums[m.key].pw, sums[m.key].bh, missingNote(sums[m.key]))).join('\n      ')}
    </table>
    ${byPlatform ? `<div class="by-platform">${byPlatform}</div>` : ''}
  </section>`;
}

function renderPair(pair, index, collectedAt) {
  const { pw, bh, label } = pair;
  const pwDays = pw ? elapsedDays(pw.datetime, collectedAt) : null;
  const bhDays = bh ? elapsedDays(bh.datetime, collectedAt) : null;

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

  // 한 리포트에 X 한 쌍, 인스타 한 쌍을 같이 넣는 게 흔해서(같은 이벤트를 양쪽에 올림)
  // 제목이 똑같이 두 번 나옴 — 어느 쪽 얘기인지 제목에서 바로 알게 플랫폼을 붙여줌.
  const platform = (pw && pw.platform) || (bh && bh.platform) || null;
  const platformTag = platform ? ` <span class="ptag">${escapeHtml(PLATFORM_LABEL[platform] || platform)}</span>` : '';
  const verdict = verdictOf(pw, bh);

  return `
  <section class="pair" id="pair-${index}">
    <div class="pair-head">
      <h2>${index + 1}. ${escapeHtml(label || '맞대결')}${platformTag}</h2>
      <div class="pair-tools">
        ${verdict ? `<span class="verdict ${verdict.cls}">${verdict.text}</span>` : ''}
        <button class="cap-btn" onclick="capturePair(${index})">📷 스크린샷</button>
      </div>
    </div>
    <div class="sides">
      ${sideHead('당사 (PW)', 'pw', pw, collectedAt)}
      ${sideHead('경쟁사 (BH)', 'bh', bh, collectedAt)}
    </div>
    <div class="metric-cols">
      ${METRICS.filter(m => metricApplies(m.key, platform)).map(m => metricCell(m, pw && pw[m.key], bh && bh[m.key], avgText(pw && pw[m.key], bh && bh[m.key]))).join('\n      ')}
    </div>
    <div class="embeds">
      <div class="embed-col"><h4 class="pw">당사 (PW)</h4>${bodyPreview(pw, '당사')}<div class="embed-shrink">${embedBlock(pw)}</div></div>
      <div class="embed-col"><h4 class="bh">경쟁사 (BH)</h4>${bodyPreview(bh, '경쟁사')}<div class="embed-shrink">${embedBlock(bh)}</div></div>
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
.sub{color:#6b7280;font-size:13px}
.page-head{display:flex;align-items:flex-start;gap:14px;margin-bottom:18px}
.page-head>div{flex:1}
/* 전체 스크린샷을 찍는 순간에만 붙는 클래스 — .wrap의 여백(padding)이 사진에
   흰 띠로 남지 않게 잠깐 0으로 만든다(찍고 바로 되돌림) */
.capturing{padding:0!important}
.pair{background:#fff;border-radius:12px;padding:18px 20px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pair h2{font-size:17px;margin:0}
.pair-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.pair-tools{margin-left:auto;display:flex;align-items:center;gap:8px}
.ptag{font-size:12px;font-weight:400;color:#9099a6}
.verdict{font-size:12px;font-weight:700;border-radius:999px;padding:3px 12px}
.verdict.v-win{background:#e7f5ed;color:#1b7f4a}
.verdict.v-mid{background:#fff4e0;color:#a8620a}
.verdict.v-lose{background:#fdecec;color:#c0392b}
.cap-btn{border:1px solid #d0d5e0;background:#fff;color:#374151;font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer}
.cap-btn:hover{background:#f2f5fb}
.summary{border:2px solid #3b5bdb}
.by-platform{border-top:1px solid #eef1f6;padding-top:10px;font-size:12px;color:#4b5563;line-height:1.9}
.body-details{margin-bottom:8px}
.body-details summary{cursor:pointer;font-size:11px;color:#9099a6}
.body-details summary:hover{color:#4b5563}
.body-preview{font-size:12px;color:#4b5563;line-height:1.6;background:#f7f9fc;border:1px solid #eef1f6;border-radius:8px;padding:8px 10px;margin-top:6px;white-space:normal}
/* 쌍별 지표를 가로 열로 — 행으로 깔면 쌍 하나가 화면 한 장을 잡아먹어서 X/인스타를
   나란히 훑을 수 없었음. 좁은 열이라 숫자는 막대 위에 좌우로 붙임 */
.metric-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:14px}
.mcol{border:1px solid #eef1f6;border-radius:10px;padding:10px 12px}
.mhead{font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px}
.mvals{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
.mvals .v{font-size:15px;font-weight:700}
.mvals .v.pw{color:#2563eb}
.mvals .v.bh{color:#dc2626}
.mcol .track{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#eef1f6}
.mcol .track .pw{background:#3b82f6}
.mcol .track .bh{background:#ef4444}
.mcol .track.empty{background:repeating-linear-gradient(45deg,#eef1f6,#eef1f6 4px,#e3e8f0 4px,#e3e8f0 8px)}
.mnote{font-size:10px;color:#9099a6;margin-top:5px;min-height:13px;line-height:1.3}
.mna{font-size:12px;color:#9099a6;padding:6px 0}
/* 미리보기 임베드가 화면을 너무 잡아먹어서 70%로 축소. zoom은 레이아웃 박스까지
   같이 줄어서(transform과 달리) 밑에 빈 공간이 남지 않음 */
.embed-shrink{zoom:.7}
.embed-shrink blockquote{max-width:100%}
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
<div class="page-head">
  <div>
    <h1>${escapeHtml(heading)}</h1>
    <div class="sub">${escapeHtml(title || '')} · 수집: ${escapeHtml(kstText(collectedAt))} (KST) · <b>PW=자사, BH=경쟁사</b></div>
  </div>
  <button class="cap-btn" onclick="captureAll()">📷 전체 스크린샷</button>
</div>
${renderSummary(pairs, collectedAt)}
${pairs.map((p, i) => renderPair(p, i, collectedAt)).join('\n')}
<div class="foot">
※ 이 리포트는 <b>사람이 지목한 게시물</b>만 비교합니다 — 기간이나 상품명 매칭과 무관합니다.<br>
※ 숫자는 수집 시각 기준 누적입니다. 게시일과 경과일은 각 글 위에 그대로 적어뒀습니다.<br>
※ 결과(우세/경합/약세)는 양쪽 다 읽힌 지표만 세서, 전부 앞서면 우세, 전부 뒤지면 약세, 엇갈리면 경합입니다.<br>
※ 인스타그램은 <b>좋아요 수를 숨긴 게시물</b>이면 좋아요를 읽을 수 없습니다. 리트윗·인용은 X에만 있는 지표라 인스타 쪽에는 칸 자체가 없습니다.<br>
※ 🗨️ 인용은 X 상세 페이지의 인용 목록에서 읽습니다 — 인용이 하나도 없으면 X가 그 링크를 아예 안 만들기 때문에 <b>0으로 표시</b>됩니다.<br>
※ 게시물 미리보기는 인터넷이 연결된 브라우저에서 열어야 카드로 보입니다 — 안 보일 때는 각 글의 <b>"본문 그대로 보기"</b>를 펼치면 내용이 있습니다.
</div>
</div>
<script>
${fs.readFileSync(path.join(__dirname, 'node_modules/html2canvas/dist/html2canvas.min.js'), 'utf-8')}
</script>
<script>
// 보고용으로 한 쌍(또는 전체 합산)만 잘라서 PNG로 저장. 리포트 파일 하나로 끝나게
// html2canvas를 그대로 심어둠(인터넷 연결 불필요) — 기간 리포트와 같은 방식.
// 임베드(트위터/인스타 위젯 iframe)는 다른 사이트 콘텐츠라 캡처에 빈 칸으로 나올 수 있음.
// ⚠️ Chromium은 file:// 로 열린 페이지가 만든 다운로드 링크의 파일명이 ASCII가 아니면
// 그 이름을 버리고 확장자도 없는 "download"로 저장해버림(실측 확인). 그래서 한글 대신
// ASCII 이름 + 날짜로 만든다 — 이름을 잃는 것보다 영문이라도 남는 게 나음.
function shotFileName(base) {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  var stamp = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  var ascii = String(base).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return 'matchup-' + (ascii || 'report') + '-' + stamp + '.png';
}

function shoot(el, name, extraCleanup) {
  // 캡처용 버튼 자체가 사진에 찍히면 안 되니 잠깐 숨김(자리는 유지 — display로 지우면
  // 레이아웃이 흔들려서 사진이 원래 화면과 달라짐)
  var btns = el.querySelectorAll('.cap-btn');
  var restore = function () {
    btns.forEach(function (b) { b.style.visibility = ''; });
    if (extraCleanup) extraCleanup();
  };
  btns.forEach(function (b) { b.style.visibility = 'hidden'; });
  return html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true }).then(function (canvas) {
    restore();
    var a = document.createElement('a');
    a.download = shotFileName(name);
    a.href = canvas.toDataURL('image/png');
    a.click();
  }).catch(function (e) {
    restore();
    alert('스크린샷 저장에 실패했어요: ' + e.message);
  });
}

function capturePair(id) {
  var isSummary = typeof id !== 'number';
  var el = document.getElementById(isSummary ? id : 'pair-' + id);
  if (el) shoot(el, isSummary ? 'summary' : 'pair' + (id + 1), null);
}

// 리포트 전체를 한 장으로. .wrap의 좌우·위아래 여백은 사진에 흰 띠로만 남으니
// 찍는 동안만 0으로 줄였다가 되돌린다.
function captureAll() {
  var el = document.querySelector('.wrap');
  if (!el) return;
  el.classList.add('capturing');
  shoot(el, 'all', function () { el.classList.remove('capturing'); });
}
</script>
${needTwitter ? '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>' : ''}
${needInstagram ? '<script async src="https://www.instagram.com/embed.js"></script>' : ''}
</body></html>`;
}

function saveMatchupReport(opts, outputPath) {
  fs.writeFileSync(outputPath, buildMatchupReportHtml(opts));
  return outputPath;
}

module.exports = { buildMatchupReportHtml, saveMatchupReport, elapsedDays, verdictOf };
