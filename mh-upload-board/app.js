// 메가하우스 업로드 보드 — 월별 회차 하나를 D-7 ~ D+30까지 한 화면에서 관리한다.
// 저장은 브라우저(localStorage)에만 한다. 컴퓨터를 옮기거나 팀원에게 넘길 땐 "백업 내려받기" 파일을 쓴다.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const STORE_KEY = 'mhUploadBoard.v1';
const TIERS = ['S','A','B','C','미정'];
const TIER_NAME = {S:'최상위', A:'주요', B:'일반', C:'비인기', '미정':'정렬 필요'};
const TCLS = t => t === '미정' ? 'tU' : 't' + t;
const REMIND_TIERS = ['S','A'];
const CHANNELS = ['ig','tw'];
const CH_NAME = {ig:'인스타', tw:'트위터'};
const WEEK = ['일','월','화','수','목','금','토'];

// 바로가기 — 주소를 아는 도구만 버튼을 띄운다
const TOOL_URL = {
  '마토메 메이커': '../megahouse-matome/index.html',
  '크리에이터 가이드': 'https://pw-creator-guide.vercel.app/',
  '인플루언서 관리': 'https://pw-creator-guide.vercel.app/reward-view-admin',
};

// 둘러보기용 예시 데이터 (실제 회차에는 들어가지 않음)
const SAMPLE = [
  ['원피스','G.E.M. 시리즈','몽키 D. 루피 기어5','☀️',0,'S'],['나루토 질풍전','G.E.M. 시리즈','우즈마키 나루토 선인모드','🍥',1,'S'],
  ['주술회전','룩업','고죠 사토루','👁️',1,'S'],['원피스','Portrait.Of.Pirates','로로노아 조로','⚔️',0,'S'],['블루록','룩업','이사기 요이치','⚽',0,'S'],
  ['귀멸의 칼날','G.E.M. 테노히라','카마도 탄지로','🔥',1,'A'],['하이큐!!','룩업','히나타 쇼요','🏐',1,'A'],['주술회전','메가캣 프로젝트','냥술회전 세트','🐱',0,'A'],
  ['체인소맨','룩업','파워','🩸',0,'A'],['은혼','룩업','사카타 긴토키','🍓',1,'A'],['진격의 거인','룩업','리바이','🗡️',1,'B'],
  ['명탐정 코난','룩업','에도가와 코난','🔍',0,'B'],['원피스','로그박스','나미','🍊',0,'B'],['스파이 패밀리','룩업','아냐 포저','🥜',1,'C'],['헌터×헌터','룩업','곤 프릭스','🎣',0,'C'],
];

const STAGES = [
  { key:'d7', d:'D-7', from:-7, to:-7, title:'프리뷰 공개',
    desc:'본사 프리뷰 리스트가 뜨는 날. 이 리스트는 확정본이 아니라서, D-1 발주서가 오면 다시 맞춥니다.',
    tasks:[
      {id:'d7_paste', label:'본사 프리뷰 리스트(번역본) 붙여넣기', act:{label:'붙여넣기', g:'paste'}},
      {id:'d7_trans', label:'프리뷰 리스트 번역'},
      {id:'d7_sort',  label:'인기도 정렬 — 등급(S~C) 나누고 순위 정하기'},
      {id:'d7_matome',label:'마토메 프리뷰용 제작', tool:'마토메 메이커', act:{label:'작품명 복사', g:'copyMatome'}},
      {id:'d7_notice',label:'프리뷰 공지 원고 올리기 (전체 1건)'},
    ]},
  { key:'prep', d:'D-6 ~ D-2', from:-6, to:-2, title:'준비 기간',
    desc:'재판 상품은 이때 미리 확보할 수 있고, 초판은 D-2~D-1까지 기다려야 합니다.',
    tasks:[
      {id:'pr_secure', label:'재판 상품 미리 확보'},
      {id:'pr_carousel', label:'캐러셀 제작'},
      {id:'pr_matome', label:'마토메 오픈용 제작', tool:'마토메 메이커', act:{label:'작품명 복사', g:'copyMatome'}},
      {id:'pr_guide', label:'크리에이터 가이드 업데이트', tool:'크리에이터 가이드'},
      {id:'pr_talk', label:'네이버 톡톡 디자인 준비'},
      {id:'pr_influ', label:'인플루언서 진행 상황 체크', tool:'인플루언서 관리'},
    ]},
  { key:'d1', d:'D-1', from:-1, to:-1, title:'발주서 도착',
    desc:'발주서 기준으로 목록을 다시 맞추는 날. 없던 상품이 생기고 있던 상품이 빠집니다.',
    tasks:[
      {id:'d1_order', label:'발주서 엑셀 올려서 D-7 리스트와 대조', act:{label:'발주서 올리기', g:'order', primary:true}},
      {id:'d1_rank', label:'새로 생긴 상품 정보·등급·순위 정하기'},
      {id:'d1_first', label:'초판 상품 확보'},
      {id:'d1_links', label:'스마트스토어 상품 링크 모으기', act:{label:'한번에 붙여넣기', g:'links'}},
    ]},
  { key:'d0', d:'D-0', from:0, to:13, title:'스토어 오픈',
    desc:'상품별 인스타·트위터 원고를 올리는 날. 순위가 높은 상품부터 준비합니다.',
    tasks:[
      {id:'d0_ig', label:'인스타 원고 올리기 (상품별)'},
      {id:'d0_tw', label:'트위터 원고 올리기 (상품별)'},
      {id:'d0_talk', label:'네이버 톡톡 메시지 발송'},
      {id:'d0_matome', label:'마토메 오픈용 올리기', tool:'마토메 메이커'},
      {id:'d0_influ', label:'인플루언서 진행 상황 체크', tool:'인플루언서 관리'},
    ]},
  { key:'d14', d:'D+14', from:14, to:29, title:'리마인드',
    desc:'주요 상품(S·A 등급)만 리마인드합니다. 등급을 바꾸면 여기 원고 개수도 같이 바뀝니다.',
    tasks:[{id:'d14_ig', label:'인스타 리마인드 올리기'},{id:'d14_tw', label:'트위터 리마인드 올리기'}]},
  { key:'d30', d:'D+30', from:30, to:30, title:'마감임박',
    desc:'예약 마감 직전 리마인드. 역시 S·A 등급만 대상입니다.',
    tasks:[{id:'d30_ig', label:'인스타 마감임박 올리기'},{id:'d30_tw', label:'트위터 마감임박 올리기'}]},
];
const DRAFT_STAGES = ['d0','d14','d30'];

/* ---------- 저장 ---------- */
let seq = 0;
const newId = () => 'p' + Date.now().toString(36) + (seq++).toString(36);

