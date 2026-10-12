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
// 네이버는 팔로워가 아니라 관심고객수(브랜드스토어는 '알림받기' 수)다. 이름이 다르니
// 화면에도 다르게 적는다 — 같은 '팔로워'로 뭉뚱그리면 보는 사람이 다른 수치로 착각한다.
const PLATFORM_LABEL = { twitter: 'X (트위터)', instagram: '인스타그램', naver: '네이버 스토어' };
const PLATFORM_ORDER = ['twitter', 'instagram', 'naver'];
// 칸이 좁아서 'X (트위터)' 같은 긴 이름은 안 들어간다 — 줄여 쓴다.
const PLATFORM_SHORT = { twitter: 'X', instagram: '인스타', naver: '네이버' };

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
      if (a.label) g.label = a.label;   // '관심고객수'인지 '알림받기'인지
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
/**
 * 한 플랫폼에서 양사 중 누가 더 빨리 늘었는지 한 조각으로. 여러 플랫폼 것을 한 줄에 잇는다.
 *
 * 늘어난 '사람 수'가 아니라 '증가율'로 비교하는 이유 — 기반이 두 배 큰 쪽은 가만히 있어도
 * 늘어나는 사람 수가 더 많다. 절대값으로 비교하면 항상 큰 쪽이 이긴 것처럼 보인다.
 */
function racePiece(platform, pw, bh) {
  if (!pw || !bh || pw.ratePct === null || bh.ratePct === null) return '';
  const name = PLATFORM_SHORT[platform] || platform;
  const diff = pw.ratePct - bh.ratePct;
  if (Math.abs(diff) < 0.005) {
    return `<span class="fo-race even"><b>${escapeHtml(name)}</b> 양쪽 거의 같음</span>`;
  }
  const fast = diff > 0 ? '당사' : '경쟁사';
  const cls = diff > 0 ? 'pw' : 'bh';
  return `<span class="fo-race ${cls}"><b>${escapeHtml(name)}</b> ${fast} +${Math.abs(diff).toFixed(2)}%p 빠름</span>`;
}

/**
 * 칸 하나(= 한 플랫폼의 한쪽). 여섯 칸이 한 줄에 나란히 선다.
 *
 * 왜 플랫폼마다 상자를 따로 두지 않나 — 처음엔 플랫폼별로 상자를 만들고 그 안에 카드 둘,
 * 비교 줄, 큰 그래프를 넣었더니 그게 셋 반복돼 리포트 첫 화면을 통째로 먹었다. 보려던 건
 * 숫자 여섯 개인데 자리만 차지했다. 상자를 없애고 한 줄로 세우고, 그래프는 칸 안에
 * 작게 넣고, 비교 줄 셋은 아래 한 줄로 합쳤다.
 */
