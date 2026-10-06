// ※ 원본은 저장소 공용 폴더 assets/undo-history.js — insta-gen 사이트는 이 폴더만 배포돼서(/assets/…는 404)
//   같은 내용을 복사해 둔 것. 원본을 고치면 여기도 같이 고칠 것.

// 실행취소(Ctrl+Z) — 바꾸기 직전 상태를 쌓아두고 한 단계씩 되돌리는 유틸리티.
// 외부 라이브러리 없음. 시간 제한 없음 — 10초 뒤든 한 시간 뒤든 똑같이 되돌아간다.
// (megahouse-matome에서 실제로 쓰며 다듬은 코드를 그대로 떼어내 범용화한 것)
//
// 되돌릴 수 있는 조건은 두 가지뿐이다:
//   · 쌓아둔 단계 수(기본 30단계)를 넘기면 오래된 것부터 밀려난다
//   · 새로고침하면 사라진다 (브라우저 메모리에만 있음)
//
// 쓰는 방법:
//   <script src="/assets/undo-history.js"></script>
//   <script>
//     const history = createUndoHistory({
//       // ① 무엇을 기억할지 — 되돌리고 싶은 값들을 모아서 돌려준다
//       read:  () => ({ items, selected }),
//       // ② 어떻게 되돌릴지 — 기억해둔 값을 받아 원래 자리에 되돌려 놓는다
//       write: s => { items = s.items; selected = s.selected; },
//       // ③ 되돌린 뒤 화면 다시 그리기 (선택)
//       after: () => render(),
//     });
//
//     function 무언가바꾸기() {
//       items.push(새항목);
//       render();
//       history.record();     // ← 바꾼 "뒤"에 부른다
//     }
//   </script>
//
// 화면이 다 준비된 뒤(저장본을 불러온 직후 등)에 history.reset()을 한 번 불러두면
// "맨 처음 상태"까지 되돌아간다. 안 부르면 첫 번째 record()가 기준점을 잡는 데 쓰여서
// 그 이전 상태 하나는 되돌릴 수 없다.
//
// Ctrl+Z(맥은 Cmd+Z)는 자동으로 연결된다. 글자를 입력 중일 때(입력칸·텍스트영역·
// 직접 편집 영역)는 브라우저 기본 되돌리기에 양보하므로 가로채지 않는다.
//
// 옵션:
//   read     (필수) 기억할 값을 모아서 돌려주는 함수
//   write    (필수) 기억해둔 값을 받아 되돌려 놓는 함수
//   after    되돌린 직후에 할 일(화면 다시 그리기 등)
//   max      쌓아둘 단계 수. 기본 30
//   hotkey   Ctrl+Z 자동 연결. 기본 true
//   onUndo   되돌렸을 때 알림 — 기본 없음. 예: () => toast('실행 취소')
//   onEmpty  되돌릴 게 없을 때 알림. 예: () => toast('더 이상 되돌릴 수 없습니다')
//
// 주의: 기억은 JSON으로 복사해서 보관한다. 따라서 함수·Date·undefined처럼
// JSON으로 적을 수 없는 값은 그대로 보존되지 않는다. read()에는 "되돌려야 하는 값"만
// 담고, 화면 요소(DOM)나 함수는 넣지 말 것.

function createUndoHistory(opts) {
  opts = opts || {};
  if (typeof opts.read !== 'function')  throw new Error('무엇을 기억할지(read 함수)가 필요합니다');
  if (typeof opts.write !== 'function') throw new Error('어떻게 되돌릴지(write 함수)가 필요합니다');
  const max = opts.max != null ? opts.max : 30;

  const stack = [];
  // 되돌릴 지점은 "바꾸기 직전" 상태여야 한다. 그런데 기록은 보통 바꾼 뒤에 부르게 되므로,
  // 그대로 쌓으면 바뀐 뒤 상태가 쌓여서 첫 번째 되돌리기가 헛돌고 이후로는 한 칸씩 밀린다
  // ("한참 전으로 돌아간다"로 보임). 직전 상태를 하나 들고 있다가 그걸 쌓는 방식으로 푼다
  let last = null;
  let busy = false;   // 되돌리는 중에 다시 기록되지 않게

  const snap = () => JSON.stringify(opts.read());

  const api = {
    /** 무언가 바꾼 "뒤"에 부른다 — 직전 상태가 한 단계로 쌓인다 */
    record() {
      if (busy) return api;
      const now = snap();
      if (last === null) { last = now; return api; }   // 첫 호출은 기준점만 잡는다
      if (last === now) return api;                    // 실제로 달라진 게 없으면 안 쌓는다(슬라이더 연타 등)
      stack.push(last);
      last = now;
      if (stack.length > max) stack.shift();
      return api;
    },
    /** 한 단계 되돌린다 — 되돌렸으면 true */
    undo() {
      if (!stack.length) { if (opts.onEmpty) opts.onEmpty(); return false; }
      busy = true;
      try {
        opts.write(JSON.parse(stack.pop()));
        last = snap();   // 되돌린 결과가 다시 새 변경으로 기록되지 않게 기준점을 맞춘다
        if (opts.after) opts.after();
      } finally { busy = false; }
      if (opts.onUndo) opts.onUndo();
      return true;
    },
    /** 기록을 비우고 지금 상태를 새 출발점으로 삼는다 (저장본을 불러온 직후 등) */
    reset() { stack.length = 0; last = snap(); return api; },
    /** 되돌릴 수 있는 단계 수 */
    depth() { return stack.length; },
    canUndo() { return stack.length > 0; },
    /** Ctrl+Z 연결 해제 */
    destroy() { if (onKey) document.removeEventListener('keydown', onKey); },
  };

  let onKey = null;
  if (opts.hotkey !== false) {
    onKey = e => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey)) return;
      // 글자를 입력하는 중이면 브라우저 기본 되돌리기(타이핑 취소)에 양보한다
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return;
      e.preventDefault();
      api.undo();
    };
    document.addEventListener('keydown', onKey);
  }

  return api;
}
