// 세로 2분할 캔버스 — 정해진 규격(기본 인스타 4:5, 1080×1350) 한 장 안에 사진을 위아래로
// 나눠 담고, 칸마다 따로 드래그=이동 / 휠=확대로 자리를 잡아 PNG로 내보내는 유틸리티.
// 외부 라이브러리 없음. (megahouse-matome의 상세컷에서 쓰는 코드를 그대로 떼어낸 것)
//
// 사진을 1장만 넣으면 그 한 장이 전체를 쓰고(단독), 2장을 넣으면 위아래로 나눠 쓴다(2분할).
// 처음 자리는 "사진 전체가 다 보이게"로 잡는다 — 꽉 채우면 가장자리(카피라이트 등)가 잘리므로.
//
// 쓰는 방법:
//   <canvas id="c" style="width:420px"></canvas>
//   <script src="/assets/split-canvas.js"></script>
//   <script>
//     const sp = createSplitCanvas(document.getElementById('c'), { gap: 40 });
//     await sp.setImages([파일1, 파일2]);   // File/Blob/URL/dataURL/<img> 무엇이든, 1~2장
//     await sp.download('01.png');
//   </script>
//
// 조작: 드래그=이동 · 휠=확대/축소 · 더블클릭=처음 자리로 (손댄 칸만 움직임)
//
// 옵션:
//   width/height  내보낼 규격. 기본 1080 × 1350
//   gap           2분할일 때 위아래 사이 여백(px). 기본 40
//   backdrop      남는 자리 색. 기본 '#ffffff'
//   maxZoom       최대 확대 배수. 기본 4
//   interactive   드래그·휠 연결. 기본 true (썸네일처럼 보기만 할 땐 false)
//   onChange      자리가 바뀔 때마다 호출 — 썸네일 다시 그리기·저장 등에 씀

// ─────────────────────────────────────────────────────────────────────────────
// 순수 계산·그리기 (캔버스에 붙지 않는 부분)
//
// 아래 네 개는 createSplitCanvas 안에서 쓰던 식을 밖으로 꺼낸 것이다.
// 꺼낸 이유: 썸네일을 수백 개 그리는 도구는 아트보드마다 createSplitCanvas를 만들 수 없다
// (1080×1350 캔버스가 그 수만큼 생겨 메모리가 버티지 못한다). 그래서 조작은 큰 화면에서
// 인스턴스 하나로 하고, 목록·내보내기는 저장해둔 자리값(crops)으로 여기 있는 그리기 함수를
// 직접 부른다. 계산식을 한 곳에 두어야 큰 화면과 썸네일이 서로 어긋나지 않는다.
// createSplitCanvas도 같은 함수를 쓰므로 기존 동작은 그대로다.

// 배율을 그대로 쓰면 반올림 때문에 가장자리에 배경이 실선처럼 비칠 때가 있어 0.3% 크게 그린다
var SPLIT_SLOP = 1.003;

