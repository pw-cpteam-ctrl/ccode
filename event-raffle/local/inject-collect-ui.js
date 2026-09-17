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
        <button type="button" class="secondary" id="btnIgRecover" style="display:none;">직전 수집 결과 불러오기</button>
        <span class="status" id="igRecoverNote" style="margin-top:0;display:none;">
          수집은 끝났는데 화면이 못 받았어요 — 다시 수집하지 않아도 됩니다
        </span>
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
      // 단정하지 않는다 — 여기서 알 수 있는 건 "로그인해둔 게 있다"까지고, 지금도
      // 유효한지는 실제로 인스타에 들어가 봐야 안다. 단정했다가 막상 벽에 막히면
      // 사용자는 프로그램이 거짓말했다고 느낀다.
      $$('#igLoginState').textContent = s.로그인됨
        ? '로그인해둔 게 있어요 — 풀려 있으면 수집 시작할 때 알려드려요'
        : '아직 로그인 안 했어요 — 먼저 로그인해주세요';
      $$('#igLoginState').style.color = s.로그인됨 ? 'var(--draw)' : 'var(--warn)';
      진행표시(s.진행중);
      // 수집 도중에 탭을 닫았거나 새로고침하면, 다 끝난 결과가 서버에만 남고 화면은
      // 그걸 모른 채로 열린다. 그 경우 다시 수집하지 않아도 되도록 되찾기 버튼을 띄운다.
      const 못받은결과 = s.결과있음 && !s.진행중 && s.결과id && s.결과id !== 받아간결과();
      $$('#btnIgRecover').style.display = 못받은결과 ? '' : 'none';
      // 안내 문구는 진행 로그 칸이 아니라 버튼 옆에 둔다 — 로그 칸은 다시 연결될 때
      // 서버가 보내주는 지난 기록으로 통째로 바뀌어서, 거기 적으면 지워진다.
      $$('#igRecoverNote').style.display = 못받은결과 ? '' : 'none';
    } catch (e) { /* 로컬 서버가 아니면 이 패널 자체가 안 뜸 */ }
  }
  상태확인();

  /* 진행 상황 받기 */
  const 흐름 = new EventSource('/api/local/stream');
  흐름.onmessage = async (e) => {
    const d = JSON.parse(e.data);
    // 연결이 다시 붙을 때 서버가 지금까지의 로그를 한 덩어리로 보내준다.
    // 이어 붙이지 않고 통째로 갈아끼워야 같은 줄이 두 벌씩 쌓이지 않는다.
    if (d.지난로그) {
      $$('#igLogWrap').style.display = '';
      로그칸.textContent = d.지난로그.join('\n');
      로그칸.scrollTop = 로그칸.scrollHeight;
      return;
    }
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
     연결이 잠깐 끊겼다 붙는 것만으로 작업 중이던 후보가 날아가면 안 되기 때문.
     새로고침하거나 탭을 닫았다 열어도 "이미 받아갔다"는 사실은 남아야 해서 이 브라우저에
     적어둔다 — 안 그러면 되찾기 버튼이 매번 뜬다. */
  const 받아간키 = 'eventRaffle.local.받아간결과id';
  const 받아간결과 = () => { try { return localStorage.getItem(받아간키) || ''; } catch (e) { return ''; } };
  const 받아감표시 = (id) => { try { localStorage.setItem(받아간키, id || ''); } catch (e) { /* 저장 못해도 동작엔 지장 없음 */ } };

  async function 결과불러오기() {
    const r = await fetch('/api/local/result');
    if (!r.ok) return 보이기오류('수집 결과를 가져오지 못했어요.');
    const 결과 = await r.json();
    if (결과.수집id && 결과.수집id === 받아간결과()) return;   // 같은 결과 재투입 방지
    받아감표시(결과.수집id);
    $$('#btnIgRecover').style.display = 'none';
    $$('#igRecoverNote').style.display = 'none';
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

    /* 일부만 수집된 경우는 반드시 눈에 띄게 알린다. 추첨은 "명단이 전부"라는 전제 위에서만
       공정한데, 모자란 걸 모르고 돌리면 빠진 사람은 애초에 뽑힐 기회조차 없다. */
    if (결과.중간에멈춤) {
      보이기오류(`⚠️ 수집이 도중에 멈췄어요 (${결과.멈춘사유 || '사유 미상'}). `
        + `지금 ${participants.length}명은 그때까지 읽은 것뿐이라 전부가 아닙니다. `
        + `인스타 댓글 수와 비교해보고 모자라면 다시 수집해주세요.`);
    } else if (결과.예상댓글수 && 결과.화면속댓글줄수 < 결과.예상댓글수 * 0.9) {
      보이기오류(`⚠️ 인스타는 댓글이 ${결과.예상댓글수}개라는데 ${결과.화면속댓글줄수}개까지만 읽혔어요. `
        + (결과.로그인유도
          ? '화면에 로그인 안내가 떠 있었어요 — "인스타 로그인"을 다시 하고 시도해보세요.'
          : '로그인 문제는 아니에요. 진행 상황 내용을 그대로 알려주세요.'));
    } else {
      보이기오류('');
    }
    로그(`추첨기에 ${participants.length}명을 넣었어요. 아래에서 조건을 걸고 추첨하면 됩니다.`);
    패널.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 버튼 동작
     서버에 말이 안 통할 때(검은 창을 닫았다든지)를 반드시 받아둔다 — 안 그러면 버튼이
     눌린 채로 잠겨서, 사용자 눈에는 "눌렀는데 아무 반응도 없는" 상태가 된다. */
  async function 서버에요청(길, 보낼것) {
    try {
      const r = await fetch(길, 보낼것
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(보낼것) }
        : { method: 'POST' });
      if (r.ok) return true;
      const 답 = await r.json().catch(() => ({}));
      보이기오류(답.error || '요청을 처리하지 못했어요.');
    } catch (e) {
      보이기오류('추첨기 프로그램과 연결이 끊겼어요. 검은 창이 닫혔는지 확인하고, 닫혔다면 start.bat을 다시 실행해주세요.');
    }
    진행표시(false);
    return false;
  }

  $$('#btnIgLogin').addEventListener('click', async () => {
    보이기오류(''); 로그칸.textContent = '';
    진행표시(true);
    await 서버에요청('/api/local/login');
  });

  $$('#btnIgCollect').addEventListener('click', async () => {
    보이기오류(''); 로그칸.textContent = '';
    const 주소 = $$('#igPostUrl').value.trim();
    if (!주소) return 보이기오류('게시물 주소를 넣어주세요.');
    진행표시(true);
    await 서버에요청('/api/local/collect', {
      주소,
      옵션: {
        대댓글포함: $$('#igOptReplies').checked,
        주인댓글제외: $$('#igOptSkipOwner').checked,
        멘션2배: $$('#igOptMention').checked,
      },
    });
  });

  $$('#btnIgCancel').addEventListener('click', async () => {
    try { await fetch('/api/local/cancel', { method: 'POST' }); } catch (e) { 진행표시(false); }
  });

  // 수집은 끝났는데 화면이 그걸 못 받은 경우(수집 중 탭을 닫았다 다시 연 경우) 되찾기
  $$('#btnIgRecover').addEventListener('click', async () => {
    보이기오류('');
    try { await 결과불러오기(); }
    catch (e) { 보이기오류('결과를 불러오지 못했어요. 다시 수집해야 할 수도 있어요.'); }
  });
})();
