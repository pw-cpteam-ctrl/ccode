// ============================================================
// 입고안내 이미지 자동 제작 툴 — 메인 앱 로직
// 5단계 플로우(업로드/그리드검출 → 표정리 → 전체미리보기 → 순서정렬 →
// 최종크롭/내보내기)를 화면 전환으로 명확히 분리한다. 절대 중간 단계를 건너뛰고
// 최종 렌더로 가지 않는다 (PLAN 문서의 "실패 사례" 참고).
// 삭제는 예전엔 "체크박스 선택 → 확인 화면 → 확정" 별도 단계였지만, 확인 화면이
// 오히려 번거롭다는 피드백에 따라 즉시 삭제 + 실행취소(undo)로 단순화했다.
// ============================================================

const STEP_LABELS = ['업로드/검출', '표 정리', '미리보기 & 정렬', '최종 내보내기'];

const state = {
  step: 1,
  sources: [],       // { id, img, grid:{cols,rows,cardW,cardH}, confirmed }
  headers: [],        // { id, label, canvas }
  photos: {},          // photoId -> canvas
  items: [],            // { id, photoId, ip, tag, price, ship, subGrade, pushToEnd }
  nextPhotoNum: 1,
  nextItemId: 1,
  dict: { ipNameMap: {}, gradeTable: { S: [], A: [] }, moodClusters: [], storeProfiles: {}, productLineNames: [] },
  activeStore: 'goodsmile',
  pendingDeleteIds: [],
  lastDeletedBatch: null, // [{ item, index }] — 실행취소용, 가장 최근 삭제 1건만 기억
  orderConfirmed: false,
  finalPages: null, // array of { items, canvas }
  textLocked: false, // true면 IP명/가격/태그 등 글자 수정을 막고 카드 순서 변경만 허용
  showShipping: true, // false면 배송비(아이콘+글자)를 안 보여줌 — 항목별이 아니라 전체 스위치
};

// 2단계(표 정리)의 빈 배경 드래그 다중 선택은 3/4단계(카드 그리드)의 group-selected
// 선택과 목적이 다르다(태그/클러스터 일괄편집 대 카드 이동) — 같은 변수를 쓰면 단계를
// 넘나들 때 선택이 뜻하지 않게 이어질 수 있어 별도 변수로 관리한다.
let step2SelectedIds = new Set();

function uid(prefix) { return `${prefix}${state.nextItemId++}`; }
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function splitSummaryText(items) {
  const groups = chunk(items, 20).map((g) => g.length);
  return `총 ${items.length}개 → ${groups.join('+') || 0} (${groups.length}페이지)`;
}

// ---------- 사전 로드/병합 ----------
// 기본 운영 방식: 백엔드(Vercel/GitHub) 없이 index.html만 열어도 완전히 동작한다.
// 사전 편집 내용은 이 브라우저(localStorage)에 저장되고, 그게 항상 우선한다.
// GitHub 공유는 팀원끼리 사전을 맞추고 싶을 때만 쓰는 "선택 기능"이고, 배포/환경변수를
// 설정하지 않았다면 관련 fetch는 그냥 조용히 실패하고 무시된다(비용도 전혀 들지 않음).
const DICT_LS_KEY = 'inbound-image-composer-dict-v1';
function loadLocalDict() {
  try { return JSON.parse(localStorage.getItem(DICT_LS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveLocalDict(partial) {
  const current = loadLocalDict();
  const merged = { ...current, ...partial };
  localStorage.setItem(DICT_LS_KEY, JSON.stringify(merged));
}

async function loadDict() {
  const seed = {
    ipNameMap: { ...window.SEED_IP_NAME_MAP },
    gradeTable: { S: [...window.SEED_GRADE_TABLE.S], A: [...window.SEED_GRADE_TABLE.A] },
    moodClusters: window.SEED_MOOD_CLUSTERS.map((c) => ({ ...c, members: [...c.members] })),
    storeProfiles: JSON.parse(JSON.stringify(window.SEED_STORE_PROFILES)),
    productLineNames: [...window.SEED_PRODUCT_LINE_NAMES],
  };

  let server = {};
  try {
    // 백엔드가 배포되어 있지 않으면(파일 더블클릭으로 열었을 때 등) 이 요청은 그냥 실패한다 —
    // 그래도 화면은 seed값 + 로컬 저장값만으로 정상 동작해야 하므로 짧은 타임아웃만 두고 무시한다.
    const r = await fetch('/api/load-dict', { signal: AbortSignal.timeout(1500) });
    server = await r.json();
  } catch (e) { /* 백엔드 없음 — 무시 */ }

  const local = loadLocalDict();

  state.dict = {
    ipNameMap: { ...seed.ipNameMap, ...(server.ipNameMap || {}), ...(local.ipNameMap || {}) },
    gradeTable: mergeGradeTable(seed.gradeTable, server.gradeTable, local.gradeTable),
    moodClusters: mergeMoodClusters(seed.moodClusters, server.moodClusters, local.moodClusters),
    storeProfiles: { ...seed.storeProfiles, ...(server.storeProfiles || {}), ...(local.storeProfiles || {}) },
    productLineNames: uniqStrings([...seed.productLineNames, ...(server.productLineNames || []), ...(local.productLineNames || [])]),
  };
  if (!state.dict.storeProfiles[state.activeStore]) {
    state.activeStore = Object.keys(state.dict.storeProfiles)[0];
  }
}

function uniqStrings(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// 예전엔 로컬(또는 GitHub)에 값이 "하나라도" 저장돼 있으면 그걸로 시드 전체를 통째로
// 덮어썼다 — 그래서 시드에 나중에 추가된 항목(예: 등급표의 "주술회전")이 사용자의
// 예전 로컬 저장값 때문에 계속 안 보이는 버그가 있었다. 항상 시드 + 서버 + 로컬을
// 합집합으로 병합해서, 로컬 편집이 시드 기본값을 지우는 일이 없게 한다.
function mergeGradeTable(seed, server, local) {
  const s = server && server.S ? server : { S: [], A: [] };
  const l = local && local.S ? local : { S: [], A: [] };
  return {
    S: uniqStrings([...seed.S, ...s.S, ...l.S]),
    A: uniqStrings([...seed.A, ...s.A, ...l.A]),
  };
}

// 클러스터는 이름 기준으로 합치고, 같은 이름이면 멤버 목록을 합집합으로 합친다.
function mergeMoodClusters(seed, server, local) {
  const byName = new Map();
  [seed, server || [], local || []].forEach((list) => {
    list.forEach((c) => {
      if (!byName.has(c.name)) byName.set(c.name, { name: c.name, note: c.note || '', members: [] });
      const entry = byName.get(c.name);
      entry.members = uniqStrings([...entry.members, ...(c.members || [])]);
      if (c.note) entry.note = c.note;
    });
  });
  return [...byName.values()];
}

// 이 브라우저에 즉시 저장 (백엔드 불필요, 확인창 없음 — 언제든 되돌릴 수 있는 로컬 편집이라서).
function saveDictLocal(section, value) {
  state.dict[section] = value;
  saveLocalDict({ [section]: value });
}

// 선택 기능: 배포된 백엔드가 있을 때만 팀 공유용으로 GitHub에도 커밋한다.
// 백엔드가 없으면 실패하는 게 당연하므로, 그 경우엔 "이 브라우저에는 이미 저장됐다"고
// 안내하고 에러처럼 취급하지 않는다.
async function shareDictToGithub(section, value, label) {
  const ok = window.confirm(`"${label}" 내용을 GitHub(팀 공유용)에도 올리시겠습니까?\n백엔드가 배포되어 있지 않다면 이 브라우저 저장만 유지됩니다.`);
  if (!ok) return;
  try {
    const r = await fetch('/api/save-dict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, value }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '저장 실패');
    alert('GitHub에도 저장되었습니다 (팀원들도 공유받습니다).');
  } catch (e) {
    alert('GitHub 공유는 실패했지만, 이 브라우저에는 이미 저장되어 있어 계속 쓸 수 있습니다.\n(백엔드를 배포하지 않았다면 정상입니다)');
  }
}

// ---------- 화면 전환 ----------
function renderStepIndicator() {
  const el = document.getElementById('stepIndicator');
  el.innerHTML = STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const cls = n === state.step ? 'dot active' : (n < state.step ? 'dot done' : 'dot');
    return `<span class="${cls}">${n}. ${label}</span>`;
  }).join('');
}

function goToStep(n) {
  if (n === 2 && Object.keys(state.photos).length === 0) return;
  if (n === 4 && !state.orderConfirmed) { showStep5Guard(); }
  if (n !== 3) hideUndoBanner(); // 실행취소는 3단계 컨텍스트에서만 의미가 있음
  state.step = n;
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  renderStepIndicator();
  if (n === 2) renderDataTable();
  if (n === 3) { renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true }); updateTextLockBanner(); }
  if (n === 4) renderStep5();
}

// ============================================================
// 이전 작업 슬롯 캐시 (탭 닫기/전환 시 자동 저장, 최근 5개)
// insta-gen의 슬롯 캐시 패턴을 그대로 가져와 이 툴의 state 구조에 맞춤. 원본 소스
// 이미지(state.sources)는 용량이 너무 커서 저장 대상에서 뺐다 — 대신 이미 크롭된
// photos/headers를 압축 JPEG로 저장한다. 즉 이 캐시로 복원하면 표 데이터(IP명/가격/
// 태그/순서 등)는 100% 그대로 돌아오지만, 최종 내보내기에 쓰이는 사진 화질은 압축된
// 만큼 살짝 낮아진다 — 사고로 탭을 닫았을 때를 위한 안전망이지, 정상 작업 경로를
// 대체하는 기능이 아니다.
// ============================================================
const SLOT_KEY = 'inbound-image-composer-slots-v1';
const SLOT_MAX = 5;

function loadSlots() {
  try { return JSON.parse(localStorage.getItem(SLOT_KEY) || '[]'); } catch (e) { return []; }
}

function saveSlots(list) {
  const trimmed = list.slice(0, SLOT_MAX);
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(trimmed)); return; } catch (e) { /* 용량 초과 — 아래에서 재시도 */ }
  // 용량 초과 시 오래된 슬롯부터 사진 데이터를 비우고(텍스트만 남김) 재시도한다.
  const stripped = trimmed.map((s) => ({ ...s }));
  for (let i = stripped.length - 1; i >= 0; i--) {
    stripped[i] = { ...stripped[i], photos: {}, headers: [] };
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(stripped)); return; } catch (e) { /* 계속 다음 슬롯도 비우기 */ }
  }
}

// 캔버스를 축소 JPEG로 압축해서 저장 용량을 아낀다 (사진은 이미 176px 안팎이라 화질
// 손실이 크지 않지만, 최종 내보내기 원본보다는 낮은 화질이 되는 트레이드오프가 있다).
function compressCanvasForSlot(canvas, max, quality) {
  try {
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } catch (e) { return ''; }
}

function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    if (!dataUrl) { c.width = 1; c.height = 1; resolve(c); return; }
    const img = new Image();
    img.onload = () => { c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); resolve(c); };
    img.onerror = () => { c.width = 1; c.height = 1; resolve(c); };
    img.src = dataUrl;
  });
}

function snapshotState() {
  if (!state.items.length) return null; // 저장할 표 데이터가 없으면 스냅샷 자체를 안 만듦
  const photos = {};
  Object.entries(state.photos).forEach(([id, canvas]) => { photos[id] = compressCanvasForSlot(canvas, 220, 0.82); });
  const headers = state.headers.map((h) => ({ id: h.id, label: h.label, imgData: compressCanvasForSlot(h.canvas, 1000, 0.82) }));
  return {
    ts: Date.now(),
    step: state.step,
    items: JSON.parse(JSON.stringify(state.items)),
    photos,
    headers,
    nextPhotoNum: state.nextPhotoNum,
    nextItemId: state.nextItemId,
    activeStore: state.activeStore,
    orderConfirmed: state.orderConfirmed,
  };
}

