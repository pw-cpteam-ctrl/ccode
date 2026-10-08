/**
 * 팔로워 추이 — 쌓아둔 스냅샷(_follower-history.json)을 리포트 화면에 보여주는 부분.
 *
 * 왜 따로 파일을 뺐나: html-report.js가 이미 1,100줄이 넘어서 여기에 더 얹으면 손대기가
 * 무서워진다. 재고(stock-report.js)도 같은 이유로 따로 빼뒀고 그 방식이 잘 돌아가서 맞췄다.
 *
 * 무엇을 보여주나 — 핵심은 '지금 몇 명'이 아니라 '얼마나 빠르게 느는가'다.
 * 예전 경쟁사 분석에서, 당사 기반이 경쟁사의 두 배인데도 "그 기간 늘어난 수"만 보고
 * 당사가 열위라고 잘못 결론 낸 적이 있다(기반 규모를 안 봤다). 그래서 여기서는
 *   (1) 지금 몇 명  (2) 직전 수집 대비 증감  (3) 첫 기록 대비 증가율
 * 셋을 항상 같이 놓는다. 하나만 보면 반드시 틀린 결론이 나온다.
 *
 * 숫자를 그대로 적는 이유: 팔로워 수는 계정 화면에 들어가면 누구나 보이는 공개 정보라
 * 판매 개수·재고 수량 같은 대외비와 성격이 다르다(그쪽은 지금도 파일에 아예 안 심는다).
 */

const SIDE_LABEL = { PW: '당사', BH: '경쟁사' };
const PLATFORM_LABEL = { twitter: 'X (트위터)', instagram: '인스타그램' };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 161234 → "161,234" */
function comma(n) {
  return typeof n === 'number' ? n.toLocaleString('ko-KR') : '–';
}

/** 2026-10-08T12:34:56Z → "10/08" (한국 시간 기준) */
function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace('-', '/');
}

/**
 * 쌓인 스냅샷을 계정별 시계열로 바꾼다.
 *
 * 값을 못 읽은 시점(followers=null)은 '그날 0명'이 아니라 '그날 못 쟀다'는 뜻이라
 * 숫자 계산에서는 빼고, 추이 선에서도 그 점만 건너뛴다. 빼지 않고 0으로 치면
 * 선이 바닥까지 떨어졌다가 올라오는 가짜 급락이 생긴다.
 */
function buildFollowerSummary(history) {
  const snapshots = Array.isArray(history?.snapshots) ? history.snapshots : [];
  if (snapshots.length === 0) return null;

  const sorted = [...snapshots].sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
  const byKey = new Map();

  sorted.forEach(snap => {
    (snap.accounts || []).forEach(a => {
      const key = `${a.platform}|${a.side}`;
      if (!byKey.has(key)) {
        byKey.set(key, { platform: a.platform, side: a.side, account: a.account, points: [] });
      }
      const g = byKey.get(key);
      g.account = a.account || g.account;
      g.points.push({
        takenAt: snap.takenAt,
        count: typeof a.followers === 'number' ? a.followers : null,
        approx: Boolean(a.approx),
      });
    });
  });

  const groups = [...byKey.values()].map(g => {
    const real = g.points.filter(p => typeof p.count === 'number');
    const latest = real[real.length - 1] || null;
    const prev = real.length >= 2 ? real[real.length - 2] : null;
    const first = real[0] || null;
    const deltaPrev = latest && prev ? latest.count - prev.count : null;
    const deltaFirst = latest && first && first !== latest ? latest.count - first.count : null;
    // 증가율은 '처음 잰 날 대비'다. 기반 규모가 다른 두 계정을 나란히 놓으려면
    // 늘어난 사람 수(절대값)가 아니라 이 비율로 봐야 한다 — 큰 계정은 가만히 있어도
    // 늘어나는 사람 수가 더 많아서, 절대값만 비교하면 항상 큰 쪽이 이긴 것처럼 보인다.
    const ratePct = deltaFirst !== null && first.count > 0 ? (deltaFirst / first.count) * 100 : null;
    return {
      ...g,
      latest: latest ? latest.count : null,
      approx: Boolean(latest && latest.approx),
      deltaPrev,
      deltaFirst,
      ratePct,
      firstAt: first ? first.takenAt : null,
      prevAt: prev ? prev.takenAt : null,
      latestAt: latest ? latest.takenAt : null,
      measured: real.length,
    };
  });

  return {
    takenAt: sorted[sorted.length - 1].takenAt,
    snapshotCount: sorted.length,
    groups,
  };
}

