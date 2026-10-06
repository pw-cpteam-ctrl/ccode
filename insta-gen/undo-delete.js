// ※ 원본은 저장소 공용 폴더 assets/undo-delete.js — insta-gen 사이트는 이 폴더만 배포돼서(/assets/…는 404)
//   같은 내용을 복사해 둔 것. 원본을 고치면 여기도 같이 고칠 것.

// 삭제만 되돌리기 — 지운 걸 바로 버리지 않고 잠깐 들고 있다가 "되돌리기" 버튼을 띄우는 유틸리티.
// 외부 라이브러리 없음. 삭제 외의 동작(수정·이동 등)은 다루지 않는다.
//
// 왜 필요한가:
//   "정말 지울까요?" 확인창은 누를 때마다 걸리적거려서 결국 아무 생각 없이 넘기게 된다.
//   그러느니 일단 지우고 몇 초 동안 되돌릴 기회를 주는 쪽이 덜 귀찮고 더 안전하다.
//
// 쓰는 방법:
//   <script src="/assets/undo-delete.js"></script>
//   <script>
//     const trash = createUndoDelete();
//
//     function deleteItem(i) {
//       const removed = list.splice(i, 1)[0];   // 화면에서는 바로 사라짐
//       render();
//       trash.remove(removed.name, () => {      // 되돌리기를 누르면 이 함수가 실행됨
//         list.splice(i, 0, removed);
//         render();
//       });
//     }
//   </script>
//
// 되돌릴 수 있는 시간이 지나면 그냥 사라진다. 그때 진짜로 정리할 일(서버에서 지우기,
// 메모리 해제 등)이 있으면 세 번째 인자로 넘긴다:
//   trash.remove(이름, 되돌리기함수, { confirm: () => URL.revokeObjectURL(url) });
//
// 짧은 사이에 여러 개를 지우면 하나로 묶어서 "3개 삭제됨"으로 보여주고,
// 되돌리기를 누르면 지운 역순으로 전부 되살린다.
//
// 옵션:
//   seconds   되돌릴 수 있는 시간(초). 기본 7
//   position  토스트 위치 'bottom-center'(기본) | 'bottom-left' | 'bottom-right' | 'top-center'
//   zIndex    겹침 순서. 기본 99999
//   text      문구 바꾸기 { one:(라벨)=>'...', many:(개수)=>'...', undo:'되돌리기' }

