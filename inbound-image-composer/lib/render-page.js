// ============================================================
// PAGE RENDERER — reference/render-page.js를 브라우저 전역 스크립트로 포팅.
// 폰트 크기/색상/레이아웃 계산식은 원본 그대로 유지.
//
// renderPage()는 4:5(1080x1350) 최종 페이지 전용(6단계에서만 사용).
// 3단계 "분할 전 전체 미리보기"는 페이지 높이 제약이 없는 긴 스트립이 필요해서
// 카드 1개를 그리는 drawCard()를 공용으로 뽑아 renderContinuousStrip()에서 재사용한다
// (레이아웃 상수·폰트 계산식은 renderPage와 완전히 동일 — 미리보기와 최종 결과물이
// 다르게 보이면 안 되기 때문).
// ============================================================

const FONT = '"Paperlogy","Apple SD Gothic Neo",sans-serif';

// Load a Google Font before rendering to canvas — canvas text silently falls back
// to a system font if the webfont isn't ready yet, so always await a short delay +
// document.fonts.ready (with a timeout fallback; font loading over network can hang).
async function ensureFontsLoaded() {
  if (!document.getElementById('paperlogy-font-link')) {
    const link = document.createElement('link');
    link.id = 'paperlogy-font-link';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Paperlogy:wght@500;700;800&display=swap';
    document.head.appendChild(link);
  }
  await new Promise((r) => setTimeout(r, 700));
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]);
  } catch (e) {
    /* proceed anyway with fallback font */
  }
}

function drawCartIcon(ctx, x, y, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 2, y);
  ctx.lineTo(x + 4, y + 9);
  ctx.lineTo(x + 13, y + 9);
  ctx.lineTo(x + 14.5, y + 2.5);
  ctx.lineTo(x + 4.5, y + 2.5);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 6, y + 12.5, 1.3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 11.5, y + 12.5, 1.3, 0, 7); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Shrinks the IP-name font size until it fits maxWidth (never below `min`px) —
