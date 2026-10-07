// 글자 크기 자동 맞춤 — 정해진 폭/상자 안에 글자가 들어가도록 크기를 줄여 준다.
// 글자를 자르거나 "…"로 바꾸지 않고 크기만 줄이므로 내용이 사라지지 않는다.
// 외부 라이브러리 없음. (insta-gen의 fitText를 다른 도구에서도 쓸 수 있게 일반화한 것)
//
// 용도에 따라 두 가지다.
//   ① fitCanvasText  — 캔버스에 직접 글자를 그리는 도구용 (PNG 내보내기 등)
//   ② fitElementText — 화면의 글자 상자(HTML 요소)용
//
// 쓰는 방법:
//   <script src="/assets/fit-text.js"></script>
//
//   // ① 캔버스
//   fitCanvasText(ctx, '아주 긴 제목…', { maxW: 900, size: 80, min: 14, weight: 800 });
//   ctx.fillText('아주 긴 제목…', 540, 200);   // font는 이미 맞춰진 크기로 바뀌어 있다
//
//   // ② 화면 요소
//   fitElementText(document.querySelector('.fit'), { max: 32, min: 12 });
//
// 주의할 점:
//   - ②에서 한 줄로 줄이고 싶으면 상자에 white-space:nowrap을 준다.
//     여러 줄로 줄이고 싶으면 상자에 height를 정해 준다 — 높이가 없으면 상자가 늘어나기만 해서
//     글자가 줄어들 이유가 없어진다.
//   - 둘 다 min보다 작게는 줄이지 않는다. 그래도 안 들어가면 글자를 자르지 않고 min으로 둔다.
//   - ①은 웹폰트를 쓰면 폰트가 다 받아진 뒤(document.fonts.ready 이후)에 불러야 폭이 정확하다.
//   - ②에서 글자 내용을 바꾼 뒤에는 다시 불러야 한다. 상자 크기가 바뀔 때도 따라가게 하려면
//     { watch: true }를 준다(요소 크기 감시를 걸어 둔다).

// ① 캔버스용 — 글자가 maxW보다 넓으면 들어갈 때까지 크기를 줄이고, 정한 크기를 돌려준다.
//    ctx.font도 그 크기로 바꿔 두므로 바로 fillText 하면 된다.
function fitCanvasText(ctx, text, { maxW, size, min = 12, weight = 400, family = 'Pretendard, sans-serif' }) {
  const set = s => { ctx.font = `${weight} ${s}px ${family}`; };
  set(size);
  if (ctx.measureText(text).width <= maxW) return size;          // 이미 들어가면 그대로
  let lo = min, hi = size;                                       // 들어가는 가장 큰 크기를 반씩 좁혀 찾는다(1px씩 줄이는 것보다 빠름)
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2; set(mid);
    if (ctx.measureText(text).width <= maxW) lo = mid; else hi = mid;
  }
  set(lo);
  return lo;   // min까지 줄여도 안 들어가면 min을 돌려준다(글자를 자르지는 않음)
}

// ② 화면(HTML) 요소용 — 상자 크기에 맞게 글자 크기를 줄인다. 한 줄이면 폭, 여러 줄이면 높이 기준.
function fitElementText(el, { max, min = 10, watch = false } = {}) {
  max = max || parseFloat(getComputedStyle(el).fontSize);
  const fits = () => el.scrollWidth <= el.clientWidth + 0.5 && el.scrollHeight <= el.clientHeight + 0.5;
  const run = () => {
    el.style.fontSize = max + 'px';
    if (fits()) return max;
    let lo = min, hi = max;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2; el.style.fontSize = mid + 'px';
      if (fits()) lo = mid; else hi = mid;
    }
    el.style.fontSize = lo + 'px';
    return lo;
  };
  if (watch && !el.__fitRO) { el.__fitRO = new ResizeObserver(run); el.__fitRO.observe(el); }
  return run();
}
