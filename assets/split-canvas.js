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

  // 배율을 그대로 쓰면 반올림 때문에 가장자리에 배경이 실선처럼 비칠 때가 있어 0.3% 크게 그린다
  const SLOP = 1.003;
  const size = im => ({ pw: im.naturalWidth || im.width, ph: im.naturalHeight || im.height });
  /* 꽉 채우기 기준 위치·크기 — 화면에 그릴 때와 내보낼 때가 이 식 하나만 쓴다 */
  function coverRect(pw, ph, w, h, fx, fy, zoom) {
    const eff = Math.max(w / pw, h / ph) * SLOP * zoom;
    const dw = pw * eff, dh = ph * eff;
    return { dw, dh, dx: -(dw - w) * fx, dy: -(dh - h) * fy };
  }
  /* 사진 전체가 다 보이는 배율 (여백이 생김) */
  function containZoom(pw, ph, w, h) {
    return Math.min(w / pw, h / ph) / (Math.max(w / pw, h / ph) * SLOP);
  }

  /* 사진이 들어갈 자리 — 1장이면 한 칸, 2장이면 위아래 두 칸 */
  function slots() {
    if (imgs.length <= 1) return [{ x: 0, y: 0, w: W, h: H }];
    const h = (H - gap) / 2;
    return [{ x: 0, y: 0, w: W, h }, { x: 0, y: H - h, w: W, h }];
  }

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
    c2.save();
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.clearRect(0, 0, cw, ch);
    c2.scale(cw / W, ch / H);
    c2.fillStyle = backdrop; c2.fillRect(0, 0, W, H);
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
    slots().forEach((sl, i) => {
      const im = imgs[i]; if (!im) return;
      const cr = crops[i], { pw, ph } = size(im);
      c2.save();
      c2.beginPath(); c2.rect(sl.x, sl.y, sl.w, sl.h); c2.clip();
      c2.translate(sl.x, sl.y);
      c2.fillStyle = backdrop; c2.fillRect(0, 0, sl.w, sl.h);
      const r = coverRect(pw, ph, sl.w, sl.h, cr.fx, cr.fy, cr.zoom);
      c2.drawImage(im, r.dx, r.dy, r.dw, r.dh);
      c2.restore();
    });
    c2.restore();
  }
  const render = () => drawTo(ctx, W, H);
  // onChange는 "바뀌었을 때"만 부른다. 만드는 도중의 첫 그리기에서 부르면
  // 부른 쪽이 아직 결과를 변수에 담기도 전이라 그 안에서 이 도구를 쓸 수 없다
  const changed = () => { render(); if (opts.onChange) opts.onChange(api.getCrops()); };

  function resetCrops() {
    crops = slots().map((sl, i) => {
      const im = imgs[i];
      if (!im) return { fx: .5, fy: .5, zoom: 1 };
      const { pw, ph } = size(im);
      return { fx: .5, fy: .5, zoom: containZoom(pw, ph, sl.w, sl.h) };
    });
  }

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
