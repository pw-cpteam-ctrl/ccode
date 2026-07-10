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

// Draws a rounded-rect "sticker" badge (used for 룩업/테노히라/메가캣/홀로라이브
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

/**
 * Draws one product card (photo + ip name + tag badge + price + shipping) with
 * its top-left corner at (cx, cy). Shared by renderPage() and renderContinuousStrip()
 * so the preview and the final export are pixel-identical.
 */
function drawCard(ctx, item, cx, cy) {
  const { photo, colGap, photoToText, ipSize, priceSize, shipSize, tagSize } = LAYOUT;
  const { photo: photoImg, ip, price, ship, tag } = item;

  if (photoImg) ctx.drawImage(photoImg, cx, cy, photo, photo);

  ctx.textBaseline = 'alphabetic';
  const ipY = cy + photo + photoToText + ipSize - 4;

  // reserve horizontal space for the tag badge before sizing the IP text
  let reserve = 0;
  if (tag) {
    ctx.font = `700 ${tagSize}px ${FONT}`;
    reserve = ctx.measureText(tag).width + 14;
  }
  const fs = fitFont(ctx, ip || '', photo - 2 - reserve, ipSize, 15);
  ctx.fillStyle = '#1b1b1f';
  ctx.font = `800 ${fs}px ${FONT}`;
  ctx.fillText(ip || '', cx + 2, ipY);

  if (tag) {
    const ipWidth = ctx.measureText(ip || '').width;
    drawTagBadge(ctx, cx + 2 + ipWidth + 5, ipY, tag, tagSize);
  }

  const priceY = ipY + 9 + priceSize;
  ctx.fillStyle = '#3b3b3b';
  ctx.font = `500 ${priceSize}px ${FONT}`; // NOTE: price must always render SMALLER + LIGHTER than ip name
  ctx.fillText(price || '', cx + 2, priceY);

  const shipY = priceY + 7 + shipSize;
  drawCartIcon(ctx, cx + 2, shipY - 12, '#a8adb4');
  ctx.fillStyle = '#9aa0a8';
  ctx.font = `500 ${shipSize}px ${FONT}`;
  ctx.fillText(ship || '', cx + 22, shipY);
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

  const { cols = 5, rows = 4, pageW = 1080, pageH = 1350, scale = 2 } = options;

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
  const padTop = Math.round((pageH - headerH - usedRows * cardBlock - (usedRows - 1) * rowGap) / 2);

  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const cx = padX + c * (photo + colGap);
    const cy = headerH + padTop + r * (cardBlock + rowGap);
    drawCard(ctx, items[i], cx, cy);
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
  const { cols = 5, pageW = 1080, scale = 2, padTop = 24, padBottom = 24 } = options;

  const { photo, colGap, padX, cardBlock, rowGap } = LAYOUT;
  const usedRows = Math.ceil(items.length / cols) || 1;
  const height = padTop + usedRows * cardBlock + (usedRows - 1) * rowGap + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = pageW * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageW, height);

  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const cx = padX + c * (photo + colGap);
    const cy = padTop + r * (cardBlock + rowGap);
    drawCard(ctx, items[i], cx, cy);
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
    LAYOUT,
  };
}
