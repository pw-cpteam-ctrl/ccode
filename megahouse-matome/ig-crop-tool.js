// 인스타 규격 크롭 — 어떤 비율의 사진이든 인스타 규격(기본 4:5, 1080×1350)으로 잘라 주는 유틸리티.
// insta-gen의 "인스타 규격 크롭"에서 쓰던 걸 다른 프로젝트도 그대로 쓸 수 있게 일반화해서 뺐다.
// 외부 라이브러리 없음. (insta-gen 전용인 좌우 2분할·기울기·여러 장 썸네일 목록은 뺐음)
//
// 쓰는 방법은 두 가지:
//
// ① 한 번에 자르기 — 화면 없이 가운데 기준으로 꽉 채워 자른 결과만 필요할 때
//   const blob = await cropToInstagram(file);                       // 4:5, PNG
//   const blob = await cropToInstagram(file, { size:'square', type:'image/jpeg' });
//
// ② 직접 맞추기 — 캔버스 미리보기에서 드래그로 위치, 휠로 확대/축소한 뒤 내보내기
//   <canvas id="crop" style="width:320px"></canvas>
//   <script src="/assets/ig-crop-tool.js"></script>
//   <script>
//     const cropper = createIgCropper(document.getElementById('crop'), { size:'portrait' });
//     await cropper.load(file);                // File/Blob/<img>/URL 무엇이든
//     const blob = await cropper.toBlob();     // 미리보기에서 맞춘 그대로 1080×1350으로
//     cropper.download('사진.png');            // 바로 내려받기
//   </script>
//
// 미리보기 조작: 드래그 = 위치 이동 · 휠 = 확대/축소 · Shift+휠 = 사진 전체가 보일 때까지 축소 · 더블클릭 = 처음 위치로
// 가로로 넓은 사진(규격보다 납작한 사진)은 꽉 채우면 양옆이 크게 잘려서, 기본값을 "전체 보기"(위아래 여백)로 시작한다.
// 미리보기와 내보내기는 같은 계산식 하나로 그려서 결과가 어긋나지 않는다.

const IG_SIZES = {
  portrait:  { w: 1080, h: 1350 }, // 4:5  — 피드에서 가장 크게 보이는 비율(기본값)
  square:    { w: 1080, h: 1080 }, // 1:1
  story:     { w: 1080, h: 1920 }, // 9:16 — 스토리 / 릴스
  landscape: { w: 1080, h: 566  }, // 1.91:1
};

// 배율을 그대로 쓰면 반올림 오차로 사진이 규격보다 0.0001px쯤 작아져서 가장자리에 배경이
// 1px 미만 실선처럼 비칠 때가 있다(사진 크기에 따라 생겼다 안 생겼다 함). 0.3% 더 크게 그려서 틈을 없앤다.
const IG_SLOP = 1.003;

function igResolveSize(size) {
  const s = (size && typeof size === 'object') ? size : IG_SIZES[size || 'portrait'];
  if (!s || !s.w || !s.h) throw new Error('size 값이 잘못됐습니다: ' + size);
  return s;
}

/** File/Blob/URL/dataURL/<img> 무엇이든 그림으로 만든다 */
async function igLoadImage(source) {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if (!source.complete) await source.decode();
    return source;
  }
  // 폰 사진은 회전 정보(EXIF)가 따로 들어있어서, 그걸 반영해 주는 createImageBitmap을 먼저 쓴다.
  // 안 쓰면 세로로 찍은 사진이 눕혀진 채로 잘린다.
  if (typeof createImageBitmap === 'function' && source instanceof Blob) {
    try { return await createImageBitmap(source, { imageOrientation: 'from-image' }); }
    catch (_) { /* 구형 브라우저는 아래 방식으로 */ }
  }
  const url = (source instanceof Blob) ? URL.createObjectURL(source) : source;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();   // 손상된 파일이면 여기서 에러 — 호출한 쪽에서 try/catch로 꼭 처리할 것
    return img;
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}

function igImgSize(img) { return { pw: img.naturalWidth || img.width, ph: img.naturalHeight || img.height }; }

/**
 * 꽉 채우기(cover) 배율·위치 계산 — 미리보기와 내보내기가 둘 다 이 식 하나만 쓴다.
 * @param fx,fy  자를 기준점 0~1 (0.5 = 가운데). 인물 사진은 fy를 0.35쯤 주면 얼굴이 안 잘린다.
 * @param zoom   꽉 채우는 최소 배율에 곱하는 배수(1 = 딱 꽉 참, 1보다 크면 더 확대, 작으면 여백 생김)
 */