/**
 * 선 하나를 그린다. 두 계정을 같은 그림에 겹치려고 '첫 기록=100' 지수로 바꿔서 그린다.
 *
 * 가로 위치는 '몇 번째 기록인가'가 아니라 '실제 날짜'로 잡는다. 수집 간격은 들쭉날쭉한데
 * (하루 뒤에 한 번, 2주 뒤에 한 번) 점을 같은 간격으로 늘어놓으면 기울기가 거짓말을 한다.
 * 한쪽만 값을 못 읽은 날이 있어도 두 선의 가로 위치가 어긋나지 않는 효과도 같이 있다.
 */
function sparkPath(points, minIdx, maxIdx, tMin, tMax, w, h) {
  const real = points.filter(p => typeof p.count === 'number');
  if (real.length < 2) return null;
  const base = real[0].count || 1;
  const span = (maxIdx - minIdx) || 1;
  const tSpan = (tMax - tMin) || 1;
  return real.map((p, i) => {
    const x = ((new Date(p.takenAt).getTime() - tMin) / tSpan) * w;
    const idx = (p.count / base) * 100;
    const y = h - ((idx - minIdx) / span) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function deltaHtml(n, suffix = '') {
  if (n === null || n === undefined) return '<span class="fo-flat">–</span>';
  if (n === 0) return `<span class="fo-flat">변화 없음</span>`;
  const cls = n > 0 ? 'fo-up' : 'fo-down';
  const sign = n > 0 ? '+' : '−';
  return `<span class="${cls}">${sign}${comma(Math.abs(n))}${suffix}</span>`;
}

function ratePctHtml(p) {
  if (p === null || p === undefined) return '<span class="fo-flat">–</span>';
  const cls = p > 0 ? 'fo-up' : p < 0 ? 'fo-down' : 'fo-flat';
  const sign = p > 0 ? '+' : p < 0 ? '−' : '';
  return `<span class="${cls}">${sign}${Math.abs(p).toFixed(2)}%</span>`;
}

/** 두 계정의 증가율을 한 줄로 비교해준다 — 표를 읽을 줄 몰라도 결론이 보이게. */
function raceLine(pw, bh) {
  if (!pw || !bh || pw.ratePct === null || bh.ratePct === null) return '';
  const diff = pw.ratePct - bh.ratePct;
  if (Math.abs(diff) < 0.005) return '<div class="fo-race even">같은 기간 증가 속도가 양쪽 거의 같습니다.</div>';
  const fast = diff > 0 ? '당사' : '경쟁사';
  const cls = diff > 0 ? 'pw' : 'bh';
  return `<div class="fo-race ${cls}">같은 기간 <b>${fast}</b>가 더 빠르게 늘었습니다 — 차이 ${Math.abs(diff).toFixed(2)}%p</div>`;
}

function renderPlatformBlock(platform, groups) {
  const pw = groups.find(g => g.side === 'PW');
  const bh = groups.find(g => g.side === 'BH');
  const sides = [pw, bh].filter(Boolean);
  if (sides.length === 0) return '';

  // 지수(첫 기록=100)로 바꿔서 두 선을 한 그림에 겹친다. 실제 수(16만 vs 8만)를 그대로
  // 같은 축에 올리면 둘 다 거의 평평한 직선이 돼서 정작 보고 싶은 '기울기 차이'가 안 보인다.
  const indices = sides.flatMap(g => {
    const real = g.points.filter(p => typeof p.count === 'number');
    if (real.length < 2) return [];
    const base = real[0].count || 1;
    return real.map(p => (p.count / base) * 100);
  });
  const hasLine = indices.length > 0;
  const pad = 0.15;
  const minIdx = hasLine ? Math.min(...indices) - pad : 100;
  const maxIdx = hasLine ? Math.max(...indices) + pad : 100;
  const W = 260, H = 54;
  // 가로축 범위는 두 계정을 합친 전체 기간 — 양쪽을 같은 자로 재야 기울기를 비교할 수 있다.
  const times = sides.flatMap(g => g.points.filter(p => typeof p.count === 'number'))
    .map(p => new Date(p.takenAt).getTime()).filter(t => !Number.isNaN(t));
  const tMin = times.length ? Math.min(...times) : 0;
  const tMax = times.length ? Math.max(...times) : 1;

  const cards = sides.map(g => `<div class="fo-card ${g.side === 'PW' ? 'pw' : 'bh'}">
  <div class="fo-k">${SIDE_LABEL[g.side] || escapeHtml(g.side)} <span class="fo-acc">@${escapeHtml(g.account || '')}</span></div>
  <div class="fo-v">${comma(g.latest)}${g.approx ? '<span class="fo-approx" title="계정 화면에 줄여서 표시된 숫자(1.6만 등)를 되돌린 값이라 실제와 몇십 명 차이 날 수 있습니다.">≈</span>' : ''}</div>
  <div class="fo-d">직전 대비 ${deltaHtml(g.deltaPrev)}${g.prevAt ? ` <span class="fo-when">(${shortDate(g.prevAt)} 기준)</span>` : ''}</div>
  <div class="fo-d">첫 기록 대비 ${deltaHtml(g.deltaFirst)} · ${ratePctHtml(g.ratePct)}${g.firstAt ? ` <span class="fo-when">(${shortDate(g.firstAt)}부터)</span>` : ''}</div>
</div>`).join('\n');

  const lines = hasLine ? sides.map(g => {
    const d = sparkPath(g.points, minIdx, maxIdx, tMin, tMax, W, H);
    if (!d) return '';
    const color = g.side === 'PW' ? '#1971c2' : '#c0504d';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('') : '';

  const chart = hasLine
    ? `<div class="fo-chart">
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="팔로워 증가 속도 추이">${lines}</svg>
  <div class="fo-chart-cap">첫 기록을 100으로 놓고 본 증가 속도 — <span class="pw">● 당사</span> <span class="bh">● 경쟁사</span> (선이 가파를수록 빨리 늚)</div>
</div>`
    : `<div class="fo-chart-empty">추이 선은 두 번째 수집부터 그려집니다 — 지금은 기록이 한 번뿐입니다.</div>`;

  return `<div class="fo-platform">
  <h3>${escapeHtml(PLATFORM_LABEL[platform] || platform)}</h3>
  <div class="fo-cards">${cards}</div>
  ${raceLine(pw, bh)}
  ${chart}
</div>`;
}

/** 리포트 맨 위에 들어갈 팔로워 블록 전체. 기록이 없으면 빈 문자열(블록 자체가 안 나옴). */
function renderFollowerSectionHtml(history) {
  const summary = buildFollowerSummary(history);
  if (!summary) return '';

  const platforms = [...new Set(summary.groups.map(g => g.platform))];
  const blocks = platforms
    .map(p => renderPlatformBlock(p, summary.groups.filter(g => g.platform === p)))
    .filter(Boolean)
    .join('\n');
  if (!blocks) return '';

  return `<section class="follower-section">
  <div class="fo-head">
    <h2>👥 팔로워 추이</h2>
    <span class="fo-sub">기준 ${escapeHtml(shortDate(summary.takenAt))} · 기록 ${summary.snapshotCount}회 누적 — 수집할 때마다 한 줄씩 쌓입니다</span>
  </div>
  ${blocks}
</section>`;
}

const FOLLOWER_SECTION_STYLE = `
.follower-section{margin-bottom:32px}
body.view-stock .follower-section{display:none}
.fo-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.fo-sub{color:#6b7280;font-size:12px}
.fo-platform{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:14px 18px 16px;margin-bottom:12px}
.fo-platform h3{margin:0 0 10px;font-size:14px;color:#374151}
.fo-cards{display:flex;gap:12px;flex-wrap:wrap}
.fo-card{flex:1 1 240px;min-width:220px;border:1px solid #eef0f4;border-radius:10px;padding:12px 14px}
.fo-card.pw{border-left:4px solid #1971c2}
.fo-card.bh{border-left:4px solid #c0504d}
.fo-k{font-size:12px;color:#6b7280}
.fo-acc{color:#9099a6;font-size:11px}
.fo-v{font-size:24px;font-weight:700;margin:2px 0 6px;font-variant-numeric:tabular-nums}
.fo-card.pw .fo-v{color:#1971c2}
.fo-card.bh .fo-v{color:#c0504d}
.fo-approx{font-size:13px;color:#9099a6;margin-left:3px;cursor:help}
.fo-d{font-size:12px;color:#6b7280;line-height:1.7}
.fo-when{color:#9aa3b2;font-size:11px}
.fo-up{color:#2f9e44;font-weight:700}
.fo-down{color:#c0504d;font-weight:700}
.fo-flat{color:#9099a6}
.fo-race{margin-top:10px;font-size:13px;padding:7px 12px;border-radius:8px;background:#f4f6fb;color:#374151}
.fo-race.pw{background:#eef4ff;color:#1b4b9c}
.fo-race.bh{background:#fff0f0;color:#9c3b38}
.fo-chart{margin-top:12px}
.fo-chart svg{display:block;background:#fafbfd;border-radius:8px}
.fo-chart-cap{margin-top:5px;font-size:11px;color:#9099a6}
.fo-chart-cap .pw{color:#1971c2}
.fo-chart-cap .bh{color:#c0504d}
.fo-chart-empty{margin-top:10px;font-size:12px;color:#9099a6}
`;

module.exports = { buildFollowerSummary, renderFollowerSectionHtml, FOLLOWER_SECTION_STYLE };