/* 사진이 들어갈 자리 — 1장이면 한 칸, 2장이면 위아래 두 칸 */
function splitSlots(W, H, gap, count) {
  if (count <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  const h = (H - gap) / 2;
  return [{ x: 0, y: 0, w: W, h }, { x: 0, y: H - h, w: W, h }];
}
/* 꽉 채우기 기준 위치·크기 */
function splitCoverRect(pw, ph, w, h, fx, fy, zoom) {
  const eff = Math.max(w / pw, h / ph) * SPLIT_SLOP * zoom;
  const dw = pw * eff, dh = ph * eff;
  return { dw, dh, dx: -(dw - w) * fx, dy: -(dh - h) * fy };
}
/* 사진 전체가 다 보이는 배율 (여백이 생김) */
function splitContainZoom(pw, ph, w, h) {
  return Math.min(w / pw, h / ph) / (Math.max(w / pw, h / ph) * SPLIT_SLOP);
}
/* 처음 자리 — 전체가 보이게. 꽉 채우면 가장자리(카피라이트 등)가 잘리므로 */
function splitDefaultCrops(imgs, W, H, gap) {
  return splitSlots(W, H, gap, imgs.length).map((sl, i) => {
    const im = imgs[i];
    if (!im) return { fx: .5, fy: .5, zoom: 1 };
    const pw = im.naturalWidth || im.width, ph = im.naturalHeight || im.height;
    return { fx: .5, fy: .5, zoom: splitContainZoom(pw, ph, sl.w, sl.h) };
  });
}
/* 어느 캔버스에든 같은 그림을 그린다 (큰 화면·썸네일·내보내기 공용).
   기본은 "이 캔버스는 내가 다 쓴다" — 좌표를 초기화하고 캔버스 크기(cw×ch)에 맞춰 그린다.
   opt.keepTransform을 켜면 부르는 쪽이 이미 걸어둔 축소 배율을 그대로 두고 규격(W×H)
   좌표로만 그린다. 썸네일을 수백 개 그리는 도구처럼, 한 캔버스에 이 그림 위에 다른 것을
   더 얹는 경우에 쓴다 (초기화해버리면 그림이 캔버스 밖으로 나가고 뒤에 얹는 것과도 어긋난다) */
function drawSplitTo(ctx, cw, ch, imgs, crops, opt) {
  opt = opt || {};
  const W = opt.width || 1080, H = opt.height || 1350;
  const gap = opt.gap != null ? opt.gap : 40;
  const backdrop = opt.backdrop || '#ffffff';
  ctx.save();
  if (!opt.keepTransform) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.scale(cw / W, ch / H);
  }
  ctx.fillStyle = backdrop; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  splitSlots(W, H, gap, imgs.length).forEach((sl, i) => {
    const im = imgs[i]; if (!im) return;
    const cr = (crops && crops[i]) || { fx: .5, fy: .5, zoom: 1 };
    const pw = im.naturalWidth || im.width, ph = im.naturalHeight || im.height;
    ctx.save();
    ctx.beginPath(); ctx.rect(sl.x, sl.y, sl.w, sl.h); ctx.clip();
    ctx.translate(sl.x, sl.y);
    ctx.fillStyle = backdrop; ctx.fillRect(0, 0, sl.w, sl.h);
    const r = splitCoverRect(pw, ph, sl.w, sl.h, cr.fx, cr.fy, cr.zoom);
    ctx.drawImage(im, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  });
  ctx.restore();
}

function createSplitCanvas(canvas, opts) {
  opts = opts || {};
  const W = opts.width || 1080, H = opts.height || 1350;
  const backdrop = opts.backdrop || '#ffffff';
  const maxZoom = opts.maxZoom || 4;
  let gap = opts.gap != null ? opts.gap : 40;

  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let imgs = [];                 // 불러온 그림 1~2장
  let crops = [];                // 칸마다 { fx, fy, zoom }

  // 계산식은 위의 공용 함수를 그대로 쓴다 (목록·내보내기 쪽과 어긋나지 않게)
  const size = im => ({ pw: im.naturalWidth || im.width, ph: im.naturalHeight || im.height });
  const coverRect = splitCoverRect;
  const containZoom = splitContainZoom;
  const slots = () => splitSlots(W, H, gap, imgs.length);

  async function load(src) {
    if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
      if (!src.complete) await src.decode();
      return src;
    }
    // 폰 사진은 회전 정보(EXIF)가 따로 들어있어 이걸 반영해 주는 쪽을 먼저 쓴다
    if (typeof createImageBitmap === 'function' && src instanceof Blob) {
      try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch (_) {}
    }
    const url = (src instanceof Blob) ? URL.createObjectURL(src) : src;
    try {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.src = url;
      await im.decode();   // 깨진 파일이면 여기서 에러 — 부르는 쪽에서 try/catch 할 것
      return im;
    } finally { if (src instanceof Blob) URL.revokeObjectURL(url); }
  }

  /* 어느 그림이든 이 함수 하나로 그린다 — 큰 화면과 썸네일이 달라 보이지 않게 */
  function drawTo(c2, cw, ch) {
    drawSplitTo(c2, cw, ch, imgs, crops, { width: W, height: H, gap, backdrop });
  }
  const render = () => drawTo(ctx, W, H);
  // onChange는 "바뀌었을 때"만 부른다. 만드는 도중의 첫 그리기에서 부르면
  // 부른 쪽이 아직 결과를 변수에 담기도 전이라 그 안에서 이 도구를 쓸 수 없다
  const changed = () => { render(); if (opts.onChange) opts.onChange(api.getCrops()); };

  function resetCrops() { crops = splitDefaultCrops(imgs, W, H, gap); }

  /* 눌린 지점이 위 칸인지 아래 칸인지 */
  function slotAt(clientY) {
    const r = canvas.getBoundingClientRect();
    const y = (clientY - r.top) / r.height * H;
    const sl = slots();
    if (sl.length === 1) return 0;
    if (y > sl[0].y + sl[0].h && y < sl[1].y) return y < H / 2 ? 0 : 1;   // 가운데 여백은 가까운 쪽
    return y >= sl[1].y ? 1 : 0;
  }

  let drag = null;
  function onDown(e) {
    if (!imgs.length) return;
    drag = { i: slotAt(e.clientY), x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onMove(e) {
    if (!drag) return;
    const im = imgs[drag.i]; if (!im) return;
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - drag.x) * (W / r.width);
    const dy = (e.clientY - drag.y) * (H / r.height);
    drag.x = e.clientX; drag.y = e.clientY;
    const sl = slots()[drag.i], cr = crops[drag.i], { pw, ph } = size(im);
    const rc = coverRect(pw, ph, sl.w, sl.h, cr.fx, cr.fy, cr.zoom);
    // 사진이 칸보다 클 때(넘치는 만큼)와 작을 때(여백 안에서) 둘 다 움직여야 한다.
    // 계산식은 같고 부호만 뒤집히므로 조건만 절댓값으로 본다
    const ox = rc.dw - sl.w, oy = rc.dh - sl.h;
    const clamp = v => Math.max(0, Math.min(1, v));
    if (Math.abs(ox) > .5) cr.fx = clamp(cr.fx - dx / ox);
    if (Math.abs(oy) > .5) cr.fy = clamp(cr.fy - dy / oy);
    changed();
  }
  const onUp = () => { drag = null; };
  function onWheel(e) {
    if (!imgs.length) return;
    e.preventDefault();
    const i = slotAt(e.clientY), im = imgs[i]; if (!im) return;
    const sl = slots()[i], { pw, ph } = size(im);
    const min = containZoom(pw, ph, sl.w, sl.h);   // 전체가 보이는 크기보다 더 줄이지는 않음
    crops[i].zoom = Math.min(maxZoom, Math.max(min, crops[i].zoom * (e.deltaY < 0 ? 1.08 : .92)));
    changed();
  }
  const onDbl = () => { resetCrops(); changed(); };

  if (opts.interactive !== false) {
    canvas.style.touchAction = 'none';   // 모바일에서 끌 때 페이지가 같이 스크롤되지 않게
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
  }

  const api = {
    /** 사진 넣기 — 1장이면 단독, 2장이면 위아래 2분할 */
    async setImages(list) {
      imgs = [];
      for (const s of (list || []).slice(0, 2)) imgs.push(await load(s));
      resetCrops(); changed();
      return api;
    },
    /** 가운데 여백 바꾸기 */
    setGap(px) { gap = +px; resetCrops(); changed(); return api; },
    /** 처음 자리로 */
    reset() { resetCrops(); changed(); return api; },
    /** 자리 정보 꺼내기 / 되살리기 (저장했다 다시 불러올 때) */
    getCrops() { return crops.map(c => ({ ...c })); },
    setCrops(list) { if (list && list.length === crops.length) crops = list.map(c => ({ ...c })); changed(); return api; },
    /** 다른 캔버스에 같은 그림 그리기 (썸네일 등) */
    paintTo(other) { drawTo(other.getContext('2d'), other.width, other.height); return api; },
    render,
    /** 규격 해상도 그대로 내보내기 */
    toBlob(type, quality) {
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      drawTo(out.getContext('2d'), W, H);
      return new Promise((res, rej) => out.toBlob(
        b => (b ? res(b) : rej(new Error('이미지 변환에 실패했습니다'))),
        type || 'image/png', quality != null ? quality : 0.92));
    },
    async download(filename, type, quality) {
      const blob = await api.toBlob(type, quality);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `${W}x${H}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    /** 사진 불러오기만 따로 쓰고 싶을 때 (EXIF 회전까지 처리된 이미지를 돌려준다) */
    load,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    },
  };
  render();
  return api;
}
