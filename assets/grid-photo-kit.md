# 사진 그리드 4종 스니펫

메가하우스 마토메(`megahouse-matome/index.html`)에서 쓰고 있는 코드를 그대로 발췌한 것.
다른 도구에 복사해 넣고 쓰라고 만든 문서다. 네 가지는 서로 독립이라 필요한 것만 가져가도 된다.

1. 사진을 칸에 꽉 채우기 (가로로 길든 세로로 길든 여백 없이)
2. 칸을 클릭하면 그 칸의 편집 영역으로 이동
3. 칸끼리 드래그해서 순서 바꾸기
4. 칸 위에서 휠로 확대·축소

## 전제 (공통)

- 칸 하나는 `.cell`, 그 안에 `<img>` 하나.
- 칸마다 대응하는 데이터 객체 `it` 이 있고, 거기에 `src`(사진), `scale`(배율), `ox`/`oy`(이동량)를 저장한다.
- 전체 데이터는 `pages[페이지번호-1][칸번호]` 배열에 들어 있다고 가정한다. 한 페이지만 쓰는 도구면 `items[칸번호]` 로 바꿔 읽으면 된다.
- `saveState()` / `saveStateSoon()` 은 각자 도구의 저장 함수로 바꿔 끼운다. 저장이 없으면 지워도 동작은 한다.

---

## 1. 사진을 칸에 꽉 채우기 (폭맞춤 / 횡맞춤 자동)

가로로 긴 사진이든 세로로 긴 사진이든, 칸을 완전히 덮도록 **더 많이 커지는 쪽 배율**을 골라 쓴다(cover 방식).
덮고 남는 부분은 칸 밖으로 넘어가 잘리는데, 그 잘린 부분은 **사라진 게 아니라 이미지 안에 그대로 남아 있어서** 드래그로 다시 끌어올 수 있다.

### 왜 `object-fit: cover` 를 안 쓰는가

`object-fit` 은 칸 크기 기준으로 **크롭을 고정**해버린다. 그 위에 `transform` 으로 확대·이동해도 이미 잘려나간 부분은 되돌아오지 않는다.
그래서 이미지의 `width`/`height`/`left`/`top` 을 직접 계산해서 배치한다. 이게 이 스니펫의 핵심이다.

### CSS

```css
.cell { position: relative; overflow: hidden; }
.cell img {
  position: absolute;
  display: block;
  pointer-events: none;   /* 이미지가 드래그 이벤트를 가로채지 않게 */
  user-select: none;
  /* width/height/left/top 은 아래 JS가 직접 계산해서 넣는다 */
}
```

### JS

```js
// 반올림 오차로 1px 미만의 틈이 생기는 걸 막는 0.3% 여유
const SLOP = 1.003;

function applyImgTransform(img, it) {
  const cell = img.closest('.cell');
  const cw = cell ? cell.clientWidth  : 0;
  const ch = cell ? cell.clientHeight : 0;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  // 아직 크기를 모르면(로딩 전) 그냥 빠진다. 다음 load / resize 때 다시 불린다
  if (!cw || !ch || !iw || !ih) return;

  // 칸을 완전히 덮는 배율 = 가로·세로 배율 중 큰 쪽
  // (작은 쪽을 쓰면 '전체가 다 보이는' 대신 여백이 생긴다 = contain)
  const baseScale = Math.max(cw / iw, ch / ih) * SLOP;

  const eff = baseScale * (it.scale || 1);   // 사용자가 추가로 확대한 배율
  const dw = iw * eff, dh = ih * eff;

  // 칸 밖으로 넘어간 만큼만 드래그로 움직일 수 있게 제한
  const maxOx = Math.max(0, (dw - cw) / 2);
  const maxOy = Math.max(0, (dh - ch) / 2);
  it.ox = Math.max(-maxOx, Math.min(maxOx, it.ox || 0));
  it.oy = Math.max(-maxOy, Math.min(maxOy, it.oy || 0));

  img.style.width  = dw + 'px';
  img.style.height = dh + 'px';
  img.style.left   = ((cw - dw) / 2 + it.ox) + 'px';
  img.style.top    = ((ch - dh) / 2 + it.oy) + 'px';
}

// 사진 전체가 다 보이는(여백이 막 생기기 시작하는) 최소 배율.
// 4번 스니펫에서 Shift+휠로 여기까지만 축소를 허용할 때 쓴다
function containMinScale(img, cell) {
  const cw = cell.clientWidth, ch = cell.clientHeight;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!cw || !ch || !iw || !ih) return 1;
  return Math.min(cw / iw, ch / ih) / (Math.max(cw / iw, ch / ih) * SLOP);
}
```

