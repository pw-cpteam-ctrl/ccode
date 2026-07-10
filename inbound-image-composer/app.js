// ============================================================
// 입고안내 이미지 자동 제작 툴 — 메인 앱 로직
// 6단계 플로우(업로드/그리드검출 → 표정리 → 전체미리보기 → 삭제확인 → 순서정렬 →
// 최종크롭/내보내기)를 화면 전환으로 명확히 분리한다. 절대 중간 단계를 건너뛰고
// 최종 렌더로 가지 않는다 (PLAN 문서의 "실패 사례" 참고).
// ============================================================

const STEP_LABELS = ['업로드/검출', '표 정리', '전체 미리보기', '삭제 확인', '순서 정렬', '최종 내보내기'];

const state = {
  step: 1,
  sources: [],       // { id, img, grid:{cols,rows,cardW,cardH}, confirmed }
  headers: [],        // { id, label, canvas }
  photos: {},          // photoId -> canvas
  items: [],            // { id, photoId, ip, tag, price, ship, subGrade, pushToEnd }
  nextPhotoNum: 1,
  nextItemId: 1,
  dict: { ipNameMap: {}, gradeTable: { S: [], A: [] }, moodClusters: [], storeProfiles: {} },
  activeStore: 'goodsmile',
  pendingDeleteIds: [],
  orderConfirmed: false,
  finalPages: null, // array of { items, canvas }
};

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
    gradeTable: local.gradeTable || (server.gradeTable && server.gradeTable.S && server.gradeTable.S.length ? server.gradeTable : seed.gradeTable),
    moodClusters: local.moodClusters || (server.moodClusters && server.moodClusters.length ? server.moodClusters : seed.moodClusters),
    storeProfiles: local.storeProfiles || (Object.keys(server.storeProfiles || {}).length ? server.storeProfiles : seed.storeProfiles),
  };
  if (!state.dict.storeProfiles[state.activeStore]) {
    state.activeStore = Object.keys(state.dict.storeProfiles)[0];
  }
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
  if (n === 6 && !state.orderConfirmed) { showStep6Guard(); }
  state.step = n;
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  renderStepIndicator();
  if (n === 2) renderDataTable();
  if (n === 3) renderPreviewGrid('previewGrid', state.items, { draggable: true, selectable: true });
  if (n === 5) renderPreviewGrid('sortPreviewGrid', state.items, { draggable: true, selectable: false });
  if (n === 6) renderStep6();
}

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
    const grid = GridDetect.detectGrid(img);
    state.sources.push({ id: uid('src'), img, grid, confirmed: false });
  });
  renderSourceList();
}

function renderSourceList() {
  const container = document.getElementById('sourceList');
  container.innerHTML = '';
  state.sources.forEach((src) => {
    const block = document.createElement('div');
    block.className = 'source-block';
    const cellCount = src.grid.rows.length * src.grid.cols.length;
    block.innerHTML = `
      <div class="row between">
        <strong>${src.img.width}×${src.img.height}px — 검출된 셀 ${cellCount}개 (행 ${src.grid.rows.length} × 열 ${src.grid.cols.length})</strong>
        <div class="row">
          <button class="btn" data-action="redetect" data-id="${src.id}">다시 검출</button>
          <button class="btn primary" data-action="confirm" data-id="${src.id}" ${src.confirmed ? 'disabled' : ''}>${src.confirmed ? '크롭 완료됨' : '확인 및 크롭'}</button>
          <button class="btn" data-action="ai-fill" data-id="${src.id}" ${src.confirmed ? '' : 'disabled'} title="claude-haiku-4-5로 사진 속 텍스트를 읽어 표를 채웁니다 (유료 API 호출, 장당 약 1센트 수준). 결과는 항상 확인 대상으로만 표시됩니다.">🤖 AI로 채우기</button>
        </div>
      </div>
      <canvas class="overlay" data-canvas="${src.id}"></canvas>
      <div class="source-status ${src.confirmed ? 'confirmed' : ''}">${src.confirmed ? '✓ 개별 사진 크롭 완료 — photoId 부여됨' : '⚠ 검출 결과를 눈으로 확인한 뒤 크롭을 확정하세요 (행 간격은 불규칙할 수 있습니다)'}</div>
    `;
    container.appendChild(block);
    drawDebugOverlay(src);
  });
  document.getElementById('toStep2Btn').disabled = Object.keys(state.photos).length === 0;
}