function slotLabel(s) {
  const withIp = s.items.find((it) => it.ip);
  return `${s.items.length}개 항목${withIp ? ` (${withIp.ip} 외)` : ''}`;
}

// 탭을 여러 번 전환하면 그 사이 아무 작업도 안 했어도 beforeunload/visibilitychange가
// 매번 새 스냅샷을 만들어서, 내용은 완전히 같은데 시각만 다른 슬롯이 계속 쌓이는 문제가
// 있었다. ts(저장 시각)만 다르고 나머지 내용이 전부 같으면 "완전히 동일한 데이터"로
// 보고 새로 추가하지 않는다.
function snapshotContentKey(s) {
  const { ts, ...rest } = s;
  return JSON.stringify(rest);
}

function pushSlot(snap, skipRender) {
  if (!snap) return;
  const list = loadSlots();
  if (list.length && snapshotContentKey(list[0]) === snapshotContentKey(snap)) return;
  list.unshift(snap);
  saveSlots(list);
  if (!skipRender) renderSlots();
}

function deleteSlot(i) {
  const list = loadSlots();
  list.splice(i, 1);
  saveSlots(list);
  renderSlots();
}

async function applySlot(s) {
  pushSlot(snapshotState()); // 되돌리기 전에 지금 작업 중이던 것도 먼저 보존
  state.items = JSON.parse(JSON.stringify(s.items));
  state.photos = {};
  for (const [id, dataUrl] of Object.entries(s.photos || {})) {
    state.photos[id] = await dataUrlToCanvas(dataUrl);
  }
  state.headers = [];
  for (const h of (s.headers || [])) {
    state.headers.push({ id: h.id, label: h.label, canvas: await dataUrlToCanvas(h.imgData) });
  }
  state.nextPhotoNum = s.nextPhotoNum || 1;
  state.nextItemId = s.nextItemId || 1;
  state.activeStore = s.activeStore || state.activeStore;
  state.orderConfirmed = !!s.orderConfirmed;
  state.sources = []; // 원본 소스는 캐시 대상이 아니라 1단계 업로드 목록은 비워진 채로 시작
  renderSlots();
  goToStep(2); // 사진+표 데이터가 이미 다 있으니 표 정리 화면으로 바로 이동
}

function renderSlots() {
  const box = document.getElementById('slots');
  if (!box) return;
  const list = loadSlots();
  if (!list.length) { box.innerHTML = '<div class="slot-empty">아직 저장된 이전 작업이 없습니다.</div>'; return; }
  box.innerHTML = '';
  list.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'slot';
    const title = document.createElement('span');
    title.className = 's-title';
    title.textContent = slotLabel(s);
    const meta = document.createElement('span');
    meta.className = 's-meta';
    try { meta.textContent = new Date(s.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { /* noop */ }
    const del = document.createElement('span');
    del.className = 's-del'; del.textContent = '✕'; del.title = '삭제';
    row.appendChild(title); row.appendChild(meta); row.appendChild(del);
    row.addEventListener('click', (e) => { if (e.target === del) deleteSlot(i); else applySlot(s); });
    box.appendChild(row);
  });
}

window.addEventListener('beforeunload', () => { pushSlot(snapshotState(), true); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pushSlot(snapshotState(), true);
});

// ============================================================
// STEP 1 — 업로드 & 그리드 검출
// ============================================================
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function handleFilesSelected(fileList) {
  const files = Array.from(fileList).slice(0, 3 - state.sources.length);
  // 이미지 로딩은 순차 로딩이 눈에 띄게 느리므로 Promise.all로 병렬 처리한다.
  const imgs = await Promise.all(files.map(readImageFile));
  imgs.forEach((img) => {
    const grid = GridDetect.detectGrid(img, 0);
    state.sources.push({ id: uid('src'), img, grid, confirmed: false, gridVariant: 0, headerHeightOverride: null });
  });
  renderSourceList();
}

function renderSourceList() {
  const container = document.getElementById('sourceList');
  container.innerHTML = '';
  state.sources.forEach((src) => {
    const block = document.createElement('div');
    block.className = 'source-block';
    block.dataset.srcId = src.id;
    const cellCount = src.grid.rows.length * src.grid.cols.length;
    block.innerHTML = `
      <div class="row between">
        <strong>${src.img.width}×${src.img.height}px — 검출된 셀 ${cellCount}개 (행 ${src.grid.rows.length} × 열 ${src.grid.cols.length})</strong>
        <div class="row">
          <button class="btn" data-action="redetect" data-id="${src.id}">다시 검출</button>
          <button class="btn primary" data-action="confirm" data-id="${src.id}" ${src.confirmed ? 'disabled' : ''}>${src.confirmed ? '크롭 완료됨' : '확인 및 크롭'}</button>
          <button class="btn" data-action="ai-fill" data-id="${src.id}" ${src.confirmed ? '' : 'disabled'} title="claude-sonnet-5로 사진과 텍스트를 함께 보고 표를 채웁니다 (유료 API 호출, 장당 약 2~4센트 수준). 결과는 항상 확인 대상으로만 표시됩니다.">🤖 AI로 채우기</button>
          <button class="btn" data-action="ocr-label" data-id="${src.id}" ${src.confirmed ? '' : 'disabled'} title="사진은 안 보내고 사진 아래 텍스트(상품명/가격/태그)만 보고 IP명을 추출합니다 — 'AI로 채우기'와 같은 추출 규칙을 쓰지만 사진이 없어서 글자가 흐릴 때 그림으로 확인하는 기능만 빠집니다. 원본 스크린샷/재수입 둘 다 쓸 수 있고, 사진을 함께 보내는 'AI로 채우기'보다 저렴합니다.">🏷️ 라벨만 재인식</button>
          <button class="btn danger" data-action="delete-source" data-id="${src.id}" title="실수로 첨부한 사진을 목록에서 완전히 뺍니다. 이미 크롭을 확정한 사진이면 여기서 만들어진 항목·사진·헤더도 함께 삭제됩니다.">🗑 이 사진 삭제</button>
        </div>
      </div>
      <canvas class="overlay" data-canvas="${src.id}"></canvas>
      <div class="row header-height-row">
        <label>헤더 높이(px) 직접 조정
          <input type="number" class="header-height-input" data-id="${src.id}" min="0" max="${src.img.height}"
            value="${src.headerHeightOverride ?? (src.grid.rows[0] || 0)}" ${src.confirmed ? 'disabled' : ''} />
        </label>
        <span class="hint" style="margin:0;">파란 박스(맨 위)가 실제로 잘릴 헤더 배너 범위입니다 — 자동 검출이 안 맞으면 숫자를 직접 바꿔서 맞추세요.</span>
      </div>
      <div class="source-status ${src.confirmed ? 'confirmed' : ''}">${src.confirmed ? '✓ 개별 사진 크롭 완료 — photoId 부여됨' : '⚠ 검출 결과를 눈으로 확인한 뒤 크롭을 확정하세요 (행 간격은 불규칙할 수 있습니다). 빨간 박스 = 사진 크롭 범위, 초록 점선 = AI에게 실제로 전송되는 텍스트 포함 범위'}</div>
    `;
    container.appendChild(block);
    drawDebugOverlay(src);
    block.querySelector('.header-height-input').addEventListener('input', (e) => {
      const v = Math.max(0, Math.min(src.img.height, Number(e.target.value) || 0));
      src.headerHeightOverride = v;
      drawDebugOverlay(src);
    });
  });
  document.getElementById('toStep2Btn').disabled = Object.keys(state.photos).length === 0;
}

function drawDebugOverlay(src) {
  const canvas = document.querySelector(`canvas[data-canvas="${src.id}"]`);
  canvas.width = src.img.width;
  canvas.height = src.img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src.img, 0, 0);
  const { cols, rows, cardW, cardH } = src.grid;

  // 초록 점선: AI에게 실제로 전송되는 크롭 범위(사진+아래 텍스트, 행 전체 폭) — 빨간
  // 사진 박스보다 더 아래로 내려간다. "|" 뒤 작품명 텍스트가 이 범위 안에 실제로 들어
  // 오는지 여기서 바로 확인 가능 (예전엔 별도 "미리보기" 버튼으로 뺐었는데, 사진 박스만
  // 그리던 이 오버레이와 겹쳐 보여서 의미가 없었다 — 하나로 합침).
  if (rows.length) {
    const rowTextBottoms = computeRowTextBottoms(src);
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    rows.forEach((y, i) => ctx.strokeRect(0, y, src.img.width, rowTextBottoms[i] - y));
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  rows.forEach((y) => cols.forEach((x) => ctx.strokeRect(x, y, cardW, cardH)));
  // 헤더 영역(첫 행 위쪽) 표시
  if (rows.length) {
    const headerH = src.headerHeightOverride ?? rows[0];
    ctx.strokeStyle = '#2f7bff';
    ctx.strokeRect(0, 0, src.img.width, headerH);
  }
}

function confirmSourceCrop(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src || src.confirmed) return;

  // "다시 검출" 후 재확정(redo)하는 경우 — 이 소스가 예전에 만들어둔 항목/사진/헤더를
  // 먼저 지운다. id 기준으로 지워야 안전하다(itemStartIndex 같은 위치 기준으로 지우면,
  // 그 사이 2/3단계에서 순서를 바꾸거나 다른 항목을 지웠을 때 엉뚱한 항목이 삭제될 수 있음).
  if (src.itemIds && src.itemIds.length) {
    const idsToRemove = new Set(src.itemIds);
    state.items.filter((it) => idsToRemove.has(it.id)).forEach((it) => { delete state.photos[it.photoId]; });
    state.items = state.items.filter((it) => !idsToRemove.has(it.id));
  }
  if (src.headerId) {
    state.headers = state.headers.filter((h) => h.id !== src.headerId);
    src.headerId = null;
  }

  const { cols, rows, cardW, cardH } = src.grid;

  if (rows.length) {
    // 자동 검출된 rows[0](첫 상품 행 시작점)를 그대로 헤더 높이로 썼었는데, 이 값이
    // 잘못 잡히면(배너 위쪽 여백 판정이 이미지마다 다름) 헤더가 통째로 비어 보이는
    // 문제를 사용자가 스스로 고칠 방법이 없었다 — 1단계에서 직접 조정한 값이 있으면
    // 그 값을 우선 사용한다.
    const headerH = src.headerHeightOverride ?? rows[0];
    const headerCanvas = GridDetect.cropCell(src.img, 0, 0, src.img.width, headerH);
    const headerId = uid('hdr');
    state.headers.push({ id: headerId, label: `소스 ${state.headers.length + 1} 헤더`, canvas: headerCanvas });
    src.headerId = headerId;
  }

  src.itemStartIndex = state.items.length; // AI 채우기 결과를 이 소스가 만든 항목에만 매핑하기 위한 범위(같은 1단계 세션 안에서만 유효)
  src.itemIds = []; // 재크롭 시 이 소스가 만든 항목만 정확히 지우기 위한 id 목록
  // 그리드 스캔 경계 그대로 자르면 검출이 살짝만 어긋나도 사진 가장자리가 잘릴 수 있다.
  // 안쪽으로 당기지 않고 상하좌우 +3px 바깥쪽으로 여유를 둔다 — 배경이 흰색이라 여유분은
  // 최종 렌더에서 티가 안 나고(176×176으로 다시 맞춰 그려짐), 대신 사진 잘림을 방지한다.
  const CROP_MARGIN = 3;
  rows.forEach((y) => {
    cols.forEach((x) => {
      const photoId = `p${state.nextPhotoNum++}`;
      const mx = Math.max(0, x - CROP_MARGIN);
      const my = Math.max(0, y - CROP_MARGIN);
      const mw = Math.min(src.img.width, x + cardW + CROP_MARGIN) - mx;
      const mh = Math.min(src.img.height, y + cardH + CROP_MARGIN) - my;
      state.photos[photoId] = GridDetect.cropCell(src.img, mx, my, mw, mh);
      const itemId = uid('item');
      src.itemIds.push(itemId);
      state.items.push({
        id: itemId, photoId, ip: '', tag: '', price: '', ship: '무료배송',
        subGrade: 'other', pushToEnd: false, aiUncertain: false,
      });
    });
  });
  src.itemCount = state.items.length - src.itemStartIndex;

  src.confirmed = true;
  renderSourceList();
}