function normProduct(p){
  return {
    id: p?.id ?? newId(), ip: p?.ip ?? '', series: p?.series ?? '', name: p?.name ?? '', emoji: p?.emoji ?? '',
    reprint: !!p?.reprint, tier: TIERS.includes(p?.tier) ? p.tier : '미정', link: p?.link ?? '',
    status: ['normal','new','removed'].includes(p?.status) ? p.status : 'normal', secured: !!p?.secured,
  };
}
function normRound(r){
  return {
    id: r?.id ?? String(Date.now()), openDate: r?.openDate ?? todayStr(),
    products: Array.isArray(r?.products) ? r.products.map(normProduct) : [],
    orderChecked: !!r?.orderChecked, drafts: r?.drafts ?? {}, tasks: r?.tasks ?? {},
  };
}
function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

let store = {current:null, rounds:{}};
function loadStore(){
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw.rounds === 'object'){
      for (const [k, r] of Object.entries(raw.rounds)) store.rounds[k] = normRound({...r, id:k});
      store.current = raw.current in store.rounds ? raw.current : Object.keys(store.rounds)[0] ?? null;
    }
  } catch (e) { console.warn('저장본 읽기 실패', e); }
  if (!store.current){ const r = normRound({openDate: nextOpenDate()}); store.rounds[r.id] = r; store.current = r.id; }
}
let saveOk = true;
function save(){
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); saveOk = true; }
  catch (e) { saveOk = false; console.error(e); }
  const el = $('#saveState');
  const t = new Date();
  el.className = 'save' + (saveOk ? '' : ' fail');
  el.textContent = saveOk ? `저장됨 ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}` : '저장 실패 — 백업 내려받기로 지금 상태를 보관하세요';
}
let saveT = null; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; save(); }, 400); };

const R = () => store.rounds[store.current];
const P = () => R().products;