function drawDebugOverlay(src) {
  const canvas = document.querySelector(`canvas[data-canvas="${src.id}"]`);
  canvas.width = src.img.width;
  canvas.height = src.img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src.img, 0, 0);
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  const { cols, rows, cardW, cardH } = src.grid;
  rows.forEach((y) => cols.forEach((x) => ctx.strokeRect(x, y, cardW, cardH)));
  // 헤더 영역(첫 행 위쪽) 표시
  if (rows.length) {
    ctx.strokeStyle = '#2f7bff';
    ctx.strokeRect(0, 0, src.img.width, rows[0]);
  }
}

function confirmSourceCrop(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src || src.confirmed) return;
  const { cols, rows, cardW, cardH } = src.grid;

  if (rows.length) {
    const headerCanvas = GridDetect.cropCell(src.img, 0, 0, src.img.width, rows[0]);
    state.headers.push({ id: uid('hdr'), label: `소스 ${state.headers.length + 1} 헤더`, canvas: headerCanvas });
  }

  src.itemStartIndex = state.items.length; // AI 채우기 결과를 이 소스가 만든 항목에만 매핑하기 위한 범위
  rows.forEach((y) => {
    cols.forEach((x) => {
      const photoId = `p${state.nextPhotoNum++}`;
      state.photos[photoId] = GridDetect.cropCell(src.img, x, y, cardW, cardH);
      state.items.push({
        id: uid('item'), photoId, ip: '', tag: '', price: '', ship: '무료배송',
        subGrade: 'other', pushToEnd: false, aiUncertain: false,
      });
    });
  });
  src.itemCount = state.items.length - src.itemStartIndex;

  src.confirmed = true;
  renderSourceList();
}

// ---------- AI로 자동 채우기 (선택, 유료 — claude-haiku-4-5 vision) ----------
// 대화형 AI로 하던 것과 같은 경험: 이미지를 통째로 보내서 IP명/가격/태그/배송비를 채운다.
// business-rules.md 원칙대로, 결과는 절대 그대로 확정되지 않고 항상 "확인 필요" 상태로만
// 표에 반영된다(uncertain 플래그 → ⚠ 배지). 백엔드가 없으면 친절한 안내만 뜨고 끝난다.
const AI_BATCH_SIZE = 6; // 한 번에 너무 많은 항목을 보내면 항목당 해상도/주의력이 부족해져 인식률이 급격히 떨어짐
const AI_TEXT_STRIP_SCALE = 2; // 원본 텍스트가 워낙 작아서(칸 폭 176px) 2배로 키워서 보냄

// 각 행의 "텍스트 영역"(사진 아래 ~ 다음 행 사진 시작 전) 높이를 계산.
// grid-detect가 잡아주는 건 사진 높이(cardH)뿐이라, 그 아래 상품명/가격 텍스트 줄은 직접 계산해야 한다.
function computeRowTextBottoms(src) {
  const { rows, cardH } = src.grid;
  return rows.map((y, i) => (i + 1 < rows.length ? rows[i + 1] : Math.min(src.img.height, y + cardH + 130)));
}

// itemIndexInSource(그 소스 안에서 0부터 시작하는 인덱스)에 해당하는 칸의 "텍스트만" 크롭.
// 사진은 빼고 이 부분만 보내야 AI가 쓸 수 있는 해상도를 전부 글자에 쓸 수 있다.
function cropItemTextRegion(src, itemIndexInSource) {
  const { cols, rows, cardW, cardH } = src.grid;
  const rowTextBottoms = computeRowTextBottoms(src);
  const ri = Math.floor(itemIndexInSource / cols.length);
  const ci = itemIndexInSource % cols.length;
  const x = cols[ci];
  const yTop = rows[ri] + cardH;
  const height = Math.max(20, Math.min(160, rowTextBottoms[ri] - yTop));
  return GridDetect.cropCell(src.img, x, yTop, cardW, height);
}