// 실수로 첨부한 사진을 1단계 목록에서 완전히 뺀다. 이미 크롭을 확정해서 항목/사진/헤더가
// 만들어진 소스라면 그 파생물도 id 기준으로 정확히 같이 지운다(confirmSourceCrop의 재크롭
// 정리 로직과 동일한 패턴 — 위치가 아니라 id로 지워야 2·3단계에서 순서를 바꿔도 안전함).
function removeSource(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src) return;

  if (src.confirmed) {
    const ok = window.confirm(
      '이미 크롭이 확정된 사진입니다. 삭제하면 이 사진에서 만든 항목·사진·헤더가 모두 함께 삭제됩니다.\n' +
      '2단계 이후에서 IP명/가격/태그 등을 직접 고친 내용이 있다면 함께 사라집니다. 계속할까요?'
    );
    if (!ok) return;
  }

  if (src.itemIds && src.itemIds.length) {
    const idsToRemove = new Set(src.itemIds);
    state.items.filter((it) => idsToRemove.has(it.id)).forEach((it) => { delete state.photos[it.photoId]; });
    state.items = state.items.filter((it) => !idsToRemove.has(it.id));
  }
  if (src.headerId) {
    state.headers = state.headers.filter((h) => h.id !== src.headerId);
  }

  state.sources = state.sources.filter((s) => s.id !== srcId);
  renderSourceList();
}

// ---------- AI로 자동 채우기 (선택, 유료 — claude-sonnet-5 vision) ----------
// 대화형 AI로 하던 것과 같은 경험: 원본 레이아웃을 그대로(항목별로 오려서 재조합하지
// 않고) 몇 줄씩만 통째로 잘라서 보낸다. business-rules.md 원칙대로, 결과는 절대 그대로
// 확정되지 않고 항상 "확인 필요" 상태로만 표에 반영된다(uncertain 플래그 → ⚠ 배지).
// 백엔드가 없으면 친절한 안내만 뜨고 끝난다.
//
// 예전엔 항목 하나씩 오려서 세로로 재조합했는데, 좌표 계산이 조금만 어긋나도 엉뚱한
// 크롭이 만들어져 가격은 맞는데 IP명은 완전히 다른 상품 이름이 나오는 등 재조합 자체가
// 오류의 원인이었다. 원본 이미지를 자르지 않고 "N개 행" 단위로 통째로 잘라서 보내면
// 이런 재조합 버그가 생길 여지가 없다 — 채팅으로 원본 스크린샷을 그대로 보여줬을 때
// 인식률이 훨씬 좋았던 것과 같은 원리(레이아웃을 안 건드리는 게 핵심).
const AI_ROWS_PER_BATCH = 1; // 한 번에 1개 행(보통 5개 항목)만 보냄 — 너무 많으면 인식률 급락
const AI_STRIP_SCALE = 2; // 원본 텍스트가 작아서(칸 폭 176px) 2배로 키워서 보냄 — 행 단위로
// 바꾸면서(사진+텍스트를 원본 그대로 크롭) 이 확대를 실수로 빠뜨렸었다. 특정 항목에서
// 반복적으로 텍스트 인식이 실패하는 사례가 있어 다시 추가.

// 각 행의 "텍스트 영역"(사진 아래 ~ 다음 행 사진 시작 전) 높이를 계산.
// grid-detect가 잡아주는 건 사진 높이(cardH)뿐이라, 그 아래 상품명/가격 텍스트 줄은 직접 계산해야 한다.
// 마지막 행은 다음 행 기준점이 없어서, 다른 행들의 실측 텍스트 높이 중간값으로 추정한다
// (별점/예약마감일/여러 줄 상품명처럼 텍스트가 긴 포맷에서도 고정값보다 안정적).
function computeRowTextBottoms(src) {
  const { rows, cardH } = src.grid;
  const gaps = rows.slice(0, -1).map((y, i) => rows[i + 1] - (y + cardH));
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 200;
  return rows.map((y, i) => (i + 1 < rows.length ? rows[i + 1] : Math.min(src.img.height, y + cardH + medianGap)));
}