function renderCell(g, minIdx, maxIdx, tMin, tMax) {
  const side = g.side === 'PW' ? 'pw' : 'bh';
  const plat = PLATFORM_SHORT[g.platform] || g.platform;
  // 계정 아이디와 세는 대상 이름(관심고객수 등)은 마우스를 올리면 보이게 둔다 —
  // 줄을 하나 더 쓰면 여섯 칸이 전부 그만큼 길어져서 다시 자리를 먹는다.
  const tip = g.label ? `${g.label} (${g.account || ''})` : `@${g.account || ''}`;
  const d = sparkPath(g.points, minIdx, maxIdx, tMin, tMax, 100, 24);
  const line = d
    ? `<svg class="fo-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${side === 'pw' ? '#1971c2' : '#c0504d'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : '<div class="fo-spark-none" title="추이 선은 두 번째 수집부터 그려집니다">·</div>';

  return `<div class="fo-cell ${side}" title="${escapeHtml(tip)}">
  <div class="fo-top"><b>${escapeHtml(plat)}</b> ${SIDE_LABEL[g.side] || escapeHtml(g.side)}</div>
  <div class="fo-v">${comma(g.latest)}${g.approx ? '<span class="fo-approx" title="화면에 줄여서 표시된 숫자(2.3만 등)를 되돌린 값이라 실제와 차이가 날 수 있습니다.">≈</span>' : ''}</div>
  <div class="fo-d">${g.deltaPrev === null && g.measured === 1
    ? '<span class="fo-flat">첫 기록</span>'
    : deltaHtml(g.deltaPrev) + (g.ratePct === null ? '' : `<span class="fo-rate"> · ${ratePctHtml(g.ratePct)}</span>`)}</div>
  ${line}
</div>`;
}

/** 리포트 맨 위에 들어갈 팔로워 블록 전체. 기록이 없으면 빈 문자열(블록 자체가 안 나옴). */
function renderFollowerSectionHtml(history) {
  const summary = buildFollowerSummary(history);
  if (!summary) return '';

  const seen = [...new Set(summary.groups.map(g => g.platform))];
  const platforms = [...PLATFORM_ORDER.filter(p => seen.includes(p)),
    ...seen.filter(p => !PLATFORM_ORDER.includes(p))];

  const cells = [];
  const races = [];
  platforms.forEach(platform => {
    const groups = summary.groups.filter(g => g.platform === platform);
    const pw = groups.find(g => g.side === 'PW');
    const bh = groups.find(g => g.side === 'BH');
    const sides = [pw, bh].filter(Boolean);
    if (sides.length === 0) return;

    // 추이 선은 '첫 기록=100' 지수로 그린다. 16만과 8만을 같은 자에 그대로 올리면 둘 다
    // 평평한 직선이 돼서 정작 보려던 기울기 차이가 안 보인다. 자(최솟값·최댓값·기간)는
    // 같은 플랫폼의 양쪽이 공유해야 두 칸을 나란히 놓고 비교할 수 있다.
    const indices = sides.flatMap(g => {
      const real = g.points.filter(p => typeof p.count === 'number');
      if (real.length < 2) return [];
      const base = real[0].count || 1;
      return real.map(p => (p.count / base) * 100);
    });
    const pad = 0.15;
    const minIdx = indices.length ? Math.min(...indices) - pad : 100;
    const maxIdx = indices.length ? Math.max(...indices) + pad : 100;
    const times = sides.flatMap(g => g.points.filter(p => typeof p.count === 'number'))
      .map(p => new Date(p.takenAt).getTime()).filter(t => !Number.isNaN(t));
    const tMin = times.length ? Math.min(...times) : 0;
    const tMax = times.length ? Math.max(...times) : 1;

    sides.forEach(g => cells.push(renderCell(g, minIdx, maxIdx, tMin, tMax)));
    const piece = racePiece(platform, pw, bh);
    if (piece) races.push(piece);
  });

  if (cells.length === 0) return '';

  // 네이버만 세는 대상이 팔로워가 아니다. 칸 안에 매번 적으면 여섯 칸이 다 길어져서,
  // 아래에 한 번만 적어둔다 — 다른 수치로 착각하는 것만 막으면 된다.
  const hasNaver = platforms.includes('naver');
  const hasLine = cells.some(c => c.includes('<path'));
  const notes = [
    hasNaver ? '네이버는 팔로워가 아니라 <b>관심고객수</b>입니다.' : '',
    hasLine
      ? '숫자 아래 선은 첫 기록을 100으로 놓고 본 증가 속도입니다.'
      : '추이 선은 두 번째 수집부터 그려집니다 — 지금은 기록이 한 번뿐입니다.',
  ].filter(Boolean).join(' ');
  const foot = [
    races.length ? `<div class="fo-races">${races.join('')}</div>` : '',
    notes ? `<div class="fo-note">${notes}</div>` : '',
  ].filter(Boolean).join('\n  ');

  return `<section class="follower-section">
  <div class="fo-head">
    <h2>👥 팔로워 · 관심고객 추이</h2>
    <span class="fo-sub">기준 ${escapeHtml(shortDate(summary.takenAt))} · 기록 ${summary.snapshotCount}회 누적 — 수집할 때마다 한 줄씩 쌓입니다</span>
  </div>
  <div class="fo-box">
    <div class="fo-grid">${cells.join('\n')}</div>
    ${foot}
  </div>
</section>`;
}

const FOLLOWER_SECTION_STYLE = `
.follower-section{margin-bottom:24px}
body.view-stock .follower-section{display:none}
.fo-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.fo-sub{color:#6b7280;font-size:12px}
.fo-box{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:12px 14px 13px}
/* 여섯 칸을 한 줄에. 좁은 화면에서는 저절로 3칸씩 두 줄로 접힌다 — 한 칸이 130px보다
   좁아지면 숫자가 줄바꿈돼서 오히려 더 길어진다. */
.fo-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.fo-cell{border:1px solid #eef0f4;border-radius:9px;padding:8px 10px 6px;min-width:0}
.fo-cell.pw{border-left:3px solid #1971c2}
.fo-cell.bh{border-left:3px solid #c0504d}
.fo-top{font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fo-top b{color:#374151}
.fo-v{font-size:19px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums;white-space:nowrap}
.fo-cell.pw .fo-v{color:#1971c2}
.fo-cell.bh .fo-v{color:#c0504d}
.fo-approx{font-size:11px;color:#9099a6;margin-left:2px;cursor:help}
.fo-d{font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fo-rate{color:#9099a6}
.fo-up{color:#2f9e44;font-weight:700}
.fo-down{color:#c0504d;font-weight:700}
.fo-flat{color:#9099a6}
.fo-spark{display:block;width:100%;height:24px;margin-top:4px}
.fo-spark-none{height:24px;margin-top:4px;color:#dfe3ea;font-size:11px;text-align:center;line-height:24px;cursor:help}
.fo-races{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.fo-race{font-size:12px;padding:4px 10px;border-radius:7px;background:#f4f6fb;color:#374151}
.fo-race.pw{background:#eef4ff;color:#1b4b9c}
.fo-race.bh{background:#fff0f0;color:#9c3b38}
.fo-note{margin-top:7px;font-size:11px;color:#9099a6}
@media (max-width:900px){.fo-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:520px){.fo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

module.exports = { buildFollowerSummary, renderFollowerSectionHtml, FOLLOWER_SECTION_STYLE };
