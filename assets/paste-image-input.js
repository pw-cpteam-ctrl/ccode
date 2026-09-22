// 이미지 입력 3종(붙여넣기 Ctrl+V / 드래그드롭 / 파일선택창)을 콜백 하나로 모아주는 유틸리티.
// insta-gen(카드 생성기 ①사진칸)에서 쓰던 걸 다른 프로젝트도 그대로 쓸 수 있게 일반화해서 뺐다.
// state·렌더링 같은 프로젝트별 로직은 전혀 없음 — "이미지 파일이 들어왔다"는 사실만 콜백으로 알려준다.
//
// 사용법:
//   <input type="file" id="file" accept="image/*" hidden>
//   <script src="/assets/paste-image-input.js"></script>
//   <script>
//     setupImageInput({
//       fileInput: document.getElementById('file'),
//       onImages(files){            // files: File 배열(1개 이상), 이미지 파일만 걸러진 상태
//         const url = URL.createObjectURL(files[0]);
//         const img = new Image();
//         img.onload = () => { /* 프로젝트별 로드 로직 */ };
//         img.onerror = () => { /* 손상된 파일 — 반드시 처리할 것, 안 하면 무한 대기 버그가 남 */ };
//         img.src = url;
//       },
//     });
//   </script>
//
// 옵션:
//   fileInput   - <input type=file> 엘리먼트. change 이벤트를 연결한다(생략 가능).
//   dropTarget  - 드롭을 받을 엘리먼트. 생략하면 document 전체(페이지 어디에 놓아도 받음).
//   pasteTarget - 붙여넣기를 받을 엘리먼트. 생략하면 document 전체.
//   onImages(files, meta) - 이미지가 들어올 때마다 호출. meta.source는 'file'|'drop'|'paste' 중 하나.
//
// 주의: 파일 인풋 change 이벤트 뒤에는 반드시 e.target.value=''로 리셋해야 같은 파일을
//       두 번 연속 골라도(취소 후 재선택 등) change가 다시 발생한다 — 이 유틸이 자동으로 처리함.
function setupImageInput({ fileInput, dropTarget, pasteTarget, onImages }){
  if(typeof onImages !== 'function') throw new Error('setupImageInput: onImages 콜백이 필요합니다');

  const onlyImages = list => [...list].filter(f => f && f.type && f.type.startsWith('image/'));

  if(fileInput){
    fileInput.addEventListener('change', e => {
      const imgs = onlyImages(e.target.files);
      if(imgs.length) onImages(imgs, { source:'file' });
      e.target.value = ''; // 같은 파일 재선택해도 change가 다시 뜨게
    });
  }

  const dropEl = dropTarget || document;
  // dragover도 막아야 브라우저가 기본 동작(새 탭으로 이미지 열기)을 안 한다.
  dropEl.addEventListener('dragover', e => e.preventDefault());
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    const imgs = onlyImages(e.dataTransfer?.files || []);
    if(imgs.length) onImages(imgs, { source:'drop' });
  });

  const pasteEl = pasteTarget || document;
  pasteEl.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])].filter(i => i.type && i.type.startsWith('image/'));
    if(!items.length) return;
    const imgs = items.map(i => i.getAsFile()).filter(Boolean);
    if(imgs.length) onImages(imgs, { source:'paste' });
  });
}