function createUndoDelete(opts) {
  opts = opts || {};
  const seconds  = opts.seconds  != null ? opts.seconds : 7;
  const position = opts.position || 'bottom-center';
  const zIndex   = opts.zIndex   != null ? opts.zIndex : 99999;
  const text = Object.assign({
    one:  label => `'${label}' 삭제됨`,
    many: n => `${n}개 삭제됨`,
    undo: '되돌리기',
  }, opts.text || {});

  _udInjectStyle();

  let batch = [];        // 지금 묶여 있는 삭제들 (지운 순서대로)
  let timer = null;      // 시간이 다 되면 확정하는 타이머
  let box = null;        // 화면에 떠 있는 토스트
  let deadline = 0;

  /* 되돌릴 기회를 더 주지 않고 지금 바로 확정한다 (내부용) */
  function confirmAll() {
    const done = batch;
    batch = [];
    clearTimeout(timer); timer = null;
    hide();
    // 확정 처리 중 에러가 나도 나머지 항목 확정이 멈추지 않게 하나씩 감싼다
    done.forEach(e => { try { if (e.confirm) e.confirm(); } catch (err) { console.error(err); } });
  }

  function undoAll() {
    const done = batch.slice().reverse();   // 마지막에 지운 것부터 되돌려야 자리가 맞는다
    batch = [];
    clearTimeout(timer); timer = null;
    hide();
    done.forEach(e => { try { e.undo(); } catch (err) { console.error(err); } });
  }

  function hide() {
    if (!box) return;
    const el = box; box = null;
    el.classList.remove('ud-in');
    setTimeout(() => el.remove(), 180);
  }

  function show() {
    if (!box) {
      box = document.createElement('div');
      box.className = 'ud-toast ud-' + position;
      box.style.zIndex = zIndex;
      box.innerHTML =
        '<span class="ud-msg"></span>' +
        '<button type="button" class="ud-btn"></button>' +
        '<span class="ud-bar"><i></i></span>';
      box.querySelector('.ud-btn').textContent = text.undo;
      box.querySelector('.ud-btn').addEventListener('click', undoAll);
      document.body.appendChild(box);
      requestAnimationFrame(() => box.classList.add('ud-in'));
    }
    box.querySelector('.ud-msg').textContent =
      batch.length === 1 ? text.one(batch[0].label) : text.many(batch.length);
    // 남은 시간 막대 — 애니메이션을 처음부터 다시 돌리려면 한 번 끊어줘야 한다
    const bar = box.querySelector('.ud-bar i');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${seconds}s linear`;
    bar.style.transform = 'scaleX(0)';
  }

  const api = {
    /**
     * 하나 지웠다고 알린다 — 화면에서 지우는 건 호출한 쪽이 이미 했다는 전제.
     * @param label   토스트에 보여줄 이름 (없으면 '항목')
     * @param undo    되돌리기를 눌렀을 때 실행할 함수 — 원래 자리에 되돌려 놓을 것
     * @param o.confirm  시간이 지나 확정될 때 할 뒷정리(선택)
     */
    remove(label, undo, o) {
      if (typeof undo !== 'function') throw new Error('되돌리는 방법(undo 함수)이 필요합니다');
      batch.push({ label: label || '항목', undo, confirm: (o || {}).confirm });
      clearTimeout(timer);
      deadline = Date.now() + seconds * 1000;
      timer = setTimeout(confirmAll, seconds * 1000);   // 하나 더 지우면 시간이 다시 처음부터
      show();
      return api;
    },
    /** 되돌리기를 직접 실행 (예: Ctrl+Z에 연결) — 되돌릴 게 없으면 false */
    undo() { if (!batch.length) return false; undoAll(); return true; },
    /** 기다리지 않고 지금 확정 (저장·페이지 이동 직전 등) */
    flush() { if (batch.length) confirmAll(); },
    /** 지금 되돌릴 수 있는 개수 */
    pending() { return batch.length; },
    /** 남은 시간(ms) */
    remaining() { return batch.length ? Math.max(0, deadline - Date.now()) : 0; },
  };

  // 되돌릴 수 있는 상태로 페이지를 떠나면 뒷정리가 영영 안 돌아가므로 여기서 확정한다
  window.addEventListener('pagehide', () => api.flush());

  return api;
}

function _udInjectStyle() {
  if (document.getElementById('ud-style')) return;
  const st = document.createElement('style');
  st.id = 'ud-style';
  st.textContent = `
.ud-toast{position:fixed;display:flex;align-items:center;gap:12px;
  background:#2b2b2b;color:#fff;border-radius:10px;padding:11px 12px 11px 16px;
  font-size:13.5px;font-family:inherit;box-shadow:0 6px 22px rgba(0,0,0,.3);
  opacity:0;transform:translateY(10px);transition:opacity .18s,transform .18s;
  max-width:calc(100vw - 32px);}
.ud-toast.ud-in{opacity:1;transform:translateY(0);}
.ud-bottom-center{left:50%;bottom:24px;margin-left:-0px;transform:translate(-50%,10px);}
.ud-bottom-center.ud-in{transform:translate(-50%,0);}
.ud-bottom-left{left:24px;bottom:24px;}
.ud-bottom-right{right:24px;bottom:24px;}
.ud-top-center{left:50%;top:24px;transform:translate(-50%,-10px);}
.ud-top-center.ud-in{transform:translate(-50%,0);}
.ud-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ud-btn{flex:0 0 auto;border:none;background:#fff;color:#1d1d1d;border-radius:7px;
  padding:6px 13px;font-size:12.5px;font-weight:800;font-family:inherit;cursor:pointer;}
.ud-btn:hover{background:#e9e9e9;}
.ud-bar{position:absolute;left:0;right:0;bottom:0;height:3px;overflow:hidden;
  border-radius:0 0 10px 10px;}
.ud-bar i{display:block;height:100%;background:rgba(255,255,255,.45);
  transform-origin:left center;transform:scaleX(1);}
@media (prefers-reduced-motion:reduce){.ud-toast,.ud-bar i{transition:none!important;}}
`;
  document.head.appendChild(st);
}
