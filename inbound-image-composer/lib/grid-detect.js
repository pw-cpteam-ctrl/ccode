// ============================================================
// GRID DETECTION — reference/grid-detect.js를 브라우저 전역 스크립트로 포팅.
// 알고리즘/수치는 원본 그대로 유지 (white 임계값 240, photo run 150~200px,
// col run 90px, sampleCols 좌표, cardW/cardH 176 등).
//
// 원본 소스 이미지는 보통 1000px 폭, 5열 그리드. 행 간격(row pitch)은
// 이미지 내에서 불규칙할 수 있어 절대 고정 피치로 계산하지 않고 매번 픽셀 스캔한다.
//
// minGapPx: 흰 픽셀을 몇 픽셀 연속으로 봐야 "진짜 칸 사이 여백(거터)"으로 인정할지.
// 원래는 흰 픽셀 딱 1개만 봐도 그 자리에서 칸을 끊었는데, 실제 상품 사진 중에는
// 한 칸 안에 캐릭터 여러 명을 늘어놓은 콜라주형 이미지(예: "RICH BOX 5종 세트")가 있고,
// 이런 사진은 캐릭터와 캐릭터 사이에 좁게 흰 배경이 비치는 경우가 흔하다. 그 좁은
// 틈까지 진짜 칸 경계로 오인하면 사진 한 장이 두 칸으로 쪼개져 잡힌다(실사용 중 발견 —
// 부시로드 스토어의 "조조의기묘한모험 컬렉션" 사진에서 재현). 진짜 칸 사이 여백은
// 이 틈보다 훨씬 넓으므로, 흰 구간이 최소 길이(minGapPx) 이상 이어질 때만 칸 경계로
// 인정하도록 해서 카드 내부의 짧은 흰 틈은 무시한다.
// ============================================================

function detectRowTops(ctx, x, imgHeight, scale = 1, params = {}) {
  const whiteThreshold = params.whiteThreshold ?? 240;
  const [runMin, runMax] = params.rowRunBounds ?? [150, 200];
  const minGap = Math.max(1, Math.round((params.minGapPx ?? 8) * scale));
  const col = ctx.getImageData(x, 0, 1, imgHeight).data;
  const tops = [];
  const heights = [];
  let runStart = -1;
  let lastNonWhite = -1;
  let whiteStreak = 0;

  const closeRun = (endExclusive) => {
    const runLen = endExclusive - runStart;
    // photo cells are roughly 170-200px tall at the 1000px-wide baseline — scaled
    // proportionally below for captures that aren't 1000px wide (reject shorter
    // (text lines) or longer (merged) runs relative to that baseline). The actual
    // measured runLen of each accepted run becomes a cardH sample below — real
    // screenshots aren't always a clean linear rescale of the 1000px reference, so
    // the crop size has to come from what's actually on the page, not from scale alone.
    if (runLen > runMin * scale && runLen < runMax * scale) {
      tops.push(runStart);
      heights.push(runLen);
    }
    runStart = -1;
  };

  for (let y = 0; y < imgHeight; y++) {
    const r = col[y * 4], g = col[y * 4 + 1], b = col[y * 4 + 2];
    const isWhite = r > whiteThreshold && g > whiteThreshold && b > whiteThreshold;
    if (!isWhite) {
      if (runStart < 0) runStart = y;
      lastNonWhite = y;
      whiteStreak = 0;
    } else if (runStart >= 0) {
      whiteStreak++;
      if (whiteStreak >= minGap) closeRun(lastNonWhite + 1);
    }
  }
  if (runStart >= 0) closeRun(lastNonWhite + 1);

  return { tops, heights };
}