/* ---------- 날짜 ---------- */
function parseDate(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(s, n){ const d = parseDate(s); d.setDate(d.getDate() + n); return d; }
const fmt = d => `${d.getMonth()+1}/${d.getDate()} (${WEEK[d.getDay()]})`;
function stageDate(s){ const o = R().openDate; return s.from === s.to ? fmt(addDays(o, s.from)) : `${fmt(addDays(o, s.from))} – ${fmt(addDays(o, s.to))}`; }
function currentStageKey(){
  const diff = Math.round((parseDate(todayStr()) - parseDate(R().openDate)) / 86400000);
  if (diff <= -7) return 'd7';
  if (diff <= -2) return 'prep';
  if (diff === -1) return 'd1';
  if (diff < 14) return 'd0';
  if (diff < 30) return 'd14';
  return 'd30';
}
function nextOpenDate(){ const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
const roundLabel = r => { const d = parseDate(r.openDate); return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월 회차`; };

/* ---------- 계산 ---------- */
const idx = id => P().findIndex(p => p.id === id);
const byId = id => P().find(p => p.id === id);
const active = () => P().filter(p => p.status !== 'removed');
const ranked = () => active().filter(p => p.tier !== '미정');
function ranks(){ const m = {}; let n = 0; for (const p of P()){ if (p.status === 'removed' || p.tier === '미정') continue; m[p.id] = ++n; } return m; }
function tierSort(){ R().products = P().map((p,i)=>[p,i]).sort((a,b)=>TIERS.indexOf(a[0].tier)-TIERS.indexOf(b[0].tier)||a[1]-b[1]).map(x=>x[0]); }

const tag = s => s ? '#' + s.replace(/[\s!×.·,'"()]/g, '') : '';
const nm = p => `${p.name}${p.reprint ? ' (재판)' : ''}${p.emoji ? ' ' + p.emoji : ''}`;
const tags = p => ['#메가하우스공식스토어','#메가하우스','#프레젠스월드', tag(p.ip), tag(p.series)].filter(Boolean).join(' ');
const head = p => [p.ip, p.series].filter(Boolean).join(' ');
const IG_LINK = '🛒 구매는 프로필 링크를 참고해주세요';
const linkLine = (ch, p) => ch === 'ig' ? IG_LINK : (p.link || '(링크 없음)');

function gen(kind, ch, p){
  if (kind === 'notice'){
    const r = ranked(), top = r.slice(0, 6), m = parseDate(R().openDate);
    return `📢[${m.getMonth()+1}월 신상품 프리뷰] 메가하우스 ${m.getMonth()+1}월 예약 라인업 미리보기\n\n${top.map(x => `▪️ ${x.ip} ${x.name}${x.emoji ? ' ' + x.emoji : ''}`).join('\n')}${r.length > top.length ? `\n외 ${r.length - top.length}종` : ''}\n\n📅 예약 오픈: ${m.getMonth()+1}월 ${m.getDate()}일(${WEEK[m.getDay()]})\n\n#메가하우스공식스토어 #메가하우스 #프레젠스월드`;
  }
  if (kind === 'd0') return `📢[예약시작] ${head(p)}\n\n${nm(p)}\n${linkLine(ch, p)}\n\n📍발매: 26년 ⚫월\n📍예약판매 기간 내 5% 할인 캠페인 중!\n\n${tags(p)}`;
  if (kind === 'd14') return `⏰[예약 진행중] ${head(p)}\n\n${nm(p)}\n${linkLine(ch, p)}\n\n📍예약 마감까지 약 2주 남았어요\n📍예약판매 기간 내 5% 할인 캠페인 중!\n\n${tags(p)}`;
  if (kind === 'd30') return `🚨[마감임박] ${head(p)}\n\n${nm(p)}\n${linkLine(ch, p)}\n\n📍곧 예약이 마감됩니다. 놓치지 마세요!\n\n${tags(p)}`;
  return '';
}

// 트위터 길이: 한글·이모지 2, 영문·숫자 1, 링크는 길이와 무관하게 23 → 한도 280을 "140자"로 환산
function twLen(t){
  let w = 0;
  t = t.replace(/https?:\/\/\S+/g, () => { w += 23; return ''; });
  for (const c of t) w += c.codePointAt(0) <= 0x10FF ? 1 : 2;
  return Math.ceil(w / 2);
}
const lenInfo = (ch, text) => ch === 'ig' ? {len:[...text].length, lim:2200, unit:'자 (인스타)'} : {len:twLen(text), lim:140, unit:'자'};

function draftList(sk, ch){
  const out = [];
  if (sk === 'd7') out.push({key:'d7:notice', kind:'notice', ch:'tw', p:null});
  if (DRAFT_STAGES.includes(sk)){
    const list = sk === 'd0' ? active() : active().filter(p => REMIND_TIERS.includes(p.tier));
    for (const c of (ch ? [ch] : CHANNELS)) for (const p of list) out.push({key:`${sk}:${c}:${p.id}`, kind:sk, ch:c, p});
  }
  return out;
}
const dText = d => R().drafts[d.key]?.text ?? gen(d.kind, d.ch, d.p);
const isDone = key => !!R().drafts[key]?.done;

function stageProgress(s){
  const td = s.tasks.filter(t => R().tasks[t.id]).length;
  const dl = draftList(s.key); const dd = dl.filter(d => isDone(d.key)).length;
  return {td, tt:s.tasks.length, dd, dt:dl.length};
}

function taskHint(id){
  const a = active();
  const nolink = a.filter(p => !p.link).length;
  const unsorted = a.filter(p => p.tier === '미정').length;
  const cnt = (sk, ch) => { const l = draftList(sk, ch); const n = l.filter(d => isDone(d.key)).length; return {c: l.length && n === l.length ? 'ok' : 'info', t:`확정 ${n}/${l.length}`}; };
  switch (id){
    case 'd7_paste': return {c: P().length ? 'info' : 'warn', t: P().length ? `${P().length}개 들어옴` : '비어 있음'};
    case 'd7_sort': return !a.length ? null : unsorted ? {c:'warn', t:`미정 ${unsorted}개 남음`} : {c:'ok', t:'정렬 완료'};
    case 'd7_notice': return isDone('d7:notice') ? {c:'ok', t:'원고 확정'} : {c:'info', t:'원고 미확정'};
    case 'pr_secure': { const r = a.filter(p => p.reprint); return r.length ? {c: r.every(p => p.secured) ? 'ok' : 'warn', t:`재판 확보 ${r.filter(p => p.secured).length}/${r.length}`} : null; }
    case 'd1_order': return R().orderChecked ? {c:'ok', t:`신규 ${P().filter(p => p.status === 'new').length} · 빠짐 ${P().filter(p => p.status === 'removed').length}`} : {c:'warn', t:'아직 안 올림'};
    case 'd1_rank': { if (!R().orderChecked) return {c:'info', t:'발주서 대조 후'}; const n = P().filter(p => p.status === 'new' && (p.tier === '미정' || !p.ip)).length; return n ? {c:'warn', t:`정리 필요 ${n}개`} : {c:'ok', t:'정리됨'}; }
    case 'd1_first': { const f = a.filter(p => !p.reprint); return f.length ? {c: f.every(p => p.secured) ? 'ok' : 'warn', t:`초판 확보 ${f.filter(p => p.secured).length}/${f.length}`} : null; }
    case 'd1_links': return !a.length ? null : nolink ? {c:'warn', t:`링크 ${a.length - nolink}/${a.length}`} : {c:'ok', t:`링크 ${a.length}/${a.length}`};
  }
  const m = id.match(/^(d0|d14|d30)_(ig|tw)$/);
  return m ? cnt(m[1], m[2]) : null;
}

/* ---------- 화면 상태 ---------- */
let stageKey = 'd0', filter = 'all';
const chBy = {d0:'tw', d14:'tw', d30:'tw'};
let onlyOpen = false;
const openEdit = new Set();
let armedDelete = null;
let dragId = null;

/* ---------- 그리기 ---------- */
function renderHeader(){
  const ids = Object.keys(store.rounds).sort((a,b) => store.rounds[b].openDate.localeCompare(store.rounds[a].openDate));
  $('#roundSel').innerHTML = ids.map(id => `<option value="${id}" ${id === store.current ? 'selected' : ''}>${roundLabel(store.rounds[id])}</option>`).join('');
  $('#openDate').value = R().openDate;
}

function renderTimeline(){
  const cur = currentStageKey();
  $('#timeline').innerHTML = STAGES.map(s => {
    const g = stageProgress(s);
    const tot = g.tt + g.dt, done = g.td + g.dd;
    const pct = tot ? Math.round(done / tot * 100) : 0;
    return `<button class="st ${s.key === stageKey ? 'sel' : ''}" data-stage="${s.key}" aria-current="${s.key === stageKey}">
      <span class="d">${s.d}${s.key === cur ? '<span class="today">오늘</span>' : ''}</span>
      <span class="t">${s.title}</span>
      <span class="date">${stageDate(s)}</span>
      <span class="prog num">할 일 ${g.td}/${g.tt}${g.dt ? ` · 원고 ${g.dd}/${g.dt}` : ''}</span>
      <span class="meter"><i style="width:${pct}%"></i></span>
    </button>`;
  }).join('');
}

function passFilter(p){
  if (filter === 'nolink') return p.status !== 'removed' && !p.link;
  if (filter === 'diff') return p.status !== 'normal';
  if (filter === 'unsecured') return p.status !== 'removed' && !p.secured;
  return true;
}

function editPanel(p){
  const armed = armedDelete === p.id;
  return `<div class="pedit" data-id="${p.id}">
    <label>작품명<input type="text" id="e-ip-${p.id}" data-f="ip" value="${esc(p.ip)}" placeholder="예: 원피스"></label>
    <label>시리즈<input type="text" id="e-series-${p.id}" data-f="series" value="${esc(p.series)}" placeholder="예: 룩업"></label>
    <label>상품명<input type="text" id="e-name-${p.id}" data-f="name" value="${esc(p.name)}"></label>
    <label>상징 이모지<input type="text" id="e-emoji-${p.id}" data-f="emoji" value="${esc(p.emoji)}" placeholder="예: ⚔️"></label>
    <label class="full">스마트스토어 링크<input type="text" id="e-link-${p.id}" data-f="link" value="${esc(p.link)}" placeholder="https://smartstore.naver.com/…"></label>
    <div class="acts">
      <label class="chk"><input type="checkbox" id="e-re-${p.id}" data-f="reprint" ${p.reprint ? 'checked' : ''}> 재판</label>
      <span class="sp"></span>
      <button class="btn small danger ${armed ? 'armed' : ''}" data-act="del">${armed ? '한 번 더 누르면 삭제' : '상품 삭제'}</button>
      <button class="btn small primary" data-act="close">닫기</button>
    </div>
  </div>`;
}

function renderList(){
  const a = active(), r = ranks();
  const nolink = a.filter(p => !p.link).length, unsorted = a.filter(p => p.tier === '미정').length;
  const nNew = P().filter(p => p.status === 'new').length, nRem = P().filter(p => p.status === 'removed').length;
  $('#stats').innerHTML = !P().length ? '<span>아직 상품이 없어요</span>' : [
    `<span><b class="num">${a.length}</b>개</span>`,
    `<span>재판 <b class="num">${a.filter(p => p.reprint).length}</b> · 초판 <b class="num">${a.filter(p => !p.reprint).length}</b></span>`,
    `<span class="${nolink ? 'warn' : 'ok'}">링크 <b class="num">${a.length - nolink}/${a.length}</b></span>`,
    unsorted ? `<span class="warn">등급 미정 <b class="num">${unsorted}</b></span>` : '',
    R().orderChecked ? `<span class="ok">발주서 신규 <b class="num">${nNew}</b></span><span class="bad">빠짐 <b class="num">${nRem}</b></span>` : `<span class="warn"><b>발주서 대조 전</b> · D-7 기준 목록</span>`,
  ].join('');

  const F = [['all','전체'],['nolink',`링크 없음 ${nolink}`],['diff','발주서 변동'],['unsecured','미확보']];
  $('#filterSeg').innerHTML = F.map(([k,l]) => `<button data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join('');

  if (!P().length){
    $('#plist').innerHTML = `<div class="emptyst"><b>이번 회차 상품이 비어 있어요</b>
      <span>본사 프리뷰 리스트(번역본)를 붙여넣으면 시작됩니다. 등급과 순위는 그다음에 정합니다.</span>
      <div class="row-flex"><button class="btn primary" data-g="paste">D-7 리스트 붙여넣기</button><button class="btn" data-g="sample">예시 데이터로 둘러보기</button></div></div>`;
    return;
  }

  let html = '';
  for (const t of TIERS){
    const all = P().filter(p => p.tier === t);
    if (t === '미정' && !all.length) continue;
    const items = all.filter(passFilter);
    if (filter !== 'all' && !items.length) continue;
    html += `<div class="tier-h ${t === '미정' ? 'U' : ''}" data-tier="${t}"><span class="tchip ${TCLS(t)}">${t === '미정' ? '?' : t}</span>${TIER_NAME[t]} <span class="cnt num">${all.filter(p => p.status !== 'removed').length}개</span>${REMIND_TIERS.includes(t) ? '<span class="note">리마인드 대상</span>' : ''}</div>`;
    if (!items.length){ html += `<div class="empty-drop" data-tier="${t}">여기로 끌어다 놓으면 ${t} 등급이 됩니다</div>`; continue; }
    html += '<div class="rows">';
    for (const p of items){
      const rem = p.status === 'removed';
      html += `<div class="row ${rem ? 'removed' : ''} ${p.status === 'new' ? 'is-new' : ''}" draggable="true" data-id="${p.id}">
        <span class="grip" aria-hidden="true">⋮⋮</span>
        <span class="rank">${r[p.id] ?? '—'}</span>
        <button class="pname-btn" data-act="edit" aria-expanded="${openEdit.has(p.id)}" title="눌러서 상품 정보 고치기">
          <div class="pmeta">${esc([p.ip, p.series].filter(Boolean).join(' · ') || '작품명·시리즈 비어 있음')}</div>
          <div class="pname">${esc(p.name || '(이름 없음)')} ${esc(p.emoji)}</div>
          <div class="badges">${p.reprint ? '<span class="b b-re">재판</span>' : '<span class="b b-first">초판</span>'}${p.status === 'new' ? '<span class="b b-new">발주서에서 새로 생김</span>' : ''}${rem ? '<span class="b b-bad">발주서에서 빠짐 · 원고 제외</span>' : ''}</div>
        </button>
        <div class="pside">
          <select class="tiersel" data-act="tier" aria-label="${esc(p.name)} 등급">${TIERS.map(x => `<option value="${x}" ${x === p.tier ? 'selected' : ''}>${x}</option>`).join('')}</select>
          ${rem ? '' : `<button class="chip ${p.secured ? 'ok' : 'wait'}" data-act="secure" title="눌러서 확보 상태 바꾸기">${p.secured ? '확보' : '확보 대기'}</button>
          <button class="chip ${p.link ? 'ok' : 'warn'}" data-act="edit" title="눌러서 링크 넣기">${p.link ? '링크 ✓' : '링크 없음'}</button>`}
        </div>
        <div class="updown"><button data-act="up" aria-label="한 칸 위로">▲</button><button data-act="down" aria-label="한 칸 아래로">▼</button></div>
      </div>`;
      if (openEdit.has(p.id)) html += editPanel(p);
    }
    html += '</div>';
  }
  html += `<div class="addrow"><button class="btn small" data-g="addProduct">+ 상품 직접 추가</button></div>`;
  $('#plist').innerHTML = html;
}

function draftCard(d){
  const p = d.p, r = ranks();
  const text = dText(d), done = isDone(d.key), edited = R().drafts[d.key]?.text != null;
  const L = lenInfo(d.ch, text);
  const nolink = p && !p.link && d.ch === 'tw';
  return `<article class="dcard ${done ? 'done' : ''}" data-key="${d.key}">
    <header>
      ${p ? `<span class="rank">${r[p.id] ?? '—'}</span><span class="tchip ${TCLS(p.tier)}">${p.tier === '미정' ? '?' : p.tier}</span><div style="min-width:0"><div class="pmeta">${esc([p.ip, p.series].filter(Boolean).join(' · '))}</div><div class="pname">${esc(p.name)} ${esc(p.emoji)}</div></div>`
          : `<span class="tchip tS">공지</span><span></span><div><div class="pname">프리뷰 공지 (전체 1건)</div><div class="pmeta">순위 상위 6개가 자동으로 들어갑니다</div></div>`}
      ${(p && (p.status === 'new' || nolink)) ? `<div class="badges">${p.status === 'new' ? '<span class="b b-new">발주서 신규 상품</span>' : ''}${nolink ? '<span class="b b-warn">링크 없음 — 원고에 (링크 없음)으로 들어감</span>' : ''}</div>` : ''}
    </header>
    <textarea id="ta-${d.key.replace(/:/g,'-')}" data-key="${d.key}" data-ch="${d.ch}" aria-label="원고">${esc(text)}</textarea>
    <footer>
      <span class="cnt ${L.len > L.lim ? 'over' : ''}" data-cnt>${L.len}/${L.lim}${L.unit}</span>
      ${edited ? '<button class="linkbtn" data-act="regen" title="직접 고친 내용을 버리고 기본 틀로 다시 만듭니다">기본 틀로 다시</button>' : ''}
      <span class="sp"></span>
      <button class="btn small" data-act="copy">복사</button>
      <button class="btn small confirm" data-act="done" aria-pressed="${done}">${done ? '확정됨 ✓' : '확정'}</button>
    </footer>
  </article>`;
}

function renderStage(){
  const col = $('#stageCol'), sc = col.scrollTop;
  const s = STAGES.find(x => x.key === stageKey);
  let html = `<div class="stage-body">
    <div><div class="stage-title"><span class="dd">${s.d}</span><h2>${s.title}</h2><span class="date">${stageDate(s)}</span></div>
    <p class="stage-desc">${s.desc}</p></div>`;

  const orphan = P().filter(p => p.status === 'removed' && CHANNELS.some(c => isDone(`${stageKey}:${c}:${p.id}`)));
  if (orphan.length) html += `<div class="alert bad"><b>확정해 둔 원고 중 발주서에서 빠진 상품 ${orphan.length}개</b> ${orphan.map(p => esc(p.name)).join(', ')} — 올리지 마세요. 목록에서는 자동으로 뺐습니다.</div>`;

  html += `<div class="box"><div class="box-h">할 일 <span class="sub num">${s.tasks.filter(t => R().tasks[t.id]).length}/${s.tasks.length}</span></div><div class="tasks">`;
  for (const t of s.tasks){
    const h = taskHint(t.id), on = !!R().tasks[t.id];
    const url = t.tool && TOOL_URL[t.tool];
    html += `<div class="task ${on ? 'checked' : ''}">
      <input type="checkbox" id="tk-${t.id}" data-task="${t.id}" ${on ? 'checked' : ''}>
      <label for="tk-${t.id}">${t.label}</label>
      <div class="acts">${h ? `<span class="hint ${h.c}">${h.t}</span>` : ''}${t.act ? `<button class="btn small ${t.act.primary && !R().orderChecked ? 'primary' : ''}" data-g="${t.act.g}">${t.act.label}</button>` : ''}${url ? `<a class="btn small" href="${url}" target="_blank" rel="noopener">${t.tool} ↗</a>` : ''}</div>
    </div>`;
  }
  html += '</div></div>';

  if (DRAFT_STAGES.includes(s.key)){
    const ch = chBy[s.key];
    const l = draftList(s.key, ch).filter(d => !onlyOpen || !isDone(d.key));
    const sub = s.key === 'd0' ? '순위순 · 상품별' : `S·A 등급만 · 순위순 · 비인기 제외 · 임시 틀`;
    html += `<div class="box"><div class="box-h">원고 <span class="sub">${sub}</span></div>
      <div class="dtools">
        <div class="seg" role="group" aria-label="채널">
          ${CHANNELS.map(c => { const all = draftList(s.key, c); return `<button data-ch="${c}" aria-pressed="${ch === c}">${CH_NAME[c]} ${all.filter(d => isDone(d.key)).length}/${all.length}</button>`; }).join('')}
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--sub)"><input type="checkbox" id="onlyOpen" ${onlyOpen ? 'checked' : ''}> 확정 안 한 것만</label>
        <span class="sp"></span>
        <span style="font-size:12px;color:var(--faint)">${ch === 'ig' ? '인스타는 링크 대신 "프로필 링크 참고" 문구가 들어갑니다' : '트위터 140자 기준'}</span>
      </div>
      ${!draftList(s.key, ch).length ? `<div class="nodraft">${s.key === 'd0' ? '상품 목록이 비어 있어요.' : 'S·A 등급 상품이 없어요. 목록에서 주요 상품의 등급을 정해 주세요.'}</div>`
        : l.length ? `<div class="dgrid">${l.map(draftCard).join('')}</div>` : '<div class="nodraft">남은 원고가 없어요. 전부 확정했습니다.</div>'}</div>`;
  } else if (s.key === 'd7'){
    html += `<div class="box"><div class="box-h">원고 <span class="sub">전체 공지 1건 · 임시 틀</span></div>
      <div class="dgrid">${draftList('d7').map(draftCard).join('')}</div></div>`;
  } else {
    html += `<div class="box"><div class="nodraft">이 시점에 올릴 원고는 없습니다. 여기서 정리한 목록·링크가 D-0 원고에 그대로 들어갑니다.</div></div>`;
  }
  html += '</div>';
  col.innerHTML = html;
  col.scrollTop = sc;
}

function renderBar(){
  const a = active(), nolink = a.filter(p => !p.link).length;
  let sum = '', acts = '';
  if (DRAFT_STAGES.includes(stageKey)){
    const ch = chBy[stageKey];
    sum = `<span class="sum">${STAGES.find(s => s.key === stageKey).d} 원고 확정 — ${CHANNELS.map(c => { const l = draftList(stageKey, c); return `${CH_NAME[c]} <b class="num">${l.filter(d => isDone(d.key)).length}/${l.length}</b>`; }).join(' · ')}</span>`;
    if (nolink && ch === 'tw') sum += `<span class="w">링크 없는 상품 ${nolink}개 — 트위터 원고에 '(링크 없음)'으로 들어가 있어요</span>`;
    acts = `${nolink && ch === 'tw' ? '<button class="btn" data-g="links">링크 한번에 붙여넣기</button>' : ''}<button class="btn primary" data-g="copyAll">${CH_NAME[ch]} 원고 전체 복사</button>`;
  } else if (stageKey === 'd7'){
    sum = `<span class="sum">공지 원고 ${isDone('d7:notice') ? '<b>확정됨</b>' : '<b>미확정</b>'}</span>`;
    acts = `<button class="btn" data-g="copyMatome">마토메용 작품명 복사</button><button class="btn primary" data-g="copyAll">공지 원고 복사</button>`;
  } else if (stageKey === 'd1'){
    sum = `<span class="sum">발주서 <b>${R().orderChecked ? '대조 완료' : '대조 전'}</b> · 링크 <b class="num">${a.length - nolink}/${a.length}</b></span>`;
    acts = `<button class="btn" data-g="links">링크 한번에 붙여넣기</button><button class="btn ${R().orderChecked ? '' : 'primary'}" data-g="order">발주서 올리기</button>`;
  } else {
    const g = stageProgress(STAGES[1]);
    sum = `<span class="sum">준비 기간 할 일 <b class="num">${g.td}/${g.tt}</b></span>`;
    acts = `<button class="btn primary" data-g="copyMatome">마토메용 작품명 복사</button>`;
  }
  $('#bar').innerHTML = `${sum}<span class="sp"></span>${acts}`;
}

function renderAll(){ renderHeader(); renderTimeline(); renderList(); renderStage(); renderBar(); }
function commit(){ renderAll(); saveSoon(); }

/* ---------- 도우미 ---------- */
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }

function openModal(title, body, buttons, why){
  $('#mTitle').textContent = title;
  $('#mBody').innerHTML = body;
  const f = $('#mFoot'); f.innerHTML = why ? `<span class="why">${why}</span>` : '';
  buttons.forEach(b => { const el = document.createElement('button'); el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''); el.textContent = b.label; if (b.disabled) el.disabled = true; el.onclick = b.fn || closeModal; f.appendChild(el); });
  $('#scrim').hidden = false;
  const first = $('#mBody').querySelector('textarea,input,select') || f.querySelector('button:last-child');
  first && first.focus();
}
function closeModal(){ $('#scrim').hidden = true; }
$('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#scrim').hidden) closeModal(); });

function copyText(text, msg){
  const fallback = () => { openModal('직접 복사해 주세요', `<p>자동 복사가 막혀 있어요. 아래 내용이 전부 선택돼 있으니 Ctrl+C 하면 됩니다.</p><textarea id="copyTa" readonly>${esc(text)}</textarea>`, [{label:'닫기'}]); setTimeout(() => $('#copyTa')?.select(), 0); };
  try { navigator.clipboard.writeText(text).then(() => toast(msg), fallback); } catch { fallback(); }
}

const norm = s => String(s ?? '').replace(/\(재판\)|再販/g, '').replace(/[\s!！?？・·.,，、:：;'"「」『』()（）\[\]【】\-–—~〜_/]/g, '').toLowerCase();
function nameMatch(p, raw){
  const n = norm(raw); if (!n) return false;
  return [norm(p.name), norm(p.ip + p.name), norm(p.ip + p.series + p.name)].some(c => c && (c === n || (c.length >= 3 && n.includes(c)) || (n.length >= 3 && c.includes(n))));
}

/* ---------- 순서·등급 ---------- */
function moveRel(id, tid, after){
  if (id === tid) return;
  const list = P(); const [p] = list.splice(idx(id), 1);
  p.tier = byId(tid).tier;
  list.splice(idx(tid) + (after ? 1 : 0), 0, p);
}
function moveToTier(id, tier){ const list = P(); const [p] = list.splice(idx(id), 1); p.tier = tier; list.push(p); tierSort(); }
// 같은 등급 안에서는 한 칸씩, 등급의 맨 끝에서 더 누르면 바로 옆 등급(비어 있어도)으로 넘어간다
function nudge(id, dir){
  const list = P(), i = idx(id), p = list[i], q = list[i + dir];
  if (q && q.tier === p.tier){ list[i] = q; list[i + dir] = p; return; }
  const ti = TIERS.indexOf(p.tier) + dir;
  if (ti < 0 || ti >= TIERS.length) return;
  p.tier = TIERS[ti]; tierSort();
}

/* ---------- 동작 ---------- */
function parseListLines(text){
  return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const re = /\(재판\)/.test(line);
    const parts = line.replace(/\(재판\)/g, '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
    let ip = '', series = '', name = '';
    if (parts.length >= 3){ [ip, series] = parts; name = parts.slice(2).join(' / '); }
    else if (parts.length === 2){ [ip, name] = parts; }
    else name = parts[0] || '';
    return normProduct({ip, series, name, reprint:re, secured:re, tier:'미정'});
  });
}

function doPaste(){
  const n = P().length;
  openModal('D-7 프리뷰 리스트 붙여넣기',
    `<p>번역한 본사 리스트를 한 줄에 한 상품씩 붙여넣으세요. 형식은 <b>작품명 / 시리즈 / 상품명</b>이고, 재판이면 끝에 <b>(재판)</b>을 붙입니다. 슬래시(/)가 없으면 한 줄 전체를 상품명으로 넣습니다.</p>
     <textarea id="pasteTa" placeholder="원피스 / 룩업 / 로로노아 조로&#10;주술회전 / G.E.M. 시리즈 / 고죠 사토루 (재판)"></textarea>
     <p>들어온 상품은 전부 등급 '미정'이 됩니다. 본사 순서는 뒤죽박죽이라 인기도 정렬부터 합니다.</p>
     ${n ? `<div class="alert warn"><b>지금 목록 ${n}개와 이 회차의 원고·확정 표시가 전부 새 목록으로 바뀝니다.</b> 뒤에 이어 붙이려면 '뒤에 추가'를 누르세요.</div>` : ''}`,
    [{label:'취소'},
     ...(n ? [{label:'뒤에 추가', fn: () => apply(false)}] : []),
     {label: n ? '목록 새로 만들기' : '목록 만들기', primary:true, danger: !!n, fn: () => apply(true)}]);
  function apply(replace){
    const items = parseListLines($('#pasteTa').value);
    if (!items.length){ toast('붙여넣은 내용이 없어요'); return; }
    if (replace){ R().products = items; R().orderChecked = false; R().drafts = {}; openEdit.clear(); }
    else { P().push(...items); tierSort(); }
    filter = 'all'; R().tasks.d7_paste = true;
    closeModal(); commit(); toast(`${items.length}개 상품을 ${replace ? '불러왔어요' : '추가했어요'} · 이제 등급을 정해 주세요`);
  }
}

function loadSample(){
  R().products = SAMPLE.map((r, i) => normProduct({ip:r[0], series:r[1], name:r[2], emoji:r[3], reprint:!!r[4], secured:!!r[4], tier:r[5], link: i % 4 === 3 ? '' : `https://smartstore.naver.com/megahouse/products/${10423000 + i * 37}`}));
  R().orderChecked = false; R().drafts = {};
  commit(); toast('예시 데이터를 넣었어요. 실제로 쓸 땐 "D-7 리스트 붙여넣기 → 목록 새로 만들기"로 바꾸세요');
}

function addProduct(){
  const p = normProduct({tier:'미정'}); P().push(p); tierSort();
  openEdit.add(p.id); commit();
  setTimeout(() => $(`#e-ip-${p.id}`)?.focus(), 0);
}

/* 발주서 */
function sheetRows(file){
  return file.arrayBuffer().then(buf => {
    if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 도구(SheetJS)를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
    const wb = XLSX.read(buf, {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
  });
}
function guessColumn(rows){
  for (let r = 0; r < Math.min(rows.length, 15); r++){
    const c = rows[r].findIndex(v => /상품명|품명|제품명|商品名|品名|item\s*name|product/i.test(String(v)));
    if (c >= 0) return {headRow:r, col:c};
  }
  // 머리글을 못 찾으면 글자가 가장 많이 채워진 열을 고른다
  const width = Math.max(0, ...rows.map(r => r.length)); let best = 0, score = -1;
  for (let c = 0; c < width; c++){ const s = rows.reduce((n, r) => n + (String(r[c] ?? '').trim().length >= 4 ? 1 : 0), 0); if (s > score){ score = s; best = c; } }
  return {headRow:-1, col:best};
}
function namesFrom(rows, headRow, col){ return rows.slice(headRow + 1).map(r => String(r[col] ?? '').trim()).filter(v => v && !/^(합계|소계|total)$/i.test(v)); }
function diffPreview(names){
  const list = P().slice();
  const matched = new Set(), usedName = new Set();
  for (const p of list) for (const n of names) if (nameMatch(p, n)){ matched.add(p.id); usedName.add(n); break; }
  return { keep: list.filter(p => matched.has(p.id)), gone: list.filter(p => !matched.has(p.id)), add: [...new Set(names.filter(n => !usedName.has(n)))] };
}
function applyOrder(pv){
  for (const p of pv.keep) if (p.status === 'removed') p.status = 'normal';
  for (const p of pv.gone) p.status = 'removed';
  for (const n of pv.add) P().push(normProduct({name:n, tier:'미정', status:'new'}));
  tierSort(); R().orderChecked = true; R().tasks.d1_order = true;
}
function doOrder(){
  openModal('발주서 엑셀 올리기',
    `<p>D-1에 도착한 발주서 엑셀을 고르면 지금 목록과 비교해서 <b>새로 생긴 상품</b>과 <b>빠진 상품</b>을 먼저 보여줍니다. 확인을 눌러야 목록에 반영됩니다.</p>
     <input type="file" id="orderFile" accept=".xlsx,.xls,.csv">
     <div id="orderPrev" class="prev"></div>`,
    [{label:'취소'}]);
  let rows = null, pv = null;
  const show = (headRow, col) => {
    const names = namesFrom(rows, headRow, col);
    pv = diffPreview(names);
    const head = headRow >= 0 ? rows[headRow] : rows[0] || [];
    const cols = Array.from({length: Math.max(...rows.map(r => r.length), 1)}, (_, i) => `<option value="${i}" ${i === col ? 'selected' : ''}>${String.fromCharCode(65 + (i % 26))}열${headRow >= 0 && head[i] ? ' · ' + esc(head[i]) : ''}</option>`).join('');
    $('#orderPrev').innerHTML = `
      <label style="display:flex;gap:8px;align-items:center">상품명이 있는 열 <select id="orderCol">${cols}</select> <span style="color:var(--sub);font-size:12px">${names.length}줄 읽음</span></label>
      <div class="alert warn" style="display:block"><b>새로 생길 상품 ${pv.add.length}개</b><ul>${pv.add.map(n => `<li>${esc(n)}</li>`).join('') || '<li>없음</li>'}</ul><span style="font-size:12px">등급 '미정'으로 들어갑니다. 작품명·시리즈는 목록에서 상품을 눌러 채워 주세요.</span></div>
      <div class="alert bad" style="display:block"><b>빠질 상품 ${pv.gone.length}개</b><ul>${pv.gone.map(p => `<li>${esc(p.name)}</li>`).join('') || '<li>없음</li>'}</ul><span style="font-size:12px">목록엔 줄 그어서 남기고 원고와 순위에서만 뺍니다. 이름 표기가 달라서 잘못 잡힌 상품이 있으면, 반영 후 목록에서 상품명을 발주서 표기에 맞게 고치고 다시 올리세요.</span></div>
      <p>그대로 있는 상품 ${pv.keep.length}개</p>`;
    $('#orderCol').onchange = e => show(headRow, Number(e.target.value));
    // 열을 잘못 잡으면 "전부 빠짐"으로 반영돼 목록이 통째로 날아간다 — 0줄이거나 절반 넘게 빠지면 막거나 경고
    const tooMany = pv.gone.length > 0 && pv.gone.length >= Math.ceil(P().length / 2);
    if (!names.length) $('#orderPrev').insertAdjacentHTML('afterbegin', '<div class="alert bad"><b>이 열에서 상품명을 한 줄도 못 읽었어요.</b> 위에서 상품명이 있는 열을 골라 주세요.</div>');
    else if (tooMany) $('#orderPrev').insertAdjacentHTML('afterbegin', `<div class="alert bad"><b>지금 목록의 절반 이상(${pv.gone.length}개)이 빠지는 걸로 나와요.</b> 상품명 열을 잘못 골랐거나 표기가 많이 다를 수 있어요. 열을 다시 확인해 주세요.</div>`);
    const f = $('#mFoot'); f.innerHTML = '';
    [{label:'취소'}, {label: tooMany ? '그래도 반영' : '목록에 반영', primary:true, disabled: !names.length, fn: () => { applyOrder(pv); closeModal(); commit(); toast(`발주서 반영 — 신규 ${pv.add.length} · 빠짐 ${pv.gone.length}`); }}]
      .forEach(b => { const el = document.createElement('button'); el.className = 'btn' + (b.primary ? ' primary' : ''); el.textContent = b.label; el.disabled = !!b.disabled; el.onclick = b.fn || closeModal; f.appendChild(el); });
  };
  $('#orderFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    $('#orderPrev').innerHTML = '<p>읽는 중…</p>';
    try { rows = await sheetRows(file); if (!rows.length) throw new Error('엑셀 첫 번째 시트가 비어 있어요.'); const g = guessColumn(rows); show(g.headRow, g.col); }
    catch (err){ $('#orderPrev').innerHTML = `<div class="alert bad">${esc(err.message || '파일을 읽지 못했어요.')}</div>`; }
  });
}

/* 링크 */
function doLinks(){
  const miss = active().filter(p => !p.link);
  openModal('스마트스토어 링크 한번에 붙여넣기',
    `<p>한 줄에 <b>상품명 + 링크</b>를 붙여넣으면 상품명으로 짝을 맞춰 채웁니다. 이미 링크가 있는 상품은 새 링크로 바뀝니다.</p>
     <textarea id="linkTa" placeholder="로로노아 조로	https://smartstore.naver.com/…&#10;고죠 사토루 https://smartstore.naver.com/…"></textarea>
     <p style="font-size:12px">지금 링크 없는 상품 ${miss.length}개${miss.length ? ': ' + miss.slice(0, 12).map(p => esc(p.name)).join(', ') + (miss.length > 12 ? ' 외' : '') : ''}. 하나씩 넣으려면 목록에서 '링크 없음'을 누르세요.</p>`,
    [{label:'취소'}, {label:'링크 채우기', primary:true, fn: () => {
      let ok = 0; const fail = [];
      $('#linkTa').value.split('\n').forEach(line => {
        const m = line.trim().match(/^(.*?)\s*(https?:\/\/\S+)\s*$/); if (!m) return;
        const key = m[1].trim(); if (!key){ fail.push(m[2]); return; }
        const p = active().find(x => norm(x.name) === norm(key)) || active().find(x => nameMatch(x, key));
        if (p){ p.link = m[2]; ok++; } else fail.push(key);
      });
      if (ok && !active().some(p => !p.link)) R().tasks.d1_links = true;
      closeModal(); commit();
      toast(`링크 ${ok}개 채움${fail.length ? ` · 짝 못 찾음 ${fail.length}개: ${fail.slice(0, 5).join(', ')}` : ''}`);
    }}]);
}

function copyMatome(){
  const l = ranked();
  if (!l.length){ toast('등급이 정해진 상품이 없어요'); return; }
  copyText(l.map(p => p.ip || p.name).join('\n'), `마토메 메이커에 붙여넣을 작품명 ${l.length}줄 복사됨 (순위순)`);
}
function copyAll(){
  const l = DRAFT_STAGES.includes(stageKey) ? draftList(stageKey, chBy[stageKey]) : draftList(stageKey);
  if (!l.length){ toast('복사할 원고가 없어요'); return; }
  copyText(l.map(dText).join('\n\n──────────\n\n'), `원고 ${l.length}건 복사됨`);
}

/* 회차·백업 */
function newRound(){
  openModal('새 회차 만들기',
    `<p>다음 달 프리뷰가 뜨면 새 회차를 만드세요. 지난 회차는 위 '회차' 목록에서 계속 볼 수 있습니다.</p>
     <label style="display:grid;gap:4px">스토어 오픈일 (D-0)<input type="date" id="nrDate" value="${nextOpenDate()}"></label>`,
    [{label:'취소'}, {label:'만들기', primary:true, fn: () => {
      const v = $('#nrDate').value; if (!v){ toast('날짜를 골라 주세요'); return; }
      const r = normRound({openDate:v}); store.rounds[r.id] = r; store.current = r.id;
      stageKey = currentStageKey(); openEdit.clear(); closeModal(); save(); renderAll(); toast(`${roundLabel(r)}를 만들었어요`);
    }}]);
}
function backup(){
  save();
  const blob = new Blob([JSON.stringify({app:'mh-upload-board', savedAt:new Date().toISOString(), ...store}, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `메가하우스-업로드보드-백업-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('백업 파일을 내려받았어요');
}
$('#restoreFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch { toast('백업 파일을 읽지 못했어요 (JSON 형식이 아님)'); return; }
  if (!data || typeof data.rounds !== 'object'){ toast('이 도구의 백업 파일이 아니에요'); return; }
  const n = Object.keys(data.rounds).length;
  openModal('백업 불러오기', `<p>백업 파일에 회차 ${n}개가 있어요.</p><div class="alert warn"><b>같은 회차가 이미 있으면 백업 내용으로 덮어씁니다.</b> 다른 회차는 그대로 둡니다.</div>`,
    [{label:'취소'}, {label:'불러오기', primary:true, fn: () => {
      for (const [k, r] of Object.entries(data.rounds)) store.rounds[k] = normRound({...r, id:k});
      if (data.current in store.rounds) store.current = data.current;
      closeModal(); save(); renderAll(); toast(`회차 ${n}개를 불러왔어요`);
    }}]);
});

const G = { paste:doPaste, order:doOrder, links:doLinks, copyMatome, copyAll, sample:loadSample, addProduct, newRound, backup, restore: () => $('#restoreFile').click() };

document.addEventListener('click', e => {
  const g = e.target.closest('[data-g]'); if (g){ G[g.dataset.g](); return; }
  const st = e.target.closest('[data-stage]'); if (st){ stageKey = st.dataset.stage; onlyOpen = false; $('#stageCol').scrollTop = 0; renderAll(); return; }
  const fl = e.target.closest('[data-filter]'); if (fl){ filter = fl.dataset.filter; renderList(); return; }
  const chb = e.target.closest('button[data-ch]'); if (chb){ chBy[stageKey] = chb.dataset.ch; renderStage(); renderBar(); return; }

  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  const row = act.closest('[data-id]');
  const card = act.closest('[data-key]');
  if (row){
    const id = row.dataset.id, p = byId(id); if (!p) return;
    if (a !== 'del') armedDelete = null;
    if (a === 'up' || a === 'down'){ nudge(id, a === 'up' ? -1 : 1); commit(); document.querySelector(`.row[data-id="${id}"] [data-act="${a}"]`)?.focus(); }
    else if (a === 'secure'){ p.secured = !p.secured; commit(); }
    else if (a === 'edit'){ openEdit.has(id) ? openEdit.delete(id) : openEdit.add(id); renderList(); if (openEdit.has(id)) $(`#e-${p.link || act.classList.contains('pname-btn') ? 'name' : 'link'}-${id}`)?.focus(); }
    else if (a === 'close'){ openEdit.delete(id); renderList(); }
    else if (a === 'del'){
      if (armedDelete !== id){ armedDelete = id; renderList(); return; }
      R().products = P().filter(x => x.id !== id);
      for (const k of Object.keys(R().drafts)) if (k.endsWith(':' + id)) delete R().drafts[k];
      armedDelete = null; openEdit.delete(id); commit(); toast(`${p.name || '상품'}을 삭제했어요`);
    }
  } else if (card){
    const key = card.dataset.key;
    const d = [...draftList(stageKey), ...draftList('d0')].find(x => x.key === key); if (!d) return;
    if (a === 'copy') copyText(dText(d), '원고 복사됨');
    else if (a === 'done'){ R().drafts[key] = {...R().drafts[key], done: !isDone(key)}; commit(); }
    else if (a === 'regen'){ if (R().drafts[key]) delete R().drafts[key].text; commit(); toast('기본 틀로 다시 만들었어요'); }
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.task){ R().tasks[t.dataset.task] = t.checked; commit(); return; }
  if (t.id === 'onlyOpen'){ onlyOpen = t.checked; renderStage(); return; }
  if (t.id === 'roundSel'){ store.current = t.value; stageKey = currentStageKey(); openEdit.clear(); save(); renderAll(); return; }
  if (t.id === 'openDate'){ if (t.value){ R().openDate = t.value; commit(); } return; }
  if (t.dataset.act === 'tier'){ const id = t.closest('[data-id]').dataset.id; moveToTier(id, t.value); commit(); return; }
  if (t.dataset.f === 'reprint'){ const p = byId(t.closest('[data-id]').dataset.id); p.reprint = t.checked; commit(); }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && t.dataset.f !== 'reprint'){
    // 상품 정보 편집: 입력 중엔 목록을 다시 그리지 않고(포커스 유지) 값만 바꿔 저장, 칸을 벗어나면 화면 갱신
    const p = byId(t.closest('[data-id]').dataset.id); p[t.dataset.f] = t.value.trim(); saveSoon(); return;
  }
  if (!t.matches('textarea[data-key]')) return;
  const key = t.dataset.key;
  R().drafts[key] = {...R().drafts[key], text: t.value};
  saveSoon();
  const cardEl = t.closest('.dcard'), cnt = cardEl.querySelector('[data-cnt]');
  const L = lenInfo(t.dataset.ch, t.value);
  cnt.textContent = `${L.len}/${L.lim}${L.unit}`; cnt.classList.toggle('over', L.len > L.lim);
  if (!cardEl.querySelector('[data-act="regen"]')){ const b = document.createElement('button'); b.className = 'linkbtn'; b.dataset.act = 'regen'; b.textContent = '기본 틀로 다시'; cnt.after(b); }
});
document.addEventListener('focusout', e => {
  const t = e.target;
  if (t.dataset?.f && t.dataset.f !== 'reprint'){
    const id = t.closest('[data-id]').dataset.id;
    setTimeout(() => { if (!document.activeElement?.closest?.(`.pedit[data-id="${id}"]`)){ renderAll(); } else { renderTimeline(); renderStage(); renderBar(); } }, 0);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('.pedit input[type=text]')){ const id = e.target.closest('[data-id]').dataset.id; openEdit.delete(id); save(); renderAll(); }
});

/* 끌어서 순위·등급 바꾸기 */
const plist = $('#plist');
const clearDrop = () => plist.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(el => el.classList.remove('drop-before','drop-after','drop-into'));
plist.addEventListener('dragstart', e => {
  const row = e.target.closest?.('.row'); if (!row) return;
  dragId = row.dataset.id; row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch {}
});
plist.addEventListener('dragend', () => { dragId = null; clearDrop(); plist.querySelector('.dragging')?.classList.remove('dragging'); });
plist.addEventListener('dragover', e => {
  if (!dragId) return;
  const t = e.target.closest('.row,.tier-h,.empty-drop'); if (!t) return;
  e.preventDefault(); clearDrop();
  if (t.classList.contains('row')){ const r = t.getBoundingClientRect(); t.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before'); }
  else (t.classList.contains('tier-h') ? t : t.previousElementSibling).classList.add('drop-into');
});
plist.addEventListener('drop', e => {
  if (!dragId) return;
  const t = e.target.closest('.row,.tier-h,.empty-drop'); if (!t) return;
  e.preventDefault();
  if (t.classList.contains('row')){ const r = t.getBoundingClientRect(); moveRel(dragId, t.dataset.id, e.clientY > r.top + r.height / 2); }
  else moveToTier(dragId, t.dataset.tier);
  dragId = null; commit();
});

// 저장 대기 중인 변경이 있을 때만 닫기 직전에 저장한다 (무조건 저장하면 다른 탭에서 한 작업을 덮어쓴다)
window.addEventListener('beforeunload', () => { if (saveT){ clearTimeout(saveT); saveT = null; save(); } });
// 같은 도구를 탭 두 개로 열었을 때: 다른 탭에서 저장하면 이 탭도 그 내용으로 맞춘다
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY) return;
  const keep = store.current;
  store = {current:null, rounds:{}}; loadStore();
  if (keep in store.rounds) store.current = keep;
  renderAll(); toast('다른 탭에서 바뀐 내용을 불러왔어요');
});

loadStore();
stageKey = currentStageKey();
save();
renderAll();
