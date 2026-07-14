// ============================================================
// GRID DETECTION — reference/grid-detect.js를 브라우저 전역 스크립트로 포팅.
// 알고리즘/수치는 원본 그대로 유지 (white 임계값 240, photo run 150~200px,
// col run 90px, sampleCols 좌표, cardW/cardH 176 등).
//
// 원본 소스 이미지는 보통 1000px 폭, 5열 그리드. 행 간격(row pitch)은
// 이미지 내에서 불규칙할 수 있어 절대 고정 피치로 계산하지 않고 매번 픽셀 스캔한다.
// ============================================================

function detectRowTops(ctx, x, imgHeight, scale = 1) {
  const col = ctx.getImageData(x, 0, 1, imgHeight).data;
  const tops = [];
  const heights = [];
  let runStart = -1;
  for (let y = 0; y < imgHeight; y++) {
    const r = col[y * 4], g = col[y * 4 + 1], b = col[y * 4 + 2];
    const isWhite = r > 240 && g > 240 && b > 240;
    if (!isWhite && runStart < 0) {
      runStart = y;
    } else if (isWhite && runStart >= 0) {
      const runLen = y - runStart;
      // photo cells are roughly 170-200px tall at the 1000px-wide baseline — scaled
      // proportionally below for captures that aren't 1000px wide (reject shorter
      // (text lines) or longer (merged) runs relative to that baseline). The actual
      // measured runLen of each accepted run becomes a cardH sample below — real
      // screenshots aren't always a clean linear rescale of the 1000px reference, so
      // the crop size has to come from what's actually on the page, not from scale alone.
      if (runLen > 150 * scale && runLen < 200 * scale) {
        tops.push(runStart);
        heights.push(runLen);
      }
      runStart = -1;
    }
  }
  return { tops, heights };
}

function detectColStarts(ctx, y, imgWidth, scale = 1) {
  const row = ctx.getImageData(0, y, imgWidth, 1).data;
  const cols = [];
  const widths = [];
  let runStart = -1;
  for (let x = 0; x < imgWidth; x++) {
    const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
    const isWhite = r > 240 && g > 240 && b > 240;
    if (!isWhite && runStart < 0) {
      runStart = x;
    } else if (isWhite && runStart >= 0) {
      const runLen = x - runStart;
      // upper bound rejects runs where two adjacent cards' non-white pixels merged
      // into one (no white gutter between them at this particular y) — a real single
      // card is never wider than ~1.5x the 1000px-baseline card width.
      if (runLen > 90 * scale && runLen < 260 * scale) {
        cols.push(runStart);
        widths.push(runLen);
      }
      runStart = -1;
    }
  }
  return { cols, widths };
}

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
function detectGrid(img) {
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

  const rowSets = sampleCols.map((x) => detectRowTops(ctx, x, img.height, scale));
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
  let colStarts = [];
  let colWidths = [];
  if (rows.length) {
    const rowsToTry = rows.slice(0, Math.min(rows.length, 5));
    const offsetsToTry = [40, 80, 120, 20].map((o) => Math.round(o * scale));
    for (const rowY of rowsToTry) {
      for (const offset of offsetsToTry) {
        const attempt = detectColStarts(ctx, rowY + offset, img.width, scale);
        if (attempt.cols.length > colStarts.length) {
          colStarts = attempt.cols;
          colWidths = attempt.widths;
        }
      }
    }
  }
  const cardW = median(colWidths) || fallbackCardW;

  return { cols: colStarts, rows, cardW, cardH };
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
  window.GridDetect = { detectRowTops, detectColStarts, detectGrid, cropCell };
}