// batch에 속한 항목들의 텍스트 크롭을 세로로 이어붙인 "글자만 큼직하게" 이미지를 만든다.
// 사진 없이 텍스트만, 2배 확대, 항목 사이 구분선 — AI가 25개를 한꺼번에 보는 대신 6개만 집중해서 보게 함.
function buildTextStripImage(src, itemIndices) {
  const crops = itemIndices.map((idx) => cropItemTextRegion(src, idx));
  const scale = AI_TEXT_STRIP_SCALE;
  const gap = 6;
  const width = Math.max(...crops.map((c) => c.width)) * scale;
  const height = crops.reduce((sum, c) => sum + c.height * scale + gap, gap);

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false; // 확대해도 흐려지지 않게 (원래도 저해상도 텍스트라 흐림 처리는 오히려 해로움)

  let y = gap;
  crops.forEach((crop, i) => {
    const h = crop.height * scale;
    ctx.drawImage(crop, 0, y, crop.width * scale, h);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, y, crop.width * scale, h);
    ctx.fillStyle = '#ff3b30';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`#${i + 1}`, 4, y - 2 < 14 ? y + 14 : y - 2);
    y += h + gap;
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

async function aiFillSource(srcId) {
  const src = state.sources.find((s) => s.id === srcId);
  if (!src || !src.confirmed) return;

  const btn = document.querySelector(`button[data-action="ai-fill"][data-id="${srcId}"]`);
  const itemIndices = Array.from({ length: src.itemCount }, (_, i) => i);
  const batches = chunkArray(itemIndices, AI_BATCH_SIZE);
  let uncertainCount = 0;
  let filledCount = 0;
  let clusteredCount = 0;

  try {
    for (let b = 0; b < batches.length; b++) {
      if (btn) { btn.disabled = true; btn.textContent = `인식 중... (${b + 1}/${batches.length})`; }
      const batch = batches[b];
      const stripCanvas = buildTextStripImage(src, batch);
      const dataUrl = stripCanvas.toDataURL('image/png');
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

      const r = await fetch('/api/parse-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64, mediaType: 'image/png', expectedCount: batch.length, layout: 'textStrip',
          ipDictHint: state.dict.ipNameMap, tagWhitelist: tagWhitelistForActiveStore(),
          moodClusters: state.dict.moodClusters,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'AI 인식 실패');

      data.items.slice(0, batch.length).forEach((result, j) => {
        const item = state.items[src.itemStartIndex + batch[j]];
        if (!item) return;
        // 모델이 그래도 ip를 비워서 주면 rawText로 대체 — 빈 칸보다는 "확인해서 고칠 글자"가 있는 게 낫다.
        item.ip = result.ip || result.rawText || '';
        item.price = result.price || '';
        item.ship = result.ship || '무료배송';
        item.tag = result.tag || '';
        item.aiUncertain = !!result.uncertain || !item.ip;
        if (item.aiUncertain) uncertainCount++;
        if (applyAiClusterResult(item, result.moodCluster)) clusteredCount++;
        filledCount++;
      });
      renderDataTable();
    }
    if (clusteredCount) saveDictLocal('moodClusters', state.dict.moodClusters);
    alert(`AI가 ${filledCount}개 항목을 채웠습니다.\n확인이 필요한 항목: ${uncertainCount}개 (⚠ 표시된 곳을 확인하세요)\n분위기 클러스터에 새로 편입된 IP: ${clusteredCount}개`);
  } catch (e) {
    alert(`AI로 채우기 실패: ${e.message}\n(백엔드가 배포되어 있지 않다면 정상입니다 — 수동으로 입력해주세요)`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI로 채우기'; }
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
function renderDataTable() {
  const grid = document.getElementById('dataTableBody');
  grid.innerHTML = '';
  state.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'step2-card';
    card.dataset.id = item.id;
    const tagOptions = ['<option value="">(없음)</option>']
      .concat(tagWhitelistForActiveStore().map((t) => `<option value="${t}" ${item.tag === t ? 'selected' : ''}>${t}</option>`))
      .join('');
    card.innerHTML = `
      <div class="thumb"></div>
      <div class="fields">
        <div class="fields-row">
          <input class="ip-input" value="${item.ip}" placeholder="IP명" />
          <select class="tag-select">${tagOptions}</select>
        </div>
        <div class="suggest-slot">${item.aiUncertain ? '<span class="warn-badge">⚠ AI 추정 - 확인 필요</span> ' : ''}${ipDictSuggestionHtml(item.ip)}</div>
        <div class="fields-row">
          <input class="price-input" value="${item.price}" placeholder="가격 (예: 44,400원)" />
          <select class="subgrade-select">
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
}

function scaledThumb(canvas) {
  const img = document.createElement('img');
  img.className = 'pthumb';
  img.src = canvas ? canvas.toDataURL('image/png') : '';
  return img;
}

// ============================================================
// STEP 3 / 5 — 전체 미리보기 (공용 렌더)
// ============================================================
let dragFromIndex = null;

// 5열 x 2줄 = 10개 단위로 박스를 나눠서 "1p, 2p..." 구분선을 넣는다 — 카드가 계속
// 한 줄로 쭉 이어지면 몇 번째 묶음인지 눈으로 가늠하기 어려워서 실사용 중 요청받은 구성.
const PREVIEW_PAGE_GROUP_SIZE = 10;

function renderPreviewGrid(containerId, items, opts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const pages = chunk(items, PREVIEW_PAGE_GROUP_SIZE);

  pages.forEach((pageItems, pageIdx) => {
    const pageBox = document.createElement('div');
    pageBox.className = 'preview-page-box';
    pageBox.innerHTML = `<div class="preview-page-label">${pageIdx + 1}p</div>`;
    const grid = document.createElement('div');
    grid.className = 'preview-grid';
    pageBox.appendChild(grid);
    container.appendChild(pageBox);

    pageItems.forEach((item, localIdx) => {
      const idx = pageIdx * PREVIEW_PAGE_GROUP_SIZE + localIdx; // state.items 기준 전체 인덱스 유지
      const card = document.createElement('div');
      card.className = 'pcard';
      card.draggable = !!opts.draggable;
      card.dataset.index = idx;

      const checkboxHtml = opts.selectable
        ? `<input type="checkbox" class="del-check" data-id="${item.id}" ${state.pendingDeleteIds.includes(item.id) ? 'checked' : ''} />`
        : '';

      card.innerHTML = `
        ${checkboxHtml}
        <button class="edit-btn" data-edit="${item.id}">✎</button>
        <div class="thumb-slot"></div>
        <div class="ip">${item.aiUncertain ? '⚠ ' : ''}${item.ip || '<span style=\"color:#c0c4cc\">IP명 없음</span>'}${item.tag ? `<span class="tag">${item.tag}</span>` : ''}</div>
        <div class="price">${item.price || ''}</div>
        <div class="ship">${item.ship || ''}</div>
      `;
      card.querySelector('.thumb-slot').appendChild(scaledThumb(state.photos[item.photoId]));
      grid.appendChild(card);

      card.querySelector('[data-edit]').addEventListener('click', () => openItemDialog(item.id));

      if (opts.selectable) {
        card.querySelector('.del-check').addEventListener('change', (e) => {
          if (e.target.checked) state.pendingDeleteIds.push(item.id);
          else state.pendingDeleteIds = state.pendingDeleteIds.filter((id) => id !== item.id);
          updateSelectedCount();
        });
      }

      if (opts.draggable) {
        card.addEventListener('dragstart', () => { dragFromIndex = idx; });
        card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('dragover'); });
        card.addEventListener('dragleave', () => card.classList.remove('dragover'));
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          card.classList.remove('dragover');
          if (dragFromIndex === null || dragFromIndex === idx) return;
          const [moved] = state.items.splice(dragFromIndex, 1);
          state.items.splice(idx, 0, moved);
          dragFromIndex = null;
          renderPreviewGrid(containerId, state.items, opts);
          updateSplitPreviewText();
        });
      }
    });
  });

  if (containerId === 'previewGrid') updateSplitPreviewText();
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
    renderPreviewGrid('sortPreviewGrid', state.items, { draggable: true, selectable: false });
    renderDataTable();
  });
});

// ============================================================
// STEP 4 — 삭제 확인 (체크박스 선택 → 명시적 확인 → 반영, 2단계)
// ============================================================
function goToDeleteConfirm() {
  if (!state.pendingDeleteIds.length) { alert('삭제할 항목을 먼저 선택하세요.'); return; }
  const list = document.getElementById('deleteList');
  list.innerHTML = state.pendingDeleteIds.map((id) => {
    const idx = state.items.findIndex((i) => i.id === id);
    const item = state.items[idx];
    return `<li>❌ #${idx + 1} ${item.ip || '(IP명 없음)'} ${item.price || ''}</li>`;
  }).join('');
  const remaining = state.items.filter((i) => !state.pendingDeleteIds.includes(i.id));
  document.getElementById('deleteSummary').textContent = splitSummaryText(remaining);
  goToStep(4);
}

function confirmDelete() {
  state.items = state.items.filter((i) => !state.pendingDeleteIds.includes(i.id));
  state.pendingDeleteIds = [];
  state.orderConfirmed = false;
  goToStep(3);
}
function cancelDelete() {
  state.pendingDeleteIds = [];
  goToStep(3);
}

// ============================================================
// STEP 5 — 자동 정렬
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
  renderPreviewGrid('sortPreviewGrid', state.items, { draggable: true, selectable: false });
}

// ============================================================
// STEP 6 — 최종 분할 & 내보내기
// ============================================================
function showStep6Guard() {
  document.getElementById('step6Guard').textContent = '먼저 5단계에서 "순서 확정하고 다음 단계 →"를 눌러야 합니다.';
  document.getElementById('step6Guard').style.display = 'block';
  document.getElementById('step6Body').style.display = 'none';
}
function renderStep6() {
  if (!state.orderConfirmed) { showStep6Guard(); return; }
  document.getElementById('step6Guard').style.display = 'none';
  document.getElementById('step6Body').style.display = 'block';
  const headerSelect = document.getElementById('headerSelect');
  headerSelect.innerHTML = state.headers.map((h) => `<option value="${h.id}">${h.label}</option>`).join('');
  document.getElementById('finalSummary').textContent = splitSummaryText(state.items);
  document.getElementById('pagesContainer').innerHTML = '';
  document.getElementById('downloadAllBtn').disabled = true;
  state.finalPages = null;
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
    cards, header ? header.canvas : null, { cols: 5, rows: 4, pageW: 1080, pageH: 1350, scale: 2 },
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
});