// long IP names would otherwise overflow into the neighboring card.
function fitFont(ctx, text, maxWidth, base, min) {
  let size = base;
  ctx.font = `800 ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 1;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  return size;
}

// Draws a rounded-rect "sticker" badge (used for 테노히라/메가캣/GEM/홀로라이브
// lineup tags) at (x, baselineY).
function drawTagBadge(ctx, x, baselineY, text, tagSize = 13) {
  const pad = 5;
  const h = tagSize + 5;
  ctx.font = `700 ${tagSize}px ${FONT}`;
  const w = ctx.measureText(text).width + pad * 2;
  ctx.fillStyle = '#2f7bff';
  roundRect(ctx, x, baselineY - tagSize - 1, w, h, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x + pad, baselineY);
  return w + 4; // width consumed, for layout chaining
}

// ---- shared layout constants (tuned for 1080x1350 / 5 cols) ----
const LAYOUT = {
  photo: 176, colGap: 20, padX: 60, photoToText: 8,
  ipSize: 25, priceSize: 17, shipSize: 15, tagSize: 13,
  rowGap: 18,
};
LAYOUT.textH = LAYOUT.ipSize + 9 + LAYOUT.priceSize + 7 + LAYOUT.shipSize;
LAYOUT.cardBlock = LAYOUT.photo + LAYOUT.photoToText + LAYOUT.textH;

// IP명이 너무 길어서 한 줄에 우겨넣으면 이 크기 밑으로 줄여야 하는 경우, 억지로 작게
// 만들지 않고 2줄로 나눠서 IP_TWO_LINE_SIZE(1줄 최소값 15px보다 크고 기본 25px보다는
// 작은 절충값)로 보여준다. 2줄이 된 카드가 있는 행은 그만큼 행 높이가 늘어나야 다음
// 행과 안 겹친다 — 이 계산은 rowExtraHeight()가 한다.
const IP_TWO_LINE_THRESHOLD = 18;
const IP_TWO_LINE_SIZE = 20;

// 특정 IP명이 photo 폭 안에 1줄로 들어갈지, 2줄로 나눠야 할지 미리 계산만 한다(그리지
// 않음) — 실제 그리기(drawCard)와 행 높이 계산(rowExtraHeight) 양쪽에서 공용으로 쓴다.
function ipTextPlan(ctx, item) {
  const { photo, tagSize, ipSize } = LAYOUT;
  const ip = item.ip || '';
  let reserve = 0;
  if (item.tag) {
    ctx.font = `700 ${tagSize}px ${FONT}`;
    reserve = ctx.measureText(item.tag).width + 14;
  }
  const maxWidth = photo - 2 - reserve;
  const oneLineSize = fitFont(ctx, ip, maxWidth, ipSize, 15);
  if (!ip || oneLineSize >= IP_TWO_LINE_THRESHOLD) return { lines: [ip], size: oneLineSize };

  // 1줄로는 너무 작아지는 경우 → 2줄로 나눠서 더 큰 글자로 보여준다. 띄어쓰기 기준이
  // 아니라 글자 단위로 자르는 이유: 한글 IP명은 공백이 없거나 애매한 경우가 많아서,
  // "폭에 맞는 최대 글자수까지" 자르는 방식이 더 안전하다.
  ctx.font = `800 ${IP_TWO_LINE_SIZE}px ${FONT}`;
  let splitAt = ip.length;
  while (splitAt > 1 && ctx.measureText(ip.slice(0, splitAt)).width > maxWidth) splitAt--;
  return { lines: [ip.slice(0, splitAt), ip.slice(splitAt)], size: IP_TWO_LINE_SIZE };
}

// 한 행(row)에 속한 카드들 중 하나라도 IP명이 2줄로 넘어가면, 그 행 전체 높이를
// 한 줄만큼 더 늘려야 한다 — measureCtx는 실제로 그릴 캔버스가 아니어도 되고
// measureText만 정확하면 된다(폰트가 로드된 뒤라면 임시 캔버스로도 충분).
function rowExtraHeight(measureCtx, rowItems) {
  const needsTwoLines = rowItems.some((it) => ipTextPlan(measureCtx, it).lines.length === 2);
  return needsTwoLines ? IP_TWO_LINE_SIZE + 4 : 0;
}

/**
 * Draws one product card (photo + ip name + tag badge + price + shipping) with
 * its top-left corner at (cx, cy). Shared by renderPage() and renderContinuousStrip()
 * so the preview and the final export are pixel-identical.
 *
 * showShipping=false는 항목 데이터(ship)는 그대로 두고 배송비 줄(아이콘+글자)만 안
 * 그린다 — 이 줄 아래에 다른 카드/텍스트가 없어서(카드 블록 높이는 LAYOUT.cardBlock으로
 * 항상 고정) 꺼도 위쪽 IP명/가격 위치나 다음 줄 카드 위치는 전혀 안 밀린다.
 */
function drawCard(ctx, item, cx, cy, showShipping = true) {
  const { photo, photoToText, priceSize, shipSize, tagSize } = LAYOUT;
  const { photo: photoImg, price, ship, tag } = item;

  if (photoImg) ctx.drawImage(photoImg, cx, cy, photo, photo);

  ctx.textBaseline = 'alphabetic';
  const plan = ipTextPlan(ctx, item);
  const ipY = cy + photo + photoToText + plan.size - 4;

  ctx.fillStyle = '#1b1b1f';
  ctx.font = `800 ${plan.size}px ${FONT}`;
  ctx.fillText(plan.lines[0], cx + 2, ipY);
  let lastIpLineY = ipY;
  if (plan.lines.length === 2) {
    lastIpLineY = ipY + plan.size + 4;
    ctx.fillText(plan.lines[1], cx + 2, lastIpLineY);
  }

  if (tag) {
    // ctx.font는 fillText 이후에도 그대로 IP명 폰트라 line1 폭을 그대로 재측정할 수 있다.
    const line1Width = ctx.measureText(plan.lines[0]).width;
    drawTagBadge(ctx, cx + 2 + line1Width + 5, ipY, tag, tagSize);
  }

  const priceY = lastIpLineY + 9 + priceSize;
  ctx.fillStyle = '#3b3b3b';
  ctx.font = `500 ${priceSize}px ${FONT}`; // NOTE: price must always render SMALLER + LIGHTER than ip name
  ctx.fillText(price || '', cx + 2, priceY);

  if (showShipping) {
    const shipY = priceY + 7 + shipSize;
    drawCartIcon(ctx, cx + 2, shipY - 12, '#a8adb4');
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `500 ${shipSize}px ${FONT}`;
    ctx.fillText(ship || '', cx + 22, shipY);
  }
}

/**
 * items: Array<{ photo, ip, price, ship, tag? }>
 * headerImg: HTMLImageElement | HTMLCanvasElement — cropped brand header/arch banner
 * options: { cols=5, rows=4, pageW=1080, pageH=1350, scale=2 }
 *
 * Returns a canvas ready for .toBlob({type:'image/jpeg', quality:0.94})
 */
async function renderPage(items, headerImg, options = {}) {
  await ensureFontsLoaded();

  const { cols = 5, rows = 4, pageW = 1080, pageH = 1350, scale = 2, showShipping = true } = options;

  const canvas = document.createElement('canvas');
  canvas.width = pageW * scale;
  canvas.height = pageH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageW, pageH);

  let headerH = 0;
  if (headerImg) {
    headerH = Math.round(headerImg.height * (pageW / headerImg.width));
    ctx.drawImage(headerImg, 0, 0, pageW, headerH);
  }

  const { photo, colGap, padX, cardBlock, rowGap } = LAYOUT;
  const usedRows = Math.min(rows, Math.ceil(items.length / cols));

  // IP명이 2줄로 넘어가는 카드가 있는 행은 기본 카드 높이(cardBlock)보다 실제로 더
  // 필요할 수 있어서, 행마다 실제 높이를 먼저 계산한다 — 안 그러면 다음 행 카드와 겹치거나
  // 페이지 아래쪽이 잘린다.
  const rowHeights = [];
  for (let r = 0; r < usedRows; r++) {
    const rowItems = items.slice(r * cols, r * cols + cols);
    rowHeights.push(cardBlock + rowExtraHeight(ctx, rowItems));
  }
  const totalRowsHeight = rowHeights.reduce((a, b) => a + b, 0) + (usedRows - 1) * rowGap;
  const padTop = Math.round((pageH - headerH - totalRowsHeight) / 2);

  let yCursor = headerH + padTop;
  for (let r = 0; r < usedRows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= items.length) continue;
      const cx = padX + c * (photo + colGap);
      drawCard(ctx, items[i], cx, yCursor, showShipping);
    }
    yCursor += rowHeights[r] + rowGap;
  }

  return canvas;
}

/**
 * 3단계(분할 전 전체 미리보기)용 — 페이지 높이 제약 없이 5열 그리드로 계속
 * 이어지는 긴 세로 캔버스 1장을 그린다. 카드 하나하나의 그리기는 renderPage와
 * 완전히 동일한 drawCard()를 쓰므로 최종 결과물과 시각적으로 동일하다.
 */
async function renderContinuousStrip(items, options = {}) {
  await ensureFontsLoaded();
  const { cols = 5, pageW = 1080, scale = 2, padTop = 24, padBottom = 24, showShipping = true } = options;

  const { photo, colGap, padX, cardBlock, rowGap } = LAYOUT;
  const usedRows = Math.ceil(items.length / cols) || 1;

  // 실제 출력 캔버스의 세로 길이가 행별 실제 높이(2줄 IP명 포함)에 달려있어서, 캔버스를
  // 만들기 전에 폭 측정만 가능한 임시 컨텍스트로 행 높이부터 계산한다.
  const measureCtx = document.createElement('canvas').getContext('2d');
  const rowHeights = [];
  for (let r = 0; r < usedRows; r++) {
    const rowItems = items.slice(r * cols, r * cols + cols);
    rowHeights.push(cardBlock + rowExtraHeight(measureCtx, rowItems));
  }
  const height = padTop + rowHeights.reduce((a, b) => a + b, 0) + (usedRows - 1) * rowGap + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = pageW * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageW, height);

  let yCursor = padTop;
  for (let r = 0; r < usedRows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= items.length) continue;
      const cx = padX + c * (photo + colGap);
      drawCard(ctx, items[i], cx, yCursor, showShipping);
    }
    yCursor += rowHeights[r] + rowGap;
  }

  return canvas;
}

if (typeof window !== 'undefined') {
  window.RenderPage = {
    renderPage,
    renderContinuousStrip,
    ensureFontsLoaded,
    fitFont,
    drawTagBadge,
    drawCartIcon,
    drawCard,
    ipTextPlan,
    rowExtraHeight,
    LAYOUT,
  };
}