function igCoverRect(pw, ph, W, H, fx, fy, zoom) {
  const eff = Math.max(W / pw, H / ph) * IG_SLOP * (zoom || 1);
  const dw = pw * eff, dh = ph * eff;
  return { dw, dh, dx: -(dw - W) * (fx != null ? fx : 0.5), dy: -(dh - H) * (fy != null ? fy : 0.5) };
}

/** 사진 전체가 다 보이는 배율(여백 생김) */
function igContainZoom(pw, ph, W, H) { return Math.min(W / pw, H / ph) / (Math.max(W / pw, H / ph) * IG_SLOP); }

/** 규격보다 가로로 넓은 사진이면 "전체 보기", 아니면 꽉 채우기(1) */
function igDefaultZoom(pw, ph, W, H) { return (pw / ph) > (W / H) ? igContainZoom(pw, ph, W, H) : 1; }

function igDrawCrop(ctx, img, W, H, fx, fy, zoom, backdrop) {
  const { pw, ph } = igImgSize(img);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = backdrop || '#ffffff';   // 여백(전체 보기일 때 위아래/양옆)은 이 색
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';      // 원본이 작아서 확대될 때 최대한 부드럽게
  const r = igCoverRect(pw, ph, W, H, fx, fy, zoom);
  ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
}

function igCanvasToBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob(
    b => (b ? res(b) : rej(new Error('이미지 변환에 실패했습니다'))),
    type || 'image/png', quality != null ? quality : 0.92));
}

/**
 * ① 한 번에 자르기
 * @param source        File | Blob | <img> | URL | dataURL
 * @param opts.size     'portrait'(기본) | 'square' | 'story' | 'landscape' | { w, h }
 * @param opts.fit      'cover'(기본, 꽉 채움 — 넘치는 부분은 잘림) | 'contain'(전체 보이게 — 여백 생김) | 'auto'(넓은 사진만 contain)
 * @param opts.focus    { x, y } 0~1 — 자를 기준점(기본 가운데)
 * @param opts.zoom     직접 배율을 줄 때(fit보다 우선)
 * @param opts.type     'image/png'(기본) | 'image/jpeg' | 'image/webp'
 * @param opts.quality  jpeg/webp 품질 0~1(기본 0.92)
 * @param opts.backdrop 여백 색(기본 '#ffffff')
 * @returns {Promise<Blob>}
 */
async function cropToInstagram(source, opts) {
  opts = opts || {};
  const { w: W, h: H } = igResolveSize(opts.size);
  const img = await igLoadImage(source);
  const { pw, ph } = igImgSize(img);
  if (!pw || !ph) throw new Error('사진 크기를 읽지 못했습니다');
  const zoom = opts.zoom != null ? opts.zoom
    : opts.fit === 'contain' ? igContainZoom(pw, ph, W, H)
    : opts.fit === 'auto' ? igDefaultZoom(pw, ph, W, H) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  igDrawCrop(canvas.getContext('2d'), img, W, H, opts.focus && opts.focus.x, opts.focus && opts.focus.y, zoom, opts.backdrop);
  if (img.close && !(source instanceof HTMLImageElement)) img.close(); // ImageBitmap 메모리 해제
  return igCanvasToBlob(canvas, opts.type, opts.quality);
}

/**
 * ② 직접 맞추기 — 캔버스 하나를 크롭 편집기로 만든다.
 * @param canvas            미리보기로 쓸 <canvas>. 화면 크기는 CSS로(예: width:320px) — 비율은 자동으로 맞춤
 * @param opts.size         규격(cropToInstagram과 같음, 기본 'portrait')
 * @param opts.previewWidth 미리보기 캔버스 내부 해상도 폭(기본 540 — 레티나에서도 선명하게 CSS 폭의 1.5~2배 권장)
 * @param opts.backdrop     여백 색(기본 '#ffffff')
 * @param opts.wideFit      넓은 사진 기본값: 'contain'(기본, 전체 보기) | 'cover'(꽉 채움)
 * @param opts.maxZoom      최대 확대 배수(기본 4)
 * @param opts.onChange     위치·배율이 바뀔 때마다 호출 — (state) => {}
 */