// rowIndices(연속된 행 번호들)에 해당하는 영역을 원본 이미지에서 폭 전체를 그대로 통째로
// 크롭한다 — 항목 단위로 오려서 재조합하지 않으므로 좌표 계산이 틀려서 엉뚱한 항목이
// 뒤섞이는 문제 자체가 생기지 않는다. 순서 혼동을 막기 위해 각 칸 위치에 #1,#2... 번호만
// 덧그린다(레이아웃 자체는 원본 그대로 유지).
function cropRowsRegion(src, rowIndices) {
  const { cols, rows, cardW } = src.grid;
  const rowTextBottoms = computeRowTextBottoms(src);
  const yTop = rows[rowIndices[0]];
  const yBottom = rowTextBottoms[rowIndices[rowIndices.length - 1]];
  const height = Math.max(20, yBottom - yTop);
  const raw = GridDetect.cropCell(src.img, 0, yTop, src.img.width, height);

  const scale = AI_STRIP_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = raw.width * scale;
  canvas.height = raw.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; // 확대해도 흐려지지 않게 (저해상도 텍스트라 흐림 처리는 오히려 해로움)
  ctx.drawImage(raw, 0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#ff3b30';
  ctx.font = 'bold 18px sans-serif';
  let n = 1;
  rowIndices.forEach((ri) => {
    const rowTop = (rows[ri] - yTop) * scale;
    const rowBottom = (rowTextBottoms[ri] - yTop) * scale;
    cols.forEach((cx) => {
      const x = cx * scale;
      ctx.strokeRect(x, rowTop, cardW * scale, rowBottom - rowTop);
      ctx.fillText(`#${n}`, x + 4, rowTop + 18 < rowBottom ? rowTop + 18 : rowTop + 14);
      n++;
    });
  });
  return canvas;
}

// cropRowsRegion과 달리 사진(cardH) 부분은 아예 빼고 그 아래 텍스트 라벨 줄만 잘라낸다.
// 이 도구가 이미 만들어낸 결과물(사진+IP명/가격 글자가 이미 렌더링된 최종 이미지)을
// 다시 소스로 올려서 "순서만 재조정"하고 싶을 때 전용 — 그 경우 사진을 보고 캐릭터를
// 새로 알아맞힐 필요가 전혀 없고(이미 아는 상품이라 사진은 그냥 참고용), 이미 깨끗하게
// 렌더링된 글자만 그대로 읽어오면 되므로 사진 픽셀을 통째로 뺀 만큼 이미지 토큰이 준다.
function cropLabelStripRegion(src, rowIndices) {
  const { cols, rows, cardW, cardH } = src.grid;
  const rowTextBottoms = computeRowTextBottoms(src);
  const yTop = rows[rowIndices[0]] + cardH;
  const yBottom = rowTextBottoms[rowIndices[rowIndices.length - 1]];
  const height = Math.max(20, yBottom - yTop);
  const raw = GridDetect.cropCell(src.img, 0, yTop, src.img.width, height);

  const scale = AI_STRIP_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = raw.width * scale;
  canvas.height = raw.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raw, 0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#ff3b30';
  ctx.font = 'bold 18px sans-serif';
  let n = 1;
  rowIndices.forEach((ri) => {
    const rowTop = (rows[ri] + cardH - yTop) * scale;
    const rowBottom = (rowTextBottoms[ri] - yTop) * scale;
    cols.forEach((cx) => {
      const x = cx * scale;
      ctx.strokeRect(x, rowTop, cardW * scale, rowBottom - rowTop);
      ctx.fillText(`#${n}`, x + 4, rowTop + 18 < rowBottom ? rowTop + 18 : rowTop + 14);
      n++;
    });
  });
  return canvas;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// AI가 돌려준 moodCluster명을 사전(state.dict.moodClusters)에 실제로 반영한다.
// 확신 있는(uncertain=false) IP만 클러스터에 편입시킨다 — 애매한 추정으로 사전을
// 오염시키면 5단계 자동 정렬이 계속 잘못된 기준으로 돌아가게 된다.
function applyAiClusterResult(item, moodClusterName) {
  if (!moodClusterName || !item.ip || item.aiUncertain) return false;
  const cluster = state.dict.moodClusters.find((c) => c.name === moodClusterName);
  if (!cluster) return false;
  if (cluster.members.includes(item.ip)) return false;
  cluster.members.push(item.ip);
  return true;
}

// 사전 기반 분류가 최우선이다: S/A급 등급표에 이미 있는 IP는 effectiveGrade()가
// subGrade와 무관하게 'S_A'로 취급하므로 여기서 건드릴 필요가 없다. 사전에 없는
// IP에 한해서만 AI가 추측한 성향(genderLean)으로 B급 남/여성향을 채운다 — B/C 등급
// 자체(판매 우선순위)는 AI가 알 수 없는 영업 판단이라 항상 B로 채우고, 사람이
// 드롭다운에서 필요하면 C로 낮춰서 직접 조정한다.
function applyAiGenderLean(item, genderLean) {
  if (!item.ip) return;
  if (state.dict.gradeTable.S.includes(item.ip) || state.dict.gradeTable.A.includes(item.ip)) return;
  if (genderLean === 'male') item.subGrade = 'B_male';
  else if (genderLean === 'female') item.subGrade = 'B_female';
}

async function aiFillSource(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src || !src.confirmed) return;

  const btn = document.querySelector(`button[data-action="ai-fill"][data-id="${srcId}"]`);
  const { rows, cols } = src.grid;
  const rowIndicesAll = Array.from({ length: rows.length }, (_, i) => i);
  const rowBatches = chunkArray(rowIndicesAll, AI_ROWS_PER_BATCH);
  let uncertainCount = 0;
  let filledCount = 0;
  let clusteredCount = 0;
  let genderClassifiedCount = 0;

  try {
    for (let b = 0; b < rowBatches.length; b++) {
      if (btn) { btn.disabled = true; btn.textContent = `인식 중... (${b + 1}/${rowBatches.length})`; }
      const rowBatch = rowBatches[b];
      // 이 배치에 실제로 존재하는 항목 인덱스(마지막 행은 칸 수보다 항목이 적을 수 있음)
      const itemIndicesInBatch = [];
      rowBatch.forEach((ri) => {
        for (let ci = 0; ci < cols.length; ci++) {
          const idx = ri * cols.length + ci;
          if (idx < src.itemCount) itemIndicesInBatch.push(idx);
        }
      });
      if (!itemIndicesInBatch.length) continue;

      const stripCanvas = cropRowsRegion(src, rowBatch);
      const dataUrl = stripCanvas.toDataURL('image/png');
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

      const r = await fetch('/api/parse-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64, mediaType: 'image/png', expectedCount: itemIndicesInBatch.length, layout: 'cardStrip',
          ipDictHint: state.dict.ipNameMap, tagWhitelist: tagWhitelistForActiveStore(),
          moodClusters: state.dict.moodClusters, productLineNames: state.dict.productLineNames,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'AI 인식 실패');

      data.items.slice(0, itemIndicesInBatch.length).forEach((result, j) => {
        const item = state.items[src.itemStartIndex + itemIndicesInBatch[j]];
        if (!item) return;
        // 모델이 그래도 ip를 비워서 주면 rawText로 대체 — 빈 칸보다는 "확인해서 고칠 글자"가 있는 게 낫다.
        // trim 필수: 사전(gradeTable/ipNameMap) 조회가 문자열 완전일치라서, 앞뒤 공백이 하나라도
        // 남으면 "주술회전"처럼 이미 사전에 있는 IP도 조용히 매칭 실패해서 미분류로 빠진다.
        item.ip = (result.ip || result.rawText || '').trim();
        item.price = result.price || '';
        item.ship = result.ship || '무료배송';
        item.tag = result.tag || '';
        item.aiUncertain = !!result.uncertain || !item.ip;
        if (item.aiUncertain) uncertainCount++;
        if (applyAiClusterResult(item, result.moodCluster)) clusteredCount++;
        const gradeBefore = item.subGrade;
        applyAiGenderLean(item, result.genderLean);
        if (item.subGrade !== gradeBefore) genderClassifiedCount++;
        filledCount++;
      });
      renderDataTable();
    }
    if (clusteredCount) saveDictLocal('moodClusters', state.dict.moodClusters);
    alert(`AI가 ${filledCount}개 항목을 채웠습니다.\n확인이 필요한 항목: ${uncertainCount}개 (⚠ 표시된 곳을 확인하세요)\n분위기 클러스터에 새로 편입된 IP: ${clusteredCount}개\n등급표에 없어 AI가 성향(B급 남/여성향)을 추측한 항목: ${genderClassifiedCount}개 (등급 자체는 필요시 2단계에서 직접 조정)`);
  } catch (e) {
    alert(`AI로 채우기 실패: ${e.message}\n(백엔드가 배포되어 있지 않다면 정상입니다 — 수동으로 입력해주세요)`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI로 채우기'; }
  }
}

// "라벨만 재인식" — 이 도구가 이미 만든 결과물(사진 아래 IP명/가격 글자가 이미
// 렌더링된 카드)을 다시 소스로 올려서 순서만 재조정하고 싶을 때 전용. aiFillSource와
// 달리 사진은 아예 안 보내고(cropLabelStripRegion), 사전 매칭/성향 추측/클러스터 판단도
// 안 한다 — 그건 크게 다시 잡을 필요 없는 "이미 렌더링된 글자를 그대로 옮겨 적기"만
// 하는 작업이라 훨씬 저렴하다. 성향/클러스터가 필요하면 이 다음 3단계 "AI 분류로
// 정렬 보조"(텍스트 전용, 더 저렴)를 이어서 쓰면 된다.
async function ocrLabelsForSource(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src || !src.confirmed) return;

  const btn = document.querySelector(`button[data-action="ocr-label"][data-id="${srcId}"]`);
  const { rows, cols } = src.grid;
  const rowIndicesAll = Array.from({ length: rows.length }, (_, i) => i);
  const rowBatches = chunkArray(rowIndicesAll, AI_ROWS_PER_BATCH);
  let uncertainCount = 0;
  let filledCount = 0;
  let clusteredCount = 0;
  let genderClassifiedCount = 0;

  try {
    for (let b = 0; b < rowBatches.length; b++) {
      if (btn) { btn.disabled = true; btn.textContent = `라벨 인식 중... (${b + 1}/${rowBatches.length})`; }
      const rowBatch = rowBatches[b];
      const itemIndicesInBatch = [];
      rowBatch.forEach((ri) => {
        for (let ci = 0; ci < cols.length; ci++) {
          const idx = ri * cols.length + ci;
          if (idx < src.itemCount) itemIndicesInBatch.push(idx);
        }
      });
      if (!itemIndicesInBatch.length) continue;

      const stripCanvas = cropLabelStripRegion(src, rowBatch);
      const dataUrl = stripCanvas.toDataURL('image/png');
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

      // 처음엔 "이미 깨끗하게 렌더링된 글자를 그대로 옮겨 적기"만 하는 걸로 설계했는데,
      // 실제로는 원본 매장 스크린샷(상품명이 지저분한 원문 그대로인 경우)에도 이 버튼을
      // 쓰고 싶어했다 — 그대로 옮겨 적기만 하면 상품명 전체가 그대로 ip에 들어가버려서
      // 쓸모가 없었다. 그래서 이제 aiFillSource(1단계 "AI로 채우기")와 똑같은 IP명 추출
      // 규칙(사전/라인업 태그/분위기 클러스터/성향)을 그대로 적용한다 — 사진만 안 보낼 뿐,
      // 인식 품질/결과 처리는 동일하다.
      const r = await fetch('/api/ocr-label', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64, mediaType: 'image/png', expectedCount: itemIndicesInBatch.length,
          ipDictHint: state.dict.ipNameMap, tagWhitelist: tagWhitelistForActiveStore(),
          moodClusters: state.dict.moodClusters, productLineNames: state.dict.productLineNames,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '라벨 인식 실패');

      data.items.slice(0, itemIndicesInBatch.length).forEach((result, j) => {
        const item = state.items[src.itemStartIndex + itemIndicesInBatch[j]];
        if (!item) return;
        item.ip = (result.ip || result.rawText || '').trim();
        item.price = result.price || '';
        item.ship = result.ship || '무료배송';
        item.tag = result.tag || '';
        item.aiUncertain = !!result.uncertain || !item.ip;
        if (item.aiUncertain) uncertainCount++;
        if (applyAiClusterResult(item, result.moodCluster)) clusteredCount++;
        const gradeBefore = item.subGrade;
        applyAiGenderLean(item, result.genderLean);
        if (item.subGrade !== gradeBefore) genderClassifiedCount++;
        filledCount++;
      });
      renderDataTable();
    }
    if (clusteredCount) saveDictLocal('moodClusters', state.dict.moodClusters);
    alert(`라벨에서 ${filledCount}개 항목을 인식했습니다.\n확인이 필요한 항목: ${uncertainCount}개 (⚠ 표시된 곳을 확인하세요)\n분위기 클러스터에 새로 편입된 IP: ${clusteredCount}개\n등급표에 없어 성향을 새로 추측한 항목: ${genderClassifiedCount}개`);
  } catch (e) {
    alert(`라벨 인식 실패: ${e.message}\n(백엔드가 배포되어 있지 않다면 정상입니다 — 수동으로 입력해주세요)`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🏷️ 라벨만 재인식'; }
  }
}

// ============================================================
// STEP 2 — 표 정리
// ============================================================
function populateStoreSelects() {
  const opts = Object.entries(state.dict.storeProfiles)
    .map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('');
  ['storeSelectStep2', 'storeSelectStep5'].forEach((id) => {
    const el = document.getElementById(id);
    el.innerHTML = opts;
    el.value = state.activeStore;
  });
}

function tagWhitelistForActiveStore() {
  const profile = state.dict.storeProfiles[state.activeStore];
  return (profile && profile.tagWhitelist) || [];
}

function ipDictSuggestionHtml(ip) {
  if (!ip) return '';
  const map = state.dict.ipNameMap;
  if (map[ip] && map[ip] !== ip) {
    return `<span class="dict-suggest">사전 표기: <b>${map[ip]}</b> <button class="link-btn" data-apply-suggest="${ip}">적용</button></span>`;
  }
  const knownValues = new Set(Object.values(map));
  if (!knownValues.has(ip) && !map[ip]) {
    return `<span class="warn-badge">⚠ 사전에 없음 - 확인 필요</span>`;
  }
  return '';
}

// 배송비는 이 화면(2단계)에서는 편집하지 않는다 — 대부분 무료배송으로 고정이라 편집란이
// 오히려 목록을 길게 만들어 가독성을 해쳤음. 값 자체는 item.ship에 그대로 남아있고
// (기본 "무료배송"), 예외적으로 바꿔야 하면 3단계 카드의 "✎ 수정" 다이얼로그에서 가능하다.
// 같은 IP명끼리 왼쪽 테두리 색을 맞춰서 눈으로 묶어 볼 수 있게 한다. IP 문자열을
// 해시해서 고정 팔레트에서 색을 고르므로, 같은 이름이면 항상 같은 색이 나온다
// (여러 IP가 팔레트 안에서 같은 색을 나눠 쓸 수 있는데, 전역 구분자가 아니라
// "이 화면에서 같은 걸 묶어보기" 용도라 색상 충돌은 감수할 만한 트레이드오프다).
const IP_COLOR_PALETTE = ['#e74c3c', '#e67e22', '#f0b400', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#c0392b', '#2c3e50', '#d35400'];
function colorForIp(ip) {
  if (!ip) return 'transparent';
  let hash = 0;
  for (let i = 0; i < ip.length; i++) hash = (hash * 31 + ip.charCodeAt(i)) >>> 0;
  return IP_COLOR_PALETTE[hash % IP_COLOR_PALETTE.length];
}

function renderDataTable() {
  const grid = document.getElementById('dataTableBody');
  grid.innerHTML = '';
  const locked = state.textLocked;
  state.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = `step2-card${step2SelectedIds.has(item.id) ? ' group-selected' : ''}${locked ? ' text-locked' : ''}`;
    card.dataset.itemId = item.id;
    card.style.borderLeftColor = colorForIp(item.ip);
    const tagOptions = ['<option value="">(없음)</option>']
      .concat(tagWhitelistForActiveStore().map((t) => `<option value="${t}" ${item.tag === t ? 'selected' : ''}>${t}</option>`))
      .join('');
    const dis = locked ? 'disabled' : '';
    card.innerHTML = `
      <div class="thumb"></div>
      <div class="fields">
        <div class="fields-row">
          <input class="ip-input" value="${item.ip}" placeholder="IP명" ${dis} />
          <select class="tag-select" ${dis}>${tagOptions}</select>
        </div>
        <div class="suggest-slot">${item.aiUncertain ? '<span class="warn-badge">⚠ AI 추정 - 확인 필요</span> ' : ''}${ipDictSuggestionHtml(item.ip)}</div>
        <div class="fields-row">
          <input class="price-input" value="${item.price}" placeholder="가격 (예: 44,400원)" ${dis} />
          <select class="subgrade-select" ${dis}>
            <option value="other" ${item.subGrade === 'other' ? 'selected' : ''}>기타</option>
            <option value="B_male" ${item.subGrade === 'B_male' ? 'selected' : ''}>B급 남성향</option>
            <option value="B_female" ${item.subGrade === 'B_female' ? 'selected' : ''}>B급 여성향</option>
            <option value="C_male" ${item.subGrade === 'C_male' ? 'selected' : ''}>C급 남성향</option>
            <option value="C_female" ${item.subGrade === 'C_female' ? 'selected' : ''}>C급 여성향</option>
          </select>
        </div>
      </div>
    `;
    card.querySelector('.thumb').appendChild(scaledThumb(state.photos[item.photoId]));
    grid.appendChild(card);

    card.querySelector('.ip-input').addEventListener('change', (e) => { item.ip = e.target.value.trim(); item.aiUncertain = false; renderDataTable(); });
    card.querySelector('.tag-select').addEventListener('change', (e) => { item.tag = e.target.value; });
    card.querySelector('.price-input').addEventListener('change', (e) => { item.price = e.target.value.trim(); });
    card.querySelector('.subgrade-select').addEventListener('change', (e) => { item.subGrade = e.target.value; });
    const suggestBtn = card.querySelector('[data-apply-suggest]');
    if (suggestBtn) suggestBtn.addEventListener('click', () => {
      item.ip = state.dict.ipNameMap[item.ip];
      renderDataTable();
    });
  });

  attachMarqueeSelection(grid, '.step2-card', (idSet) => { step2SelectedIds = idSet; renderBulkEditBar(); });
  renderBulkEditBar();
}

// 2단계에서 빈 배경을 드래그로 여러 행을 묶어 선택하면(step2SelectedIds), 태그나
// 분위기 클러스터 편입을 선택 항목 전체에 한 번에 적용할 수 있는 툴바를 보여준다.
// 하나하나 드롭다운을 고쳐야 했던 불편함(원래 설계 그대로면 항목이 많을 때 매우 번거로움)을 줄이기 위함.
function renderBulkEditBar() {
  const bar = document.getElementById('bulkEditBar');
  if (!bar) return;
  const ids = [...step2SelectedIds].filter((id) => state.items.some((i) => i.id === id));
  if (!ids.length || state.textLocked) { bar.style.display = 'none'; bar.innerHTML = ''; return; }

  const tagOptions = ['<option value="">(없음)</option>']
    .concat(tagWhitelistForActiveStore().map((t) => `<option value="${t}">${t}</option>`)).join('');
  const clusterOptions = ['<option value="">클러스터 선택</option>']
    .concat(state.dict.moodClusters.map((c) => `<option value="${c.name}">${c.name}</option>`)).join('');

  bar.style.display = 'flex';
  bar.innerHTML = `
    <strong>${ids.length}개 선택됨</strong>
    <select id="bulkTagSelect">${tagOptions}</select>
    <button class="btn" id="bulkApplyTagBtn">선택 항목 태그 일괄 적용</button>
    <select id="bulkClusterSelect">${clusterOptions}</select>
    <button class="btn" id="bulkApplyClusterBtn">선택 항목 IP를 이 클러스터에 일괄 편입</button>
    <button class="btn ghost" id="bulkClearSelectionBtn">선택 해제</button>
  `;

  document.getElementById('bulkApplyTagBtn').addEventListener('click', () => {
    const tag = document.getElementById('bulkTagSelect').value;
    ids.forEach((id) => { const it = state.items.find((i) => i.id === id); if (it) it.tag = tag; });
    renderDataTable();
  });
  document.getElementById('bulkApplyClusterBtn').addEventListener('click', () => {
    const clusterName = document.getElementById('bulkClusterSelect').value;
    if (!clusterName) return;
    const cluster = state.dict.moodClusters.find((c) => c.name === clusterName);
    if (!cluster) return;
    let added = 0;
    ids.forEach((id) => {
      const it = state.items.find((i) => i.id === id);
      if (it && it.ip && !cluster.members.includes(it.ip)) { cluster.members.push(it.ip); added++; }
    });
    if (added) saveDictLocal('moodClusters', state.dict.moodClusters);
    alert(`"${clusterName}" 클러스터에 IP ${added}개를 새로 편입했습니다.`);
    renderDataTable();
  });
  document.getElementById('bulkClearSelectionBtn').addEventListener('click', () => {
    step2SelectedIds = new Set();
    renderDataTable();
  });
}

function scaledThumb(canvas) {
  const img = document.createElement('img');
  img.className = 'pthumb';
  img.src = canvas ? canvas.toDataURL('image/png') : '';
  return img;
}

// ============================================================
// STEP 3 / 4 — 전체 미리보기 (공용 렌더)
// ============================================================
// 카드 순서 변경(드래그)은 브라우저 네이티브 HTML5 draggable API 대신 마우스
// mousedown/mousemove/mouseup으로 직접 구현한다. 네이티브 드래그는 트랙패드/입력 방식에
// 따라 dragstart 자체가 안 잡히는 경우가 실사용 중 보고됐고(Playwright로 실제 마우스
// 이동을 흉내낸 dragTo()도 재현 실패), 브라우저마다 미묘하게 동작이 달라 신뢰하기 어렵다.
// 아래 마우스 이벤트 기반 방식은 이미 이 파일의 빈 배경 드래그 다중 선택(마퀴 선택)에서
// 검증된 것과 같은 패턴이라 훨씬 안정적이다.
let customDragCleanup = null; // 현재 진행 중인 카드 드래그의 정리(cleanup) 함수 — 중복 시작 방지용

// forceSingle이 true면(Alt+드래그 또는 "1개만" 버튼으로 무장한 경우) IP가 같아도 이
// 카드 하나만 이동한다. 그 외엔 마퀴로 직접 여러 장을 선택해뒀으면 그 선택을 그대로
// 쓰고, 아니면 같은 IP를 가진 카드 전부를 기본값으로 묶어서 같이 이동시킨다.
function startCardDrag(itemId, containerId, opts, forceSingle) {
  if (customDragCleanup) customDragCleanup(); // 혹시 이전 드래그가 안 끝났으면 먼저 정리

  const draggedItem = state.items.find((it) => it.id === itemId);
  let dragIds;
  if (forceSingle) {
    dragIds = [itemId];
  } else if (groupSelectedIds.has(itemId) && groupSelectedIds.size > 1) {
    dragIds = Array.from(groupSelectedIds);
  } else if (draggedItem && draggedItem.ip) {
    dragIds = state.items.filter((it) => it.ip === draggedItem.ip).map((it) => it.id);
  } else {
    dragIds = [itemId];
  }
  const dragIdSet = new Set(dragIds);
  let currentTargetEl = null;
  let lastClientY = 0;

  document.querySelectorAll(`.pcard[data-item-id]`).forEach((c) => {
    if (dragIdSet.has(c.dataset.itemId)) c.classList.add('drag-source');
  });

  // 항목이 155개처럼 많으면 미리보기가 화면 여러 배 높이로 길어지는데, 네이티브 HTML5
  // 드래그는 뷰포트 가장자리에 마우스를 대고 있으면 자동으로 스크롤해주는 기능이 브라우저에
  // 내장돼 있다. 이 커스텀 드래그로 바꾸면서 그 기능이 사라지면 "위쪽/아래쪽 다른 페이지에
  // 있는 카드로는 드래그를 아예 못 하는" 퇴보가 생기므로, 같은 동작을 직접 구현한다.
  const EDGE_SIZE = 70;
  const MAX_SCROLL_SPEED = 18;
  const scrollTimer = setInterval(() => {
    if (lastClientY < EDGE_SIZE) {
      const speed = MAX_SCROLL_SPEED * (1 - lastClientY / EDGE_SIZE);
      window.scrollBy(0, -speed);
    } else if (lastClientY > window.innerHeight - EDGE_SIZE) {
      const speed = MAX_SCROLL_SPEED * (1 - (window.innerHeight - lastClientY) / EDGE_SIZE);
      window.scrollBy(0, speed);
    }
  }, 16);

  function findCardUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.pcard') : null;
  }

  function onMouseMove(e) {
    lastClientY = e.clientY;
    const card = findCardUnder(e.clientX, e.clientY);
    if (currentTargetEl && currentTargetEl !== card) currentTargetEl.classList.remove('dragover');
    if (card && !dragIdSet.has(card.dataset.itemId)) {
      card.classList.add('dragover');
      currentTargetEl = card;
    } else {
      currentTargetEl = null;
    }
  }

  function cleanup() {
    clearInterval(scrollTimer);
    document.querySelectorAll('.pcard.drag-source').forEach((c) => c.classList.remove('drag-source'));
    if (currentTargetEl) currentTargetEl.classList.remove('dragover');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    customDragCleanup = null;
  }

  function onMouseUp(e) {
    const card = findCardUnder(e.clientX, e.clientY);
    const targetId = card && !dragIdSet.has(card.dataset.itemId) ? card.dataset.itemId : null;
    cleanup();
    if (targetId) {
      moveItemsBeforeTarget(dragIds, targetId);
      renderPreviewGrid(containerId, state.items, opts);
      updateSplitPreviewText();
    }
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  customDragCleanup = cleanup;
}

// 빈 배경을 마우스로 드래그해서 여러 카드를 한 번에 선택하는 용도 — 체크박스(삭제용
// pendingDeleteIds)와는 별개의 개념이라 컨테이너별로 따로 관리한다.
let groupSelectedIds = new Set();

// "1개만" 버튼으로 무장(arm)한 카드의 id — 이 상태는 저장/캐시되지 않는 일회성 값이다.
// 다음 드래그 한 번에만 적용되고 쓰이자마자(또는 다시 눌러서 취소하면) null로 돌아간다.
let singleMoveArmedId = null;

// 5열 x 5줄 = 25개 단위로 박스(페이지)를 나눈다. 박스는 항상 2열로 나란히 배치되고,
// 홀수 개(마지막 박스가 짝이 없을 때)면 빈 박스를 하나 더 붙여 짝을 맞춘다 — 그래야
// 마지막 박스 하나만 있을 때 카드가 컨테이너 폭 전체로 늘어나 커지는 걸 막을 수 있다.
const PREVIEW_PAGE_GROUP_SIZE = 25;

// 선택된 항목들(movingIds)을 원래 상대 순서를 유지한 채 targetItemId 위치로 통째로 옮긴다.
// 인덱스가 아니라 id 기준으로 계산해서, 몇 개를 옮기든(그룹이든 단일이든) 항상 정확하다.
function moveItemsBeforeTarget(movingIds, targetItemId) {
  const idSet = new Set(movingIds);
  if (idSet.has(targetItemId)) return; // 자기 자신 위에 드롭하면 아무 일도 안 함
  const movingItems = state.items.filter((it) => idSet.has(it.id));
  const remaining = state.items.filter((it) => !idSet.has(it.id));
  const targetPos = remaining.findIndex((it) => it.id === targetItemId);
  const insertAt = targetPos === -1 ? remaining.length : targetPos;
  remaining.splice(insertAt, 0, ...movingItems);
  state.items = remaining;
}

// 카드가 없는 빈 배경을 클릭+드래그하면 사각형 선택 영역을 그려서, 겹치는 카드들을
// group-selected 상태로 표시한다. 이후 그 중 하나를 드래그하면 선택된 카드 전체가
// 순서를 유지한 채 함께 이동한다 (체크박스 선택과는 별개 — 삭제용이 아니라 이동 전용).
//
// 선택박스 엘리먼트를 container의 자식으로 두고 container 기준 좌표로 그렸었는데,
// 드래그가 container 바깥으로 나가는 순간 박스가 잘려 보여서(실제 판정 로직은 계속
// 정상 동작했지만) 마치 선택이 안 되는 것처럼 느껴지는 문제가 있었다. body에 직접
// 붙이고 position:fixed + 뷰포트 좌표를 그대로 써서 페이지 전체에서 끊김 없이 그려지게 한다.
function attachMarqueeSelection(container, cardSelector, onSelectionChange) {
  // container는 매 렌더마다 innerHTML만 비워지고 같은 DOM 노드가 재사용되므로, 리스너를
  // 매번 새로 붙이면 렌더될 때마다 계속 누적된다 — 한 번만 붙인다.
  if (container.dataset.marqueeAttached) return;
  container.dataset.marqueeAttached = '1';
  let marqueeEl = null;
  let startX = 0;
  let startY = 0;
  let active = false;

  function rectFrom(curX, curY) {
    return {
      x1: Math.min(startX, curX), x2: Math.max(startX, curX),
      y1: Math.min(startY, curY), y2: Math.max(startY, curY),
    };
  }

  function updateMarqueeEl(box) {
    marqueeEl.style.left = `${box.x1}px`;
    marqueeEl.style.top = `${box.y1}px`;
    marqueeEl.style.width = `${box.x2 - box.x1}px`;
    marqueeEl.style.height = `${box.y2 - box.y1}px`;
  }

  function highlightIntersecting(box) {
    container.querySelectorAll(cardSelector).forEach((card) => {
      const r = card.getBoundingClientRect();
      const intersects = !(r.right < box.x1 || r.left > box.x2 || r.bottom < box.y1 || r.top > box.y2);
      card.classList.toggle('group-selected', intersects);
    });
  }

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest(cardSelector)) return; // 카드 위에서 시작하면 기존 드래그 이동 우선
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee-box marquee-box-fixed';
    document.body.appendChild(marqueeEl);
    updateMarqueeEl(rectFrom(startX, startY));
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!active || !marqueeEl) return;
    const box = rectFrom(e.clientX, e.clientY);
    updateMarqueeEl(box);
    highlightIntersecting(box);
  });

  window.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    if (marqueeEl) { marqueeEl.remove(); marqueeEl = null; }
    const idSet = new Set(
      Array.from(container.querySelectorAll(`${cardSelector}.group-selected`)).map((c) => c.dataset.itemId)
    );
    if (onSelectionChange) onSelectionChange(idSet);
  });
}

