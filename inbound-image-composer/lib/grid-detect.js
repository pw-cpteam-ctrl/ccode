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
      // (text lines) or longer (merged) runs relative to that baseline).
      if (runLen > 150 * scale && runLen < 200 * scale) tops.push(runStart);
      runStart = -1;
    }
  }
  return tops;
}

function detectColStarts(ctx, y, imgWidth, scale = 1) {
  const row = ctx.getImageData(0, y, imgWidth, 1).data;
  const cols = [];
  let runStart = -1;
  for (let x = 0; x < imgWidth; x++) {
    const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
    const isWhite = r > 240 && g > 240 && b > 240;
    if (!isWhite && runStart < 0) {
      runStart = x;
    } else if (isWhite && runStart >= 0) {
      if (x - runStart > 90 * scale) cols.push(runStart);
      runStart = -1;
    }
  }
  return cols;
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
  const cardW = Math.round(176 * scale);
  const cardH = Math.round(176 * scale);

  const rowSets = sampleCols.map((x) => detectRowTops(ctx, x, img.height, scale));
  const rows = rowSets.reduce((a, b) => (b.length > a.length ? b : a));

  const colStarts = rows.length
    ? detectColStarts(ctx, rows[0] + Math.round(40 * scale), img.width, scale) // sample mid-photo, avoids edge artifacts
    : [];

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