### 부르는 시점

```js
img.addEventListener('load', () => applyImgTransform(img, it));
img.src = it.src;
// 칸 크기가 바뀌는 상황(창 크기 변경, 그리드 설정 변경)에서도 한 번 더
window.addEventListener('resize', () => {
  document.querySelectorAll('.cell img').forEach(im => applyImgTransform(im, im._it));
});
```

> 칸 안에 흐린 배경이나 흰 배경을 깔고 **사진 전체를 다 보여주는** 연출을 쓸 거면,
> `baseScale` 만 `Math.min(cw/iw, ch/ih)` 으로 바꾸면 된다(= contain). 나머지는 그대로다.

---

## 2. 칸을 클릭하면 그 칸의 편집 영역으로 이동

드래그와 클릭을 **이동 거리로** 구분한다. 6px 미만이면 클릭으로 본다.
그리고 중요한 점 하나 — 편집 영역이 다른 탭에 숨어 있으면 반응이 없는 것처럼 보이므로, **탭 전환까지 같이** 해줘야 한다.

```js
// 드래그 중인 칸은 전역으로 하나만 추적한다.
// (칸마다 window 리스너를 새로 붙이면 다시 그릴 때마다 쌓여서 메모리 누수가 난다)
let _cellDrag = null;

window.addEventListener('mousemove', e => {
  if (!_cellDrag) return;
  const { img, it, sx, sy, sox, soy } = _cellDrag;
  it.ox = sox + (e.clientX - sx);
  it.oy = soy + (e.clientY - sy);
  applyImgTransform(img, it);      // 1번 스니펫
});

window.addEventListener('mouseup', e => {
  if (!_cellDrag) return;
  const { cell, it, sx, sy } = _cellDrag;
  _cellDrag = null;
  cell.classList.remove('editing');

  const moved = Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy);
  if (moved >= 6) { saveStateSoon(); return; }   // 실제로 옮긴 경우: 위치만 저장하고 끝

  // ── 여기부터가 '클릭' 처리 ──
  // (1) 칸 안의 이름을 바로 고칠 수 있게
  const span = cell.querySelector('.name-text');
  if (span) { span.contentEditable = 'true'; span.focus(); }

  // (2) 편집 패널에서 그 칸의 행을 펼치고 하이라이트
  document.querySelectorAll('.item.selected').forEach(r => r.classList.remove('selected'));
  setOpenItem(it.id);     // 한 번에 하나만 펼치는 함수 (각자 도구 것으로 교체)
  gotoPhotoTab();         // ★ 다른 탭을 보던 중이면 펼쳐져도 안 보인다. 탭 전환 필수

  const row = document.querySelector(`.item[data-item-id="${it.id}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

function bindCellInteraction(cell, img, it) {
  cell.addEventListener('mousedown', e => {
    // 이름 글자나 뱃지를 누른 건 글자 편집이므로 가로채지 않는다
    if (e.target.classList.contains('name-text')) return;
    e.preventDefault();
    _cellDrag = { cell, img, it, sx: e.clientX, sy: e.clientY, sox: it.ox || 0, soy: it.oy || 0 };
    cell.classList.add('editing');
  });
}
```

> **토글로 만들지 말 것.** 이미 펼쳐진 칸을 다시 눌렀을 때 접히게 해두면
> "가끔 안 켜진다"처럼 보인다. 칸 클릭은 **항상 펼치는 쪽**으로 고정하는 게 맞다.

---

## 3. 칸끼리 드래그해서 순서 바꾸기

칸에 **전용 손잡이(⠿)** 를 둔다. 칸 전체를 `draggable` 로 만들면 2번의 사진 이동 드래그와 충돌한다.

### 손잡이

```js
const dh = document.createElement('div');
dh.className = 'cell-drag-handle';
dh.textContent = '⠿';
dh.draggable = true;
dh.addEventListener('mousedown', e => e.stopPropagation());  // 사진 이동 드래그와 분리
dh.addEventListener('dragstart', e => {
  dragSrc = { pg, idx: pages[pg-1].indexOf(it) };   // 전역 let dragSrc = null;
  e.dataTransfer.effectAllowed = 'move';
});
cell.appendChild(dh);
```

```css
.cell-drag-handle { position:absolute; top:6px; left:6px; z-index:5; opacity:0; cursor:grab; }
.cell:hover .cell-drag-handle { opacity:1; }
/* 이미지로 내보내는 기능이 있다면 반드시 아래를 같이 넣을 것 —
   캡처 순간 마우스가 올라가 있던 칸의 손잡이가 결과물에 그대로 찍힌다 */
body.exporting .cell-drag-handle { display:none !important; }
```

### 받는 쪽 (칸)

```js
cell.dataset.pg = pg; cell.dataset.idx = idx;   // 칸을 그릴 때 넣어둔다

cell.addEventListener('dragover', e => {
  e.preventDefault();
  // 탐색기에서 사진 파일을 끌어온 것과 칸↔칸 순서 바꾸기를 구분해서 강조색을 다르게
  cell.classList.add(e.dataTransfer.types.includes('Files') ? 'file-drag-over' : 'drag-over-preview');
});
cell.addEventListener('dragleave', () => cell.classList.remove('drag-over-preview', 'file-drag-over'));

cell.addEventListener('drop', e => {
  e.preventDefault();
  cell.classList.remove('drag-over-preview', 'file-drag-over');

  // (a) 탐색기에서 사진을 떨어뜨린 경우 — 그 칸의 사진만 교체 (이름·위치는 유지)
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (!file) return;
    const r = new FileReader();
    r.onload = ev => { it.src = ev.target.result; renderGrid(pg); saveState(); };
    r.readAsDataURL(file);
    return;
  }

  // (b) 칸끼리 — 두 칸을 맞바꾼다
  if (!dragSrc) return;
  const destPg = +cell.dataset.pg, destIdx = +cell.dataset.idx;
  const { pg: srcPg, idx: srcIdx } = dragSrc;
  dragSrc = null;
  if (srcPg === destPg && srcIdx === destIdx) return;

  const tmp = pages[srcPg-1][srcIdx];
  pages[srcPg-1][srcIdx] = pages[destPg-1][destIdx];
  pages[destPg-1][destIdx] = tmp;
  refresh();
});
```

> 페이지가 여러 장이어도 같은 코드로 된다. **맞바꾸기(swap)** 라서 각 페이지의 칸 수가 변하지 않기 때문이다.
> 끼워넣기(insert) 방식으로 하고 싶으면 페이지별 최대 장수 검사를 따로 넣어야 한다.

---

## 4. 칸 위에서 휠로 확대·축소

```js
cell.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.08 : -0.08;

  // 평소엔 1(=칸을 딱 채우는 크기) 밑으로 못 내려가므로 여백이 생기지 않는다.
  // Shift를 누른 채 돌리면 '사진 전체가 다 보이는 지점'까지 축소를 허용한다.
  const minScale = e.shiftKey ? containMinScale(img, cell) : 1;   // 1번 스니펫

  it.scale = Math.max(minScale, Math.min(5, (it.scale || 1) + delta));
  applyImgTransform(img, it);
  saveStateSoon();     // 연타해도 마지막 한 번만 저장되는 형태를 권장
}, { passive: false });
```

`{ passive: false }` 가 빠지면 브라우저가 `preventDefault()` 를 무시해서 **페이지가 같이 스크롤된다.** 반드시 넣을 것.

### 작업판(캔버스) 전체 확대와 같이 쓸 때

칸 휠과 작업판 휠이 겹치면 둘 다 동작해버린다. 작업판 쪽에서 칸 영역을 비켜가게 한다.

```js
stage.addEventListener('wheel', e => {
  if (e.target.closest('.poster-wrap, .stage-toolbar')) return;   // 칸·도구막대 위면 그쪽에 양보
  e.preventDefault();
  // ...작업판 확대/축소...
}, { passive: false });
```

### 터치(모바일) 지원이 필요하면

```js
let lastDist = null, t0 = null;
cell.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: it.ox||0, oy: it.oy||0 };
  }
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
}, { passive: false });
```

두 손가락 거리의 변화율을 `it.scale` 에 곱하고 `applyImgTransform()` 을 다시 부르면 핀치 확대가 된다.