function renderPreviewGrid(containerId, items, opts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const pages = chunk(items, PREVIEW_PAGE_GROUP_SIZE);
  if (pages.length === 0) pages.push([], []);
  else if (pages.length % 2 === 1) pages.push([]);

  pages.forEach((pageItems, pageIdx) => {
    const pageBox = document.createElement('div');
    pageBox.className = `preview-page-box${pageItems.length === 0 ? ' empty' : ''}`;
    pageBox.innerHTML = `<div class="preview-page-label">${pageIdx + 1}p</div>`;
    const grid = document.createElement('div');
    grid.className = 'preview-grid';
    pageBox.appendChild(grid);
    container.appendChild(pageBox);

    pageItems.forEach((item) => {
      const locked = state.textLocked;
      // 같은 IP가 2개 이상이면 드래그 시 기본적으로 같이 묶여서 이동한다 — "1개만" 버튼은
      // 그 경우에만 의미가 있으므로 IP가 하나뿐이거나 없으면 아예 표시하지 않는다.
      const siblingCount = item.ip ? state.items.filter((it) => it.ip === item.ip).length : 0;
      const armed = singleMoveArmedId === item.id;
      const card = document.createElement('div');
      card.className = `pcard${groupSelectedIds.has(item.id) ? ' group-selected' : ''}${locked ? ' text-locked' : ''}${opts.draggable ? ' draggable-card' : ''}${armed ? ' single-move-armed' : ''}`;
      card.dataset.itemId = item.id;
      card.style.borderLeftColor = colorForIp(item.ip);

      const checkboxHtml = opts.selectable
        ? `<input type="checkbox" class="del-check" data-id="${item.id}" ${state.pendingDeleteIds.includes(item.id) ? 'checked' : ''} ${locked ? 'disabled' : ''} />`
        : '';
      const singleMoveBtnHtml = (opts.draggable && siblingCount > 1)
        ? `<button class="single-move-btn${armed ? ' armed' : ''}" data-single-move="${item.id}"
             title="같은 IP(${siblingCount}개)가 기본으로 같이 이동돼요. 이 버튼을 누르면 다음 드래그는 이 카드 1개만 이동합니다 (Alt+드래그로도 같은 효과)">
             ${armed ? '✓ 1개만' : '1개만'}
           </button>`
        : '';

      card.innerHTML = `
        ${checkboxHtml}
        <button class="edit-btn" data-edit="${item.id}" ${locked ? 'disabled' : ''}>✎</button>
        ${singleMoveBtnHtml}
        <div class="thumb-slot"></div>
        <div class="ip">${item.aiUncertain ? '⚠ ' : ''}${item.ip || '<span style=\"color:#c0c4cc\">IP명 없음</span>'}${item.tag ? `<span class="tag">${item.tag}</span>` : ''}</div>
        <div class="price">${item.price || ''}</div>
        <div class="ship"${state.showShipping ? '' : ' style="visibility:hidden"'}>${item.ship || ''}</div>
      `;
      card.querySelector('.thumb-slot').appendChild(scaledThumb(state.photos[item.photoId]));
      grid.appendChild(card);

      if (!locked) card.querySelector('[data-edit]').addEventListener('click', () => openItemDialog(item.id));

      if (opts.selectable && !locked) {
        card.querySelector('.del-check').addEventListener('change', (e) => {
          if (e.target.checked) state.pendingDeleteIds.push(item.id);
          else state.pendingDeleteIds = state.pendingDeleteIds.filter((id) => id !== item.id);
          updateSelectedCount();
        });
      }

      const singleMoveBtn = card.querySelector('.single-move-btn');
      if (singleMoveBtn) {
        // 텍스트 잠금과 무관하게 항상 눌러지게 둔다 — 이건 텍스트를 건드리는 게 아니라
        // 드래그(정렬) 방식만 바꾸는 버튼이라, 드래그 자체가 잠금과 무관한 것과 같은 원칙.
        singleMoveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          singleMoveArmedId = armed ? null : item.id; // 다시 누르면 무장 해제(토글)
          renderPreviewGrid(containerId, state.items, opts);
        });
      }

      if (opts.draggable) {
        card.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          // 버튼/체크박스 클릭은 드래그로 이어지지 않고 그대로 통과
          if (e.target.closest('.edit-btn') || e.target.closest('.del-check') || e.target.closest('.single-move-btn')) return;
          e.preventDefault();
          const forceSingle = e.altKey || singleMoveArmedId === item.id;
          if (singleMoveArmedId === item.id) singleMoveArmedId = null; // 무장 상태는 한 번 쓰면 바로 해제
          startCardDrag(item.id, containerId, opts, forceSingle);
        });
      }
    });
  });

  // cardSelector/onSelectionChange 인자가 빠져 있던 버그 수정 — container만 넘기면
  // attachMarqueeSelection 내부의 querySelectorAll(cardSelector)가 undefined를 셀렉터로
  // 받아 카드를 하나도 못 찾아서, 빈 배경을 드래그해도 아무 카드도 group-selected로
  // 표시되지 않는(마퀴 선택이 완전히 먹통인) 상태였다.
  attachMarqueeSelection(container, '.pcard', (idSet) => { groupSelectedIds = idSet; });
  if (containerId === 'previewGrid') updateSplitPreviewText();
}