function detectColStarts(ctx, y, imgWidth, scale = 1, params = {}) {
  const whiteThreshold = params.whiteThreshold ?? 240;
  const [runMin, runMax] = params.colRunBounds ?? [90, 260];
  const minGap = Math.max(1, Math.round((params.minGapPx ?? 8) * scale));
  const row = ctx.getImageData(0, y, imgWidth, 1).data;
  const cols = [];
  const widths = [];
  let runStart = -1;
  let lastNonWhite = -1;
  let whiteStreak = 0;

  const closeRun = (endExclusive) => {
    const runLen = endExclusive - runStart;
    // upper bound rejects runs where two adjacent cards' non-white pixels merged
    // into one (no white gutter between them at this particular y) — a real single
    // card is never wider than ~1.5x the 1000px-baseline card width.
    if (runLen > runMin * scale && runLen < runMax * scale) {
      cols.push(runStart);
      widths.push(runLen);
    }
    runStart = -1;
  };

  for (let x = 0; x < imgWidth; x++) {
    const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
    const isWhite = r > whiteThreshold && g > whiteThreshold && b > whiteThreshold;
    if (!isWhite) {
      if (runStart < 0) runStart = x;
      lastNonWhite = x;
      whiteStreak = 0;
    } else if (runStart >= 0) {
      whiteStreak++;
      if (whiteStreak >= minGap) closeRun(lastNonWhite + 1);
    }
  }
  if (runStart >= 0) closeRun(lastNonWhite + 1);

  return { cols, widths };
}