function createIgCropper(canvas, opts) {
  opts = opts || {};
  let size = igResolveSize(opts.size);
  const ctx = canvas.getContext('2d');
  const backdrop = opts.backdrop || '#ffffff';
  const maxZoom = opts.maxZoom || 4;
  const state = { img: null, name: '', fx: 0.5, fy: 0.5, zoom: 1 };

  function fitCanvas() {
    const pwid = opts.previewWidth || 540;
    canvas.width = pwid;
    canvas.height = Math.round(pwid * size.h / size.w);
  }
  function baseZoom() {
    if (!state.img) return 1;
    const { pw, ph } = igImgSize(state.img);
    return opts.wideFit === 'cover' ? 1 : igDefaultZoom(pw, ph, size.w, size.h);
  }
  function render() {
    if (!state.img) { ctx.fillStyle = backdrop; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    igDrawCrop(ctx, state.img, canvas.width, canvas.height, state.fx, state.fy, state.zoom, backdrop);
  }
  function changed() { render(); if (opts.onChange) opts.onChange({ ...state }); }

  // ── 드래그로 위치 이동 ──
  let dragging = false, lastX = 0, lastY = 0;
  function onDown(e) {
    if (!state.img) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onMove(e) {
    if (!dragging || !state.img) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - lastX) * (canvas.width / rect.width);
    const dy = (e.clientY - lastY) * (canvas.height / rect.height);
    lastX = e.clientX; lastY = e.clientY;
    const { pw, ph } = igImgSize(state.img);
    const r = igCoverRect(pw, ph, canvas.width, canvas.height, state.fx, state.fy, state.zoom);
    const ox = r.dw - canvas.width, oy = r.dh - canvas.height;   // 넘치는 만큼만 움직일 수 있음
    const clamp = v => Math.max(0, Math.min(1, v));
    if (ox > 0.5) state.fx = clamp(state.fx - dx / ox);
    if (oy > 0.5) state.fy = clamp(state.fy - dy / oy);
    changed();
  }
  function onUp() { dragging = false; }
  // ── 휠로 확대/축소 (평소엔 기본 배율까지만, Shift를 누르면 전체 보기까지) ──
  function onWheel(e) {
    if (!state.img) return;
    e.preventDefault();
    const { pw, ph } = igImgSize(state.img);
    const min = e.shiftKey ? igContainZoom(pw, ph, size.w, size.h) : baseZoom();
    state.zoom = Math.min(maxZoom, Math.max(min, state.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    changed();
  }
  function onDbl() { api.reset(); }

  canvas.style.touchAction = 'none';   // 모바일에서 드래그할 때 페이지가 같이 스크롤되지 않게
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);

  const api = {
    /** 사진 넣기 — 손상된 파일이면 에러를 던지니 try/catch로 감쌀 것 */
    async load(source, name) {
      const img = await igLoadImage(source);
      if (state.img && state.img.close && state.img !== img) state.img.close();
      state.img = img;
      state.name = name || (source && source.name) || 'photo';
      state.fx = 0.5; state.fy = 0.5; state.zoom = baseZoom();
      changed();
    },
    /** 처음 위치·배율로 */
    reset() { state.fx = 0.5; state.fy = 0.5; state.zoom = baseZoom(); changed(); },
    /** 규격 바꾸기('portrait' 등 또는 {w,h}) — 위치는 처음으로 */
    setSize(next) { size = igResolveSize(next); fitCanvas(); api.reset(); },
    /** 위치·배율 직접 지정(저장해 둔 값 되살리기 등) */
    setCrop(c) { Object.assign(state, { fx: c.fx ?? state.fx, fy: c.fy ?? state.fy, zoom: c.zoom ?? state.zoom }); changed(); },
    getState() { return { ...state, size: { ...size } }; },
    /** 미리보기에서 맞춘 그대로 원래 규격 해상도로 내보내기 */
    async toBlob(o) {
      if (!state.img) throw new Error('사진이 없습니다');
      o = o || {};
      const out = document.createElement('canvas');
      out.width = size.w; out.height = size.h;
      igDrawCrop(out.getContext('2d'), state.img, size.w, size.h, state.fx, state.fy, state.zoom, backdrop);
      return igCanvasToBlob(out, o.type, o.quality);
    },
    /** 바로 내려받기 — 파일 이름을 안 주면 "원래이름_1080x1350.png" */
    async download(filename, o) {
      const blob = await api.toBlob(o);
      const base = (state.name || 'photo').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'photo';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `${base}_${size.w}x${size.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    /** 편집기 해제(이벤트 제거) */
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    },
    render,
  };

  fitCanvas(); render();
  return api;
}