function updateTextLockBanner() {
  const banner = document.getElementById('textLockBanner');
  if (banner) banner.style.display = state.textLocked ? 'block' : 'none';
}

function updateSelectedCount() {
  document.getElementById('selectedCount').textContent = state.pendingDeleteIds.length
    ? `${state.pendingDeleteIds.length}개 선택됨` : '';
}
function updateSplitPreviewText() {
  document.getElementById('splitPreviewText').textContent = splitSummaryText(state.items);
}

// ---------- 항목 편집 다이얼로그 ----------
let editingItemId = null;
function openItemDialog(itemId) {
  editingItemId = itemId;
  const item = state.items.find((i) => i.id === itemId);
  document.getElementById('editIp').value = item.ip;
  document.getElementById('editPrice').value = item.price;
  document.getElementById('editSubGrade').value = item.subGrade;
  document.getElementById('editPushEnd').checked = !!item.pushToEnd;

  const tagSelect = document.getElementById('editTag');
  const whitelist = tagWhitelistForActiveStore();
  tagSelect.innerHTML = ['<option value="">(없음)</option>']
    .concat(whitelist.map((t) => `<option value="${t}">${t}</option>`)).join('');
  if (whitelist.includes(item.tag)) tagSelect.value = item.tag;

  const vtuberField = document.getElementById('editVtuberField');
  const vtuberInput = document.getElementById('editVtuberAffil');
  const isVtuber = item.ip === 'VTuber';
  vtuberField.style.display = isVtuber ? 'block' : 'none';
  vtuberInput.value = isVtuber && !whitelist.includes(item.tag) ? item.tag : '';

  const shipMode = document.getElementById('editShipMode');
  const shipCustom = document.getElementById('editShipCustom');
  if (item.ship === '무료배송' || item.ship === '3,000원') {
    shipMode.value = item.ship; shipCustom.style.display = 'none'; shipCustom.value = '';
  } else {
    shipMode.value = 'custom'; shipCustom.style.display = 'block'; shipCustom.value = item.ship;
  }

  const ipDatalist = document.getElementById('ipNameDatalist');
  ipDatalist.innerHTML = Object.values(state.dict.ipNameMap).map((v) => `<option value="${v}">`).join('');

  document.getElementById('itemDialog').showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('editIp').addEventListener('input', (e) => {
    document.getElementById('editVtuberField').style.display = e.target.value.trim() === 'VTuber' ? 'block' : 'none';
  });
  document.getElementById('editShipMode').addEventListener('change', (e) => {
    document.getElementById('editShipCustom').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('cancelItemDialog').addEventListener('click', () => document.getElementById('itemDialog').close());
  document.getElementById('saveItemDialog').addEventListener('click', () => {
    const item = state.items.find((i) => i.id === editingItemId);
    item.ip = document.getElementById('editIp').value.trim();
    const isVtuber = item.ip === 'VTuber';
    const vtuberAffil = document.getElementById('editVtuberAffil').value.trim();
    item.tag = isVtuber && vtuberAffil ? vtuberAffil : document.getElementById('editTag').value;
    item.price = document.getElementById('editPrice').value.trim();
    const shipMode = document.getElementById('editShipMode').value;
    item.ship = shipMode === 'custom' ? document.getElementById('editShipCustom').value.trim() : shipMode;
    item.subGrade = document.getElementById('editSubGrade').value;
    item.pushToEnd = document.getElementById('editPushEnd').checked;
    item.aiUncertain = false; // 사람이 직접 확인/수정했으므로 확인필요 배지 해제
    document.getElementById('itemDialog').close();
    renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
    renderDataTable();
  });
});

// ============================================================
// STEP 3 — 삭제 (즉시 반영 + 실행취소)
// ============================================================
// 예전엔 "체크박스 선택 → 확인 화면 → 확정"의 별도 단계였지만, 확인 화면을 매번
// 거치는 게 번거롭다는 피드백에 따라 바로 삭제하고 실행취소로 되돌릴 수 있게 바꿨다.
// 되돌리기는 가장 최근 삭제 1건만 지원한다 (여러 번 삭제하면 이전 실행취소는 사라짐).
function deleteSelectedItems() {
  if (!state.pendingDeleteIds.length) { alert('삭제할 항목을 먼저 선택하세요.'); return; }
  const idSet = new Set(state.pendingDeleteIds);
  const removed = [];
  state.items.forEach((item, index) => { if (idSet.has(item.id)) removed.push({ item, index }); });
  state.items = state.items.filter((item) => !idSet.has(item.id));
  state.pendingDeleteIds = [];
  state.lastDeletedBatch = removed;
  state.orderConfirmed = false;
  renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
  showUndoBanner(removed.length);
}

// 삭제 당시 기록해둔 원래 인덱스(index) 그대로 다시 끼워 넣어 원본 배치를 복원한다.
function undoDelete() {
  if (!state.lastDeletedBatch || !state.lastDeletedBatch.length) return;
  const removedByIndex = new Map(state.lastDeletedBatch.map((e) => [e.index, e.item]));
  const totalLength = state.items.length + state.lastDeletedBatch.length;
  const restored = [];
  let ri = 0;
  for (let i = 0; i < totalLength; i++) {
    restored.push(removedByIndex.has(i) ? removedByIndex.get(i) : state.items[ri++]);
  }
  state.items = restored;
  state.lastDeletedBatch = null;
  renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
  hideUndoBanner();
}

function showUndoBanner(count) {
  document.getElementById('undoBannerText').textContent = `${count}개 삭제됨`;
  document.getElementById('undoBanner').style.display = 'flex';
}
function hideUndoBanner() {
  state.lastDeletedBatch = null;
  const banner = document.getElementById('undoBanner');
  if (banner) banner.style.display = 'none';
}

// ============================================================
// STEP 4 — 자동 정렬
// ============================================================
function effectiveGrade(item) {
  if (state.dict.gradeTable.S.includes(item.ip) || state.dict.gradeTable.A.includes(item.ip)) return 'S_A';
  return item.subGrade || 'other';
}
function gradeOrderFor(genderPriority) {
  return genderPriority === 'female-first'
    ? ['S_A', 'B_female', 'B_male', 'C_female', 'C_male', 'other']
    : ['S_A', 'B_male', 'B_female', 'C_male', 'C_female', 'other'];
}
function clusterInfo(ip) {
  for (let ci = 0; ci < state.dict.moodClusters.length; ci++) {
    const members = state.dict.moodClusters[ci].members || [];
    const mi = members.indexOf(ip);
    if (mi >= 0) return { ci, mi };
  }
  return { ci: Infinity, mi: 0 };
}

function autoSortItems() {
  const profile = state.dict.storeProfiles[state.activeStore];
  const order = gradeOrderFor(profile ? profile.genderPriority : 'male-first');

  const normal = state.items.filter((i) => !i.pushToEnd);
  const pushed = state.items.filter((i) => i.pushToEnd);

  const sorter = (a, b) => {
    const ga = order.indexOf(effectiveGrade(a)), gb = order.indexOf(effectiveGrade(b));
    if (ga !== gb) return ga - gb;
    const ca = clusterInfo(a.ip), cb = clusterInfo(b.ip);
    if (ca.ci !== cb.ci) return ca.ci - cb.ci;
    if (ca.mi !== cb.mi) return ca.mi - cb.mi;
    if (a.ip !== b.ip) return a.ip.localeCompare(b.ip, 'ko');
    return 0;
  };

  normal.sort(sorter);
  pushed.sort(sorter);
  state.items = [...normal, ...pushed];
  state.orderConfirmed = false;
  renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
}

// 3단계용 "AI 분류 보조" — 1단계 "AI로 채우기"(aiFillSource, api/parse-image)와는 완전히
// 다른 경로다. 저건 사진을 다시 보내 ip/가격/태그까지 새로 뽑아내는 이미지 인식이라
// 비용이 크고, 이미 확정(또는 텍스트 잠금)된 글자를 덮어쓸 위험이 있다. 이 함수는 이미
// 알고 있는 IP명 "텍스트"만 보내서 정렬에만 쓰이는 성향(subGrade)·분위기 클러스터 두
// 값만 채우고 ip/가격/태그는 절대 건드리지 않는다 — 텍스트 잠금 모드와 그대로 호환되고
// 이미지 토큰이 안 들어서 비용도 훨씬 적다. 등급표(S/A)에 이미 있거나 클러스터에 이미
// 편입된 IP는 다시 물어볼 필요가 없으니 대상에서 뺀다.
async function classifyIpsForSort() {
  const btn = document.getElementById('aiClassifyBtn');
  const blankCount = state.items.filter((it) => !it.ip.trim()).length;
  const candidates = [...new Set(
    state.items.map((it) => it.ip.trim()).filter((ip) => ip)
  )].filter((ip) => {
    if (state.dict.gradeTable.S.includes(ip) || state.dict.gradeTable.A.includes(ip)) return false;
    return clusterInfo(ip).ci === Infinity;
  });

  if (!candidates.length) {
    // IP명이 비어있어서 후보가 0개인 건지, 이미 다 등록돼 있어서 0개인 건지를 구분해서
    // 알려준다 — 뭉뚱그려서 "이미 다 등록돼 있다"고만 하면, 실제로는 텍스트 잠금을
    // 켠 시점에 IP명을 아직 안 채워서 전부 빈 칸인 경우를 완전히 잘못 설명하게 된다.
    if (blankCount) {
      alert(`IP명이 비어있는 항목이 ${blankCount}개라서 AI가 분류할 대상이 없습니다.\n` +
        (state.textLocked
          ? '지금 텍스트 잠금 중이라 IP명을 입력할 수 없는 상태입니다 — 2단계에서 잠금을 먼저 해제하고 IP명을 채운 뒤 다시 시도하세요.'
          : '2단계에서 IP명을 먼저 입력한 뒤 다시 시도하세요.'));
    } else {
      alert('AI로 새로 분류할 IP가 없습니다 (전부 이미 등급표/클러스터에 등록돼 있어요).');
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = `AI 분류 중... (${candidates.length}개 IP)`; }
  try {
    const r = await fetch('/api/classify-ip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipNames: candidates, moodClusters: state.dict.moodClusters }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'AI 분류 실패');

    const resultByIp = new Map(data.items.map((it) => [it.ip, it]));
    let clusteredCount = 0;
    let genderClassifiedCount = 0;
    state.items.forEach((item) => {
      const result = resultByIp.get(item.ip.trim());
      if (!result) return;
      if (applyAiClusterResult(item, result.moodCluster)) clusteredCount++;
      const gradeBefore = item.subGrade;
      applyAiGenderLean(item, result.genderLean);
      if (item.subGrade !== gradeBefore) genderClassifiedCount++;
    });
    if (clusteredCount) saveDictLocal('moodClusters', state.dict.moodClusters);
    renderDataTable();
    autoSortItems();
    alert(`AI가 IP ${candidates.length}개의 성향/분위기를 분류하고 자동 정렬까지 적용했습니다.\n` +
      `분위기 클러스터에 새로 편입된 IP: ${clusteredCount}개\n` +
      `등급표에 없어 성향(B급 남/여성향)을 새로 추측한 항목: ${genderClassifiedCount}개\n` +
      `(IP명·가격·태그는 전혀 바뀌지 않았습니다)`);
  } catch (e) {
    alert(`AI 분류 실패: ${e.message}\n(백엔드가 배포되어 있지 않다면 정상입니다)`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🏷️ AI 분류로 정렬 보조'; }
  }
}

// ============================================================
// STEP 4 — 최종 분할 & 내보내기
// ============================================================
function showStep5Guard() {
  document.getElementById('step5Guard').textContent = '먼저 3단계에서 "순서 확정하고 다음 단계 →"를 눌러야 합니다.';
  document.getElementById('step5Guard').style.display = 'block';
  document.getElementById('step5Body').style.display = 'none';
}
function renderStep5() {
  if (!state.orderConfirmed) { showStep5Guard(); return; }
  document.getElementById('step5Guard').style.display = 'none';
  document.getElementById('step5Body').style.display = 'block';
  const headerSelect = document.getElementById('headerSelect');
  headerSelect.innerHTML = state.headers.map((h) => `<option value="${h.id}">${h.label}</option>`).join('');
  document.getElementById('finalSummary').textContent = splitSummaryText(state.items);
  document.getElementById('pagesContainer').innerHTML = '';
  document.getElementById('downloadAllBtn').disabled = true;
  state.finalPages = null;
  updateHeaderPreview();
}

// 헤더 드롭다운에서 실제로 어떤 이미지가 선택된 건지 눈으로 바로 확인할 수 있게 미리보기를
// 보여준다. 원본 이미지에서 "1행 시작 지점보다 위쪽" 영역을 그대로 캡처한 것이라, 원본
// 스크린샷 자체가 상품 그리드 바로 위부터 시작해서 배너가 안 찍혀 있으면 이 미리보기도
// 비어 보인다 — 그 경우 "AI로 채우기"나 최종 렌더 쪽 버그가 아니라 원본 캡처 범위 문제다.
function updateHeaderPreview() {
  const img = document.getElementById('headerPreviewImg');
  if (!img) return;
  const headerId = document.getElementById('headerSelect').value;
  const header = state.headers.find((h) => h.id === headerId);
  img.src = header ? header.canvas.toDataURL('image/png') : '';
}

async function generatePages() {
  const headerId = document.getElementById('headerSelect').value;
  const header = state.headers.find((h) => h.id === headerId);
  const groups = chunk(state.items, 20);
  const cardGroups = groups.map((g) => g.map((item) => ({
    photo: state.photos[item.photoId], ip: item.ip, price: item.price, ship: item.ship, tag: item.tag,
  })));

  // 페이지별 renderPage 호출은 서로 독립적이므로 Promise.all로 병렬 렌더 (순차 대비 체감상 빠름)
  const canvases = await Promise.all(cardGroups.map((cards) => RenderPage.renderPage(
    cards, header ? header.canvas : null,
    { cols: 5, rows: 4, pageW: 1080, pageH: 1350, scale: 2, showShipping: state.showShipping },
  )));

  state.finalPages = canvases.map((canvas, i) => ({ canvas, index: i }));
  const container = document.getElementById('pagesContainer');
  container.innerHTML = '';
  state.finalPages.forEach(({ canvas }, i) => {
    const block = document.createElement('div');
    block.className = 'page-thumb';
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.94);
    block.appendChild(img);
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = `${i + 1}페이지 JPEG 다운로드`;
    btn.addEventListener('click', () => downloadCanvasAsJpeg(canvas, `입고안내_${i + 1}.jpg`));
    block.appendChild(btn);
    container.appendChild(block);
  });
  document.getElementById('downloadAllBtn').disabled = false;
}

function downloadCanvasAsJpeg(canvas, filename) {
  // 대용량 캔버스는 PNG 저장 시 브라우저가 자주 멈추므로 반드시 JPEG quality 0.94로 내보낸다.
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/jpeg', 0.94);
}

async function downloadAllPages() {
  if (!state.finalPages) return;
  for (let i = 0; i < state.finalPages.length; i++) {
    downloadCanvasAsJpeg(state.finalPages[i].canvas, `입고안내_${i + 1}.jpg`);
    await new Promise((r) => setTimeout(r, 350)); // 브라우저 동시 다운로드 차단 방지
  }
}

// ============================================================
// 사전 관리 다이얼로그
// ============================================================
function openDictDialog(focusTab) {
  renderIpDictRows();
  renderGradeInputs();
  renderClusterRows();
  renderStoreRows();
  renderLineNamesInput();
  if (focusTab) switchDictTab(focusTab);
  document.getElementById('dictDialog').showModal();
}
function switchDictTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.dict-editor-tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${tab}`));
}

let ipDictDraft = {};
function renderIpDictRows() {
  ipDictDraft = { ...state.dict.ipNameMap };
  const container = document.getElementById('ipDictRows');
  container.innerHTML = '';
  Object.entries(ipDictDraft).forEach(([k, v]) => addIpDictRow(k, v));
}
function addIpDictRow(k = '', v = '') {
  const container = document.getElementById('ipDictRows');
  const row = document.createElement('div');
  row.className = 'dict-row';
  row.innerHTML = `<input class="k" placeholder="원문" value="${k}" /><input class="v" placeholder="확정 표기" value="${v}" /><button class="btn ghost">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function renderGradeInputs() {
  document.getElementById('gradeSInput').value = state.dict.gradeTable.S.join(', ');
  document.getElementById('gradeAInput').value = state.dict.gradeTable.A.join(', ');
}

function renderClusterRows() {
  const container = document.getElementById('clusterRows');
  container.innerHTML = '';
  state.dict.moodClusters.forEach((c) => addClusterRow(c.name, c.members.join(', ')));
}
function addClusterRow(name = '', members = '') {
  const container = document.getElementById('clusterRows');
  const row = document.createElement('div');
  row.className = 'dict-row';
  row.style.flexDirection = 'column';
  row.innerHTML = `
    <div class="row">
      <input class="cname" placeholder="클러스터 이름" value="${name}" style="flex:1;" />
      <button class="btn ghost">✕</button>
    </div>
    <input class="cmembers" placeholder="IP명 (쉼표 구분, 배치 순서대로)" value="${members}" />
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function renderLineNamesInput() {
  document.getElementById('lineNamesInput').value = (state.dict.productLineNames || []).join(', ');
}

function renderStoreRows() {
  const container = document.getElementById('storeRows');
  container.innerHTML = Object.entries(state.dict.storeProfiles).map(([key, p]) => `
    <div class="dict-row" style="flex-direction:column;align-items:stretch;" data-key="${key}">
      <strong>${p.label} (${key})</strong>
      <label style="font-size:11px;">성향 우선순위
        <select class="gender-priority">
          <option value="male-first" ${p.genderPriority === 'male-first' ? 'selected' : ''}>남성향 우선</option>
          <option value="female-first" ${p.genderPriority === 'female-first' ? 'selected' : ''}>여성향 우선</option>
        </select>
      </label>
      <label style="font-size:11px;">태그 화이트리스트 (쉼표 구분)
        <input class="tag-whitelist" value="${(p.tagWhitelist || []).join(', ')}" />
      </label>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openDictBtn').addEventListener('click', () => openDictDialog());
  document.querySelectorAll('[data-open-dict]').forEach((btn) => {
    btn.addEventListener('click', () => openDictDialog(btn.dataset.openDict === 'ip' ? 'ip' : 'grade'));
  });
  document.getElementById('closeDictDialog').addEventListener('click', () => document.getElementById('dictDialog').close());
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchDictTab(b.dataset.tab)));
  document.getElementById('addIpRowBtn').addEventListener('click', () => addIpDictRow());
  document.getElementById('addClusterBtn').addEventListener('click', () => addClusterRow());

  // 각 탭의 입력 폼을 현재 값(section value)으로 읽어오는 헬퍼 — 로컬저장/GitHub공유 둘 다 이걸 재사용한다.
  function readIpDictValue() {
    const value = {};
    document.querySelectorAll('#ipDictRows .dict-row').forEach((row) => {
      const k = row.querySelector('.k').value.trim();
      const v = row.querySelector('.v').value.trim();
      if (k && v) value[k] = v;
    });
    return value;
  }
  function readGradeValue() {
    const S = document.getElementById('gradeSInput').value.split(',').map((s) => s.trim()).filter(Boolean);
    const A = document.getElementById('gradeAInput').value.split(',').map((s) => s.trim()).filter(Boolean);
    return { S, A };
  }
  function readClusterValue() {
    const value = [];
    document.querySelectorAll('#clusterRows .dict-row').forEach((row) => {
      const name = row.querySelector('.cname').value.trim();
      const members = row.querySelector('.cmembers').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (name) value.push({ name, members });
    });
    return value;
  }
  function readStoreValue() {
    const value = { ...state.dict.storeProfiles };
    document.querySelectorAll('#storeRows .dict-row').forEach((row) => {
      const key = row.dataset.key;
      value[key] = {
        ...value[key],
        genderPriority: row.querySelector('.gender-priority').value,
        tagWhitelist: row.querySelector('.tag-whitelist').value.split(',').map((s) => s.trim()).filter(Boolean),
      };
    });
    return value;
  }
  function readLineNamesValue() {
    return document.getElementById('lineNamesInput').value.split(',').map((s) => s.trim()).filter(Boolean);
  }

  document.getElementById('saveIpDictBtn').addEventListener('click', () => {
    saveDictLocal('ipNameMap', readIpDictValue());
    renderDataTable();
  });
  document.getElementById('shareIpDictBtn').addEventListener('click', () => {
    const value = readIpDictValue();
    saveDictLocal('ipNameMap', value);
    shareDictToGithub('ipNameMap', value, `IP명 사전 (${Object.keys(value).length}건)`);
  });

  document.getElementById('saveGradeBtn').addEventListener('click', () => {
    saveDictLocal('gradeTable', readGradeValue());
  });
  document.getElementById('shareGradeBtn').addEventListener('click', () => {
    const value = readGradeValue();
    saveDictLocal('gradeTable', value);
    shareDictToGithub('gradeTable', value, `등급표 (S ${value.S.length}건 / A ${value.A.length}건)`);
  });

  document.getElementById('saveClusterBtn').addEventListener('click', () => {
    saveDictLocal('moodClusters', readClusterValue());
  });
  document.getElementById('shareClusterBtn').addEventListener('click', () => {
    const value = readClusterValue();
    saveDictLocal('moodClusters', value);
    shareDictToGithub('moodClusters', value, `분위기 클러스터 (${value.length}개)`);
  });

  document.getElementById('saveStoreBtn').addEventListener('click', () => {
    saveDictLocal('storeProfiles', readStoreValue());
    populateStoreSelects();
  });
  document.getElementById('shareStoreBtn').addEventListener('click', () => {
    const value = readStoreValue();
    saveDictLocal('storeProfiles', value);
    populateStoreSelects();
    shareDictToGithub('storeProfiles', value, '스토어 프로필');
  });

  document.getElementById('saveLineNamesBtn').addEventListener('click', () => {
    saveDictLocal('productLineNames', readLineNamesValue());
  });
  document.getElementById('shareLineNamesBtn').addEventListener('click', () => {
    const value = readLineNamesValue();
    saveDictLocal('productLineNames', value);
    shareDictToGithub('productLineNames', value, `상품 라인명 (${value.length}건)`);
  });
});

