/**
 * 인스타그램 규격으로 자동 크롭 — 어떤 비율의 사진이든 넣으면 지정 규격에
 * 여백 없이 꽉 채워 자른 이미지를 돌려준다. 외부 라이브러리 없음.
 * (하단 "인스타 규격 크롭" 섹션 전용 — 위쪽 카드 생성기와는 완전히 독립된 파일)
 */
const IG_SIZES = {
  portrait:  { w: 1080, h: 1350 }, // 4:5  — 피드에서 가장 크게 보이는 비율(기본값)
  square:    { w: 1080, h: 1080 }, // 1:1
  story:     { w: 1080, h: 1920 }, // 9:16 — 스토리 / 릴스
  landscape: { w: 1080, h: 566  }, // 1.91:1
};

// cover-fit 배율을 부동소수점 그대로 쓰면 pw*(W/pw) 같은 곱셈이 반올림 오차로 W보다
// 아주 살짝(0.0001px 등) 작게 나올 수 있고, 그 틈으로 배경이 1px 미만 실선처럼 비쳐
// 보인다(사진 크기에 따라 생겼다 안 생겼다 함). 0.3% 여유를 얹어 항상 살짝
// 오버커버하게 만들어 이 틈 자체를 없앤다.
const SLOP = 1.003;

/** File/Blob/URL/dataURL/<img> 무엇이든 그림으로 만든다 */
async function igLoadImage(source) {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if (!source.complete) await source.decode();
    return source;
  }
  // 폰으로 찍은 사진은 회전 정보(EXIF)가 따로 들어있어서, 그걸 반영해주는
  // createImageBitmap을 우선 쓴다. 안 쓰면 세로 사진이 눕혀진 채로 잘린다.
  if (typeof createImageBitmap === 'function' && (source instanceof Blob)) {
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch (_) { /* 구형 브라우저는 아래로 */ }
  }
  const url = (source instanceof Blob) ? URL.createObjectURL(source) : source;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}

/**
 * cover-fit 배율/좌표 계산만 따로 뺀 것 — 화면 미리보기(캔버스 실시간 렌더링)와
 * 실제 다운로드용 블롭 생성(cropToInstagram) 둘 다 이 공식 하나로 통일해서 써야
 * 미리보기랑 실제 다운로드 결과가 어긋나지 않는다.
 * @param zoom  cover-fit 최소 배율에 곱하는 추가 확대 배수(기본 1, 1보다 크면 더 확대)
 */
function coverCropRect(pw, ph, W, H, focusX, focusY, zoom) {
  const fx = focusX != null ? focusX : 0.5;
  const fy = focusY != null ? focusY : 0.5;
  const eff = Math.max(W / pw, H / ph) * SLOP * (zoom || 1);
  const dw = pw * eff, dh = ph * eff;
  const dx = -(dw - W) * fx;
  const dy = -(dh - H) * fy;
  return { dw, dh, dx, dy };
}

/**
 * @param source  File | Blob | HTMLImageElement | URL문자열 | dataURL
 * @param opts.size      'portrait'(기본) | 'square' | 'story' | 'landscape'
 *                       또는 직접 { w, h }
 * @param opts.focus     자를 기준점 0~1. 기본 {x:0.5, y:0.5}(가운데).
 *                       인물 사진은 {y:0.35} 처럼 위쪽으로 주면 얼굴이 안 잘린다.
 * @param opts.zoom      cover-fit 배율에 곱하는 추가 확대 배수(기본 1) — 마우스 휠로
 *                       사용자가 더 확대했을 때 그 값을 그대로 넘기면 미리보기와 동일하게 잘림
 * @param opts.type      'image/png'(기본) | 'image/jpeg' | 'image/webp'
 * @param opts.quality   jpeg/webp 품질 0~1 (기본 0.92)
 * @param opts.backdrop  혹시 남는 픽셀에 깔 색 (기본 '#1a1a1a')
 * @returns {Promise<Blob>}
 */
async function cropToInstagram(source, opts) {
  opts = opts || {};
  const size = typeof opts.size === 'object' ? opts.size : (IG_SIZES[opts.size || 'portrait']);
  if (!size) throw new Error('size 값이 잘못됐습니다: ' + opts.size);
  const W = size.w, H = size.h;
  const fx = opts.focus && opts.focus.x != null ? opts.focus.x : 0.5;
  const fy = opts.focus && opts.focus.y != null ? opts.focus.y : 0.5;

  const img = await igLoadImage(source);
  const pw = img.naturalWidth || img.width;
  const ph = img.naturalHeight || img.height;
  if (!pw || !ph) throw new Error('사진 크기를 읽지 못했습니다');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // 원본이 작아서 확대될 때 최대한 부드럽게
  // 이중 안전장치 — 위 SLOP으로 웬만한 틈은 없어지지만, 혹시 남더라도
  // 투명(캔버스 기본값)이 아니라 이 색으로 보이게 한다.
  ctx.fillStyle = opts.backdrop || '#1a1a1a';
  ctx.fillRect(0, 0, W, H);

  const { dw, dh, dx, dy } = coverCropRect(pw, ph, W, H, fx, fy, opts.zoom);
  ctx.drawImage(img, dx, dy, dw, dh);

  if (img.close) img.close(); // ImageBitmap 메모리 해제

  const type = opts.type || 'image/png';
  const quality = opts.quality != null ? opts.quality : 0.92;
  return new Promise((res, rej) => {
    canvas.toBlob(b => (b ? res(b) : rej(new Error('이미지 변환에 실패했습니다'))),
                  type, quality);
  });
}