// ============================================================
// 초기화 / 이벤트 바인딩
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDict();
  populateStoreSelects();
  renderStepIndicator();

  document.getElementById('fileInput').addEventListener('change', (e) => handleFilesSelected(e.target.files));
  document.getElementById('sourceList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const src = state.sources.find((s) => s.id === btn.dataset.id);
    if (btn.dataset.action === 'redetect') { src.grid = GridDetect.detectGrid(src.img); renderSourceList(); }
    if (btn.dataset.action === 'confirm') confirmSourceCrop(src.id);
    if (btn.dataset.action === 'ai-fill') aiFillSource(src.id);
  });

  document.getElementById('toStep2Btn').addEventListener('click', () => goToStep(2));
  document.getElementById('backTo1Btn').addEventListener('click', () => goToStep(1));
  document.getElementById('toStep3Btn').addEventListener('click', () => goToStep(3));
  document.getElementById('backTo2Btn').addEventListener('click', () => goToStep(2));
  document.getElementById('toStep5Btn').addEventListener('click', () => goToStep(5));
  document.getElementById('backTo3Btn').addEventListener('click', () => goToStep(3));
  document.getElementById('backTo5Btn').addEventListener('click', () => goToStep(5));

  document.getElementById('selectDeleteBtn').addEventListener('click', goToDeleteConfirm);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
  document.getElementById('cancelDeleteBtn').addEventListener('click', cancelDelete);

  document.getElementById('storeSelectStep2').addEventListener('change', (e) => { state.activeStore = e.target.value; renderDataTable(); });
  document.getElementById('storeSelectStep5').addEventListener('change', (e) => { state.activeStore = e.target.value; });
  document.getElementById('autoSortBtn').addEventListener('click', autoSortItems);
  document.getElementById('confirmOrderBtn').addEventListener('click', () => { state.orderConfirmed = true; goToStep(6); });

  document.getElementById('generatePagesBtn').addEventListener('click', generatePages);
  document.getElementById('downloadAllBtn').addEventListener('click', downloadAllPages);

  goToStep(1);
});