// ============================================================
// 초기화 / 이벤트 바인딩
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDict();
  populateStoreSelects();
  renderStepIndicator();
  renderSlots();

  document.getElementById('fileInput').addEventListener('change', (e) => handleFilesSelected(e.target.files));
  // 파일 선택창을 거치지 않고 클립보드에서 스크린샷을 바로 Ctrl+V로 붙여넣을 수 있게 지원 —
  // 캡처 도구로 찍은 이미지를 저장 없이 바로 붙여넣는 흐름이 훨씬 빠르다.
  document.addEventListener('paste', (e) => {
    if (state.step !== 1 || state.sources.length >= 3) return;
    const imageItem = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) handleFilesSelected([file]);
  });
  document.getElementById('sourceList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const src = state.sources.find((s) => s.id === btn.dataset.id);
    if (btn.dataset.action === 'redetect') {
      // 이미 크롭 확정된 소스는 재확정(다시 크롭)까지 가능하게 열어준다 — 예전엔 확정 후
      // "다시 검출"을 눌러도 확인 버튼이 계속 비활성 상태라 재검출 결과를 반영할 방법이
      // 없었다(재검출해도 아무것도 안 바뀌는 것처럼 보이는 버그). 대신 재확정하면 이
      // 소스에서 이미 만든 항목이 전부 교체되므로, 2단계 이후에서 직접 고친 내용이
      // 있으면 사라진다는 걸 미리 경고한다.
      if (src.confirmed) {
        const ok = window.confirm(
          '이미 크롭이 확정된 소스입니다. 다시 검출하면 이 소스에서 만든 항목이 전부 삭제되고 새로 만들어집니다.\n' +
          '2단계 이후에서 IP명/가격/태그 등을 직접 고친 내용이 있다면 함께 사라집니다. 계속할까요?'
        );
        if (!ok) return;
        src.confirmed = false;
      }
      // "다시 검출"이 같은 이미지에 똑같은 결정론적 알고리즘을 그대로 다시 돌리기만 해서,
      // 몇 번을 눌러도 항상 똑같은 결과만 나와 "이 버튼이 대체 무슨 의미냐"는 지적을 받았다.
      // 이제 누를 때마다 다른 판정 기준(흰색 임계값, 사진 한 칸으로 인정하는 길이 범위)을
      // 순환하며 시도해서, 기본값이 안 맞는 이미지에서도 실제로 다른 결과를 시도해볼 수 있다.
      src.gridVariant = ((src.gridVariant ?? 0) + 1) % GridDetect.DETECT_VARIANTS.length;
      src.headerHeightOverride = null; // 그리드를 새로 잡으면 헤더 높이도 새 rows[0] 기준으로 다시 제안
      src.grid = GridDetect.detectGrid(src.img, src.gridVariant);
      renderSourceList();
      // 재검출 결과가 이전과 똑같을 수도 있어서(같은 이미지 → 같은 알고리즘 → 같은 결과),
      // 화면이 안 바뀌면 버튼이 먹통인 것처럼 보인다는 피드백이 있었다 — 결과가 바뀌든
      // 안 바뀌든 "방금 다시 검출을 실행했다"는 걸 눈에 띄게(테두리 강조 + 버튼 문구 변경) 확인시켜준다.
      const flashBlock = document.querySelector(`.source-block[data-src-id="${src.id}"]`);
      if (flashBlock) {
        flashBlock.classList.add('just-redetected');
        setTimeout(() => flashBlock.classList.remove('just-redetected'), 1400);
        const redetectBtn = flashBlock.querySelector('button[data-action="redetect"]');
        if (redetectBtn) {
          const original = redetectBtn.textContent;
          redetectBtn.textContent = `✓ 다른 방식으로 재시도 (${src.gridVariant + 1}/${GridDetect.DETECT_VARIANTS.length})`;
          setTimeout(() => { redetectBtn.textContent = original; }, 1800);
        }
      }
    }
    if (btn.dataset.action === 'confirm') confirmSourceCrop(src.id);
    if (btn.dataset.action === 'ai-fill') aiFillSource(src.id);
    if (btn.dataset.action === 'ocr-label') ocrLabelsForSource(src.id);
    if (btn.dataset.action === 'delete-source') removeSource(src.id);
  });

  document.getElementById('toStep2Btn').addEventListener('click', () => goToStep(2));
  document.getElementById('backTo1Btn').addEventListener('click', () => goToStep(1));
  document.getElementById('toStep3Btn').addEventListener('click', () => goToStep(3));
  document.getElementById('backTo2Btn').addEventListener('click', () => goToStep(2));
  document.getElementById('backTo4Btn').addEventListener('click', () => goToStep(3));

  document.getElementById('selectDeleteBtn').addEventListener('click', deleteSelectedItems);
  document.getElementById('undoDeleteBtn').addEventListener('click', undoDelete);

  document.getElementById('storeSelectStep2').addEventListener('change', (e) => { state.activeStore = e.target.value; renderDataTable(); });
  document.getElementById('storeSelectStep5').addEventListener('change', (e) => { state.activeStore = e.target.value; });
  document.getElementById('autoSortBtn').addEventListener('click', autoSortItems);
  document.getElementById('aiClassifyBtn').addEventListener('click', classifyIpsForSort);
  document.getElementById('textLockToggle').addEventListener('change', (e) => {
    state.textLocked = e.target.checked;
    step2SelectedIds = new Set(); // 잠금 전환 시 일괄편집 선택 상태가 남아있으면 헷갈리니 초기화
    renderDataTable();
    updateTextLockBanner();
    if (state.step === 3) renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
  });
  document.getElementById('shipToggle').addEventListener('change', (e) => {
    state.showShipping = e.target.checked;
    renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
  });
  document.getElementById('confirmOrderBtn').addEventListener('click', () => { state.orderConfirmed = true; goToStep(4); });

  document.getElementById('generatePagesBtn').addEventListener('click', generatePages);
  document.getElementById('downloadAllBtn').addEventListener('click', downloadAllPages);
  document.getElementById('headerSelect').addEventListener('change', updateHeaderPreview);

  goToStep(1);
});