// "다시 검출"이 의미를 가지려면 같은 이미지를 다시 넣었을 때 전과 다른 시도를 해봐야 한다
// — detectGrid가 순수하게 픽셀만 보는 결정론적 함수라서, 예전엔 몇 번을 다시 눌러도
// 정확히 똑같은 결과만 나오는 게 당연했다(사용자가 "이 버튼 대체 무슨 의미냐"고 지적한
// 지점). 아래 3가지 변형(흰색 판정 임계값, 사진 한 칸으로 인정하는 세로/가로 길이 범위,
// 최소 여백 길이)을 순환하면서 시도해, 기본값이 안 맞는 이미지(배경이 살짝 회색빛이거나
// 카드 비율이 다른 경우 등)에서 재검출을 누를 때마다 실제로 다른 결과를 시도해볼 수 있게 한다.
const DETECT_VARIANTS = [
  { whiteThreshold: 240, rowRunBounds: [150, 200], colRunBounds: [90, 260], minGapPx: 8 }, // 기본값
  { whiteThreshold: 225, rowRunBounds: [130, 220], colRunBounds: [80, 280], minGapPx: 10 }, // 배경이 살짝 회색빛인 경우
  { whiteThreshold: 248, rowRunBounds: [155, 195], colRunBounds: [95, 240], minGapPx: 14 }, // 더 엄격하게(카드 내부 흰 틈에 더 안 흔들림)
];

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// IMPORTANT (learned the hard way): sample MULTIPLE x columns when detecting row
// tops — different columns in the same row can report slightly different y starts
// (±1-2px) due to anti-aliasing. Cross-check at least 3 columns and use the most
// common (here: longest) value-set, then visually verify with a debug overlay
// before trusting the grid for a full 30-80 item crop run.
function detectGrid(img, variant = 0) {
  const params = DETECT_VARIANTS[variant % DETECT_VARIANTS.length];
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // 모든 좌표/임계값은 "1000px 폭, 5열" 기준으로 실측된 값이다. 캡처 폭이 1000이
  // 아니면(다른 줌 배율 등) 이 절대 좌표가 전혀 엉뚱한 위치를 가리켜서 그리드를 아예
  // 못 잡는 버그가 있었다 — img.width 기준 비율로 스케일링해서 해결한다.
  const scale = img.width / 1000;
  const sampleColsBase = [117, 304, 490, 677, 864]; // rough center-of-column x guesses for a 1000px-wide, 5-col sheet
  const sampleCols = sampleColsBase.map((x) => Math.round(x * scale));
  const fallbackCardW = Math.round(176 * scale);
  const fallbackCardH = Math.round(176 * scale);

  const rowSets = sampleCols.map((x) => detectRowTops(ctx, x, img.height, scale, params));
  const bestRowSet = rowSets.reduce((a, b) => (b.tops.length > a.tops.length ? b : a));
  const rows = bestRowSet.tops;
  // 카드 크기(cardW/cardH)를 "이미지 폭 비율로 176px를 스케일링한 값"으로만 추정했었는데,
  // 실제 캡처는 전체 이미지 폭에 정비례해서 커진 게 아니라 여백/줌 배율이 제각각이라
  // 이 추정치가 실제 카드 크기와 어긋나는 경우가 있었다(1404px, 2160px 폭 캡처에서
  // 그리드 박스가 사진 경계와 안 맞고 옆 칸을 침범하는 원인). 지금은 실제로 스캔해서
  // 찾아낸 픽셀 런(run) 길이의 중앙값을 카드 크기로 쓴다 — 스케일 추정치는 측정값이
  // 하나도 안 잡혔을 때만 쓰는 최후 대안이다.
  const cardH = median(bestRowSet.heights) || fallbackCardH;

  // 열 탐지는 딱 한 줄(rows[0]+40)만 샘플링했었는데, 하필 그 세로 위치에서 특정 상품
  // 사진(예: 배경이 흰 편인 아이콘/스티커류)이 흰색에 가까우면 그 열 전체가 통째로
  // 누락되는 문제가 실사용 중 발견됐다(5열인데 4열로 검출). 행 탐지처럼 여러 지점을
  // 교차 검사해서 가장 많은 열이 잡힌 결과를 채택한다 — 앞쪽 몇 개 행에서 각각 시도해보고
  // (한 상품이 흰 편이어도 다른 행의 같은 열은 사진이 다르니 잡힐 가능성이 높다),
  // 그래도 안 되면 같은 행 안에서 세로 위치를 조금씩 바꿔가며 추가로 시도한다.
  const offsetsToTry = [40, 80, 120, 20].map((o) => Math.round(o * scale));
  function bestColsNear(rowY) {
    let best = { cols: [], widths: [] };
    for (const offset of offsetsToTry) {
      const attempt = detectColStarts(ctx, rowY + offset, img.width, scale, params);
      if (attempt.cols.length > best.cols.length) best = attempt;
    }
    return best;
  }

  let colStarts = [];
  let colWidths = [];
  if (rows.length) {
    rows.slice(0, Math.min(rows.length, 5)).forEach((rowY) => {
      const attempt = bestColsNear(rowY);
      if (attempt.cols.length > colStarts.length) {
        colStarts = attempt.cols;
        colWidths = attempt.widths;
      }
    });
  }
  const cardW = median(colWidths) || fallbackCardW;

  // 열 x좌표를 한 줄에서만 뽑아 모든 행에 그대로 재사용했더니, 실제 스토어 페이지처럼
  // 행마다 카드 좌측 여백이 몇 px씩 미묘하게 달라지는 캡처에서는 그 한 줄이 아닌 다른
  // 행들의 크롭이 옆으로 밀려 나왔다(사진 한쪽이 잘리고 반대쪽엔 흰 틈/옆 칸이 살짝
  // 끼어드는 형태 — "다시 검출"을 눌러도 매번 이 재사용 구조 자체는 그대로라 똑같이
  // 재현됐다). 그래서 행마다 그 행 근처에서 다시 열을 검출해 각 행 고유의 x좌표를
  // 쓴다. 단, 그 행에서 검출된 열 개수가 기준 개수와 다르면(그 행의 특정 칸이
  // 흰 편이라 덜 잡히는 경우 등) 신뢰할 수 없으므로 공통 좌표로 되돌아간다.
  const colsByRow = rows.map((rowY) => {
    const attempt = bestColsNear(rowY);
    return attempt.cols.length === colStarts.length ? attempt.cols : colStarts;
  });

  return { cols: colStarts, colsByRow, rows, cardW, cardH };
}

// ============================================================
// CROPPING — cut each cell to its own canvas at native resolution
// (no upscale/downscale) so quality never degrades.
// ============================================================
function cropCell(img, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return c;
}

if (typeof window !== 'undefined') {
  window.GridDetect = { detectRowTops, detectColStarts, detectGrid, cropCell, DETECT_VARIANTS };
}
