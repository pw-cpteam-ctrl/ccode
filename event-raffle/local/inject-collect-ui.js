/**
 * 수집 패널 — 로컬 실행기로 열었을 때만 화면에 추가되는 부분.
 *
 * 추첨기 본체(index.html)는 한 글자도 고치지 않는다. 이 파일은 로컬 서버가 화면을 보낼 때만
 * 끼워 넣으므로, 인터넷에 올라간 추첨기는 지금과 똑같이 동작한다(파일 올려서 쓰는 방식 그대로).
 *
 * 추첨기 본체가 이미 갖고 있는 값·기능(참가자 목록, 컬럼 자동 추정, 표 그리기 등)을 그대로
 * 가져다 쓴다 — 같은 화면 안의 스크립트라서 이름으로 바로 접근된다.
 */
(() => {
  const 만들기 = (태그, 속성 = {}, 자식들 = []) => {
    const el = document.createElement(태그);
    for (const [k, v] of Object.entries(속성)) {
      if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(자식들)) el.append(c);
    return el;
  };

  const 패널 = 만들기('div', { class: 'step', 'data-accent': 'filter', id: 'localCollectStep' });
  패널.innerHTML = `
    <div class="step-head">
      <span class="num">＋</span>
      <div>
        <h2>인스타에서 바로 수집</h2>
        <p class="desc">게시물 주소만 넣으면 댓글을 직접 읽어와요 — 파일을 받았다 올릴 필요 없어요</p>
      </div>
    </div>
    <div class="step-body">
      <div class="btn-row" style="margin-bottom:12px;">
        <button type="button" class="secondary" id="btnIgLogin">인스타 로그인</button>
        <span class="status" id="igLoginState" style="margin-top:0;">확인 중...</span>
      </div>
      <div class="field">
        <label>게시물 주소</label>
        <input type="text" id="igPostUrl" placeholder="https://www.instagram.com/p/XXXXXXXXX/"/>
      </div>
      <div class="btn-row" style="margin-bottom:12px;">
        <label class="cond-negate-label"><input type="checkbox" id="igOptReplies"/>대댓글(답글)도 수집</label>
        <label class="cond-negate-label"><input type="checkbox" id="igOptSkipOwner" checked/>게시물 주인 댓글 제외</label>
        <label class="cond-negate-label"><input type="checkbox" id="igOptMention"/>친구 소환(@) 댓글 2배</label>
      </div>
      <div class="btn-row">
        <button type="button" id="btnIgCollect">댓글 수집 시작</button>
        <button type="button" class="secondary" id="btnIgCancel" style="display:none;">중지</button>
      </div>
      <div class="warn-box" id="igError"></div>
      <div id="igLogWrap" style="display:none;margin-top:12px;">
        <div class="tbl-hint" style="margin:0 0 6px;">진행 상황</div>
        <pre id="igLog" style="margin:0;max-height:200px;overflow:auto;background:var(--surface-2);
             border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;
             font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;"></pre>
      </div>
    </div>`;

  const 붙이기 = () => {
    const 첫단계 = document.querySelector('.step');
    if (첫단계 && 첫단계.parentNode) 첫단계.parentNode.insertBefore(패널, 첫단계);
    else document.querySelector('.wrap')?.prepend(패널);
  };
  붙이기();

  const $$ = (s) => document.querySelector(s);
  const 오류칸 = $$('#igError');
  const 로그칸 = $$('#igLog');
  const 보이기오류 = (글) => { 오류칸.textContent = 글; 오류칸.style.display = 글 ? 'block' : 'none'; };
  const 로그 = (줄) => {
    $$('#igLogWrap').style.display = '';
    로그칸.textContent += (로그칸.textContent ? '\n' : '') + 줄;
    로그칸.scrollTop = 로그칸.scrollHeight;
  };

  let 진행중 = false;
  const 진행표시 = (켬) => {
    진행중 = 켬;
    $$('#btnIgCollect').disabled = 켬;
    $$('#btnIgLogin').disabled = 켬;
    $$('#btnIgCancel').style.display = 켬 ? '' : 'none';
  };

  async function 상태확인() {
    try {
      const s = await (await fetch('/api/local/status')).json();
      $$('#igLoginState').textContent = s.로그인됨
        ? '로그인되어 있어요 (풀리면 다시 눌러주세요)'
        : '아직 로그인 안 했어요 — 먼저 로그인해주세요';
      $$('#igLoginState').style.color = s.로그인됨 ? 'var(--draw)' : 'var(--warn)';
      진행표시(s.진행중);
    } catch (e) { /* 로컬 서버가 아니면 이 패널 자체가 안 뜸 */ }
  }
  상태확인();

  /* 진행 상황 받기 */
  const 흐름 = new EventSource('/api/local/stream');
  흐름.onmessage = async (e) => {
    const d = JSON.parse(e.data);
    if (d.줄) 로그(d.줄);
    if (d.끝) {
      진행표시(false);
      상태확인();
      if (d.성공 && d.사람수 > 0) await 결과불러오기();
      else if (d.성공) 보이기오류('수집은 끝났는데 읽어온 댓글이 0명이에요. 게시물 주소와 로그인 상태를 확인해주세요.');
    }
  };

  /* 수집 결과를 추첨기에 밀어넣기 — 파일을 올린 것과 똑같은 상태로 만든다.
     같은 결과를 두 번 넣지 않는다 — 넣을 때 아래 단계(후보 목록·당첨자)가 초기화되므로,
     연결이 잠깐 끊겼다 붙는 것만으로 작업 중이던 후보가 날아가면 안 되기 때문. */
  let 이미넣은결과 = null;
  async function 결과불러오기() {
    const r = await fetch('/api/local/result');
    if (!r.ok) return 보이기오류('수집 결과를 가져오지 못했어요.');
    const 결과 = await r.json();
    if (결과.수집id && 결과.수집id === 이미넣은결과) return;   // 같은 결과 재투입 방지
    이미넣은결과 = 결과.수집id || null;
    const 행들 = 결과.행들 || [];
    if (!행들.length) return 보이기오류('읽어온 댓글이 없어요.');

    participants = 행들.map((r) => ({
      아이디: r.아이디, 내용: r.내용, 시간: r.시간, 프로필: r.프로필, 유형: r.유형,
    }));
    lastFileName = `인스타 수집 (${new Date().toLocaleString('ko-KR')})`;
    const 컬럼들 = Object.keys(participants[0]);
    populateColumnSelectors(컬럼들, participants);

    // 우리가 만든 형식이라 어떤 칸이 뭔지 이미 안다 — 자동 추정에 맡기지 않고 직접 지정한다.
    // 특히 "프로필"은 게시물 주소가 아니라 작성자 주소여서, 게시물 링크로 잡히면
    // "필터링된 게시물 보기"가 헛돈다.
    contentColumn = '내용';   $('#selContentCol').value = '내용';
    nicknameColumn = '아이디'; $('#selNicknameCol').value = '아이디';
    postLinkColumn = '';      $('#selPostLinkCol').value = '';
    viewCountColumn = '';     $('#selViewCountCol').value = '';
    updateLengthStats(participants);

    renderTable('#previewWrap', participants.slice(0, 5),
      getMeaningfulColumns(participants, 컬럼들), { onDeleteColumn: removeParticipantColumn });
    resetDownstream();
    pushSlot(snapshotState(), true);

    $('#fileName').textContent = lastFileName;
    const ㄱ = 결과.건너뜀 || {};
    const 덧붙임 = [];
    if (ㄱ.주인댓글) 덧붙임.push(`주인 댓글 ${ㄱ.주인댓글}개 제외`);
    if (ㄱ.본문못읽음 || ㄱ.작성자못찾음) 덧붙임.push(`못 읽어 건너뜀 ${(ㄱ.본문못읽음 || 0) + (ㄱ.작성자못찾음 || 0)}개`);
    if (ㄱ.예비경로사용) 덧붙임.push(`예비 방법으로 읽음 ${ㄱ.예비경로사용}개`);
    $('#uploadStatus').textContent =
      `${participants.length}명 수집 완료 — 인스타 게시물의 댓글 수와 비교해보세요` +
      (덧붙임.length ? ` (${덧붙임.join(' · ')})` : '');
    보이기오류('');
    로그(`추첨기에 ${participants.length}명을 넣었어요. 아래에서 조건을 걸고 추첨하면 됩니다.`);
    패널.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 버튼 동작 */
  $$('#btnIgLogin').addEventListener('click', async () => {
    보이기오류(''); 로그칸.textContent = '';
    진행표시(true);
    const r = await fetch('/api/local/login', { method: 'POST' });
    if (!r.ok) { 보이기오류((await r.json()).error); 진행표시(false); }
  });

  $$('#btnIgCollect').addEventListener('click', async () => {
    보이기오류(''); 로그칸.textContent = '';
    const 주소 = $$('#igPostUrl').value.trim();
    if (!주소) return 보이기오류('게시물 주소를 넣어주세요.');
    진행표시(true);
    const r = await fetch('/api/local/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        주소,
        옵션: {
          대댓글포함: $$('#igOptReplies').checked,
          주인댓글제외: $$('#igOptSkipOwner').checked,
          멘션2배: $$('#igOptMention').checked,
        },
      }),
    });
    if (!r.ok) { 보이기오류((await r.json()).error); 진행표시(false); }
  });

  $$('#btnIgCancel').addEventListener('click', async () => {
    await fetch('/api/local/cancel', { method: 'POST' });
  });
})();
