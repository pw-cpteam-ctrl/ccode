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
async function loadDict() {
  const seed = {
    ipNameMap: { ...window.SEED_IP_NAME_MAP },
    gradeTable: { S: [...window.SEED_GRADE_TABLE.S], A: [...window.SEED_GRADE_TABLE.A] },
    moodClusters: window.SEED_MOOD_CLUSTERS.map((c) => ({ ...c, members: [...c.members] })),
    storeProfiles: JSON.parse(JSON.stringify(window.SEED_STORE_PROFILES)),
  };
  try {
    const r = await fetch('/api/load-dict');
    const server = await r.json();
    state.dict = {
      ipNameMap: { ...seed.ipNameMap, ...(server.ipNameMap || {}) },
      gradeTable: {
        S: (server.gradeTable && server.gradeTable.S && server.gradeTable.S.length) ? server.gradeTable.S : seed.gradeTable.S,
        A: (server.gradeTable && server.gradeTable.A && server.gradeTable.A.length) ? server.gradeTable.A : seed.gradeTable.A,
      },
      moodClusters: (server.moodClusters && server.moodClusters.length) ? server.moodClusters : seed.moodClusters,
      storeProfiles: Object.keys(server.storeProfiles || {}).length ? server.storeProfiles : seed.storeProfiles,
    };
  } catch (e) {
    state.dict = seed; // 서버를 못 읽어도 시드값으로 정상 동작
  }
  if (!state.dict.storeProfiles[state.activeStore]) {
    state.activeStore = Object.keys(state.dict.storeProfiles)[0];
  }
}

async function saveDictSection(section, value, label) {
  const ok = window.confirm(`"${label}" 내용을 GitHub에 저장하시겠습니까?\n팀 전체가 공유하는 데이터이므로 신중하게 확인하세요.`);
  if (!ok) return false;
  try {
    const r = await fetch('/api/save-dict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '저장 실패');
    state.dict[section] = value;
    alert('저장되었습니다.');
    return true;
  } catch (e) {
    alert(`저장 실패: ${e.message}`);
    return false;
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

  rows.forEach((y) => {
    cols.forEach((x) => {
      const photoId = `p${state.nextPhotoNum++}`;
      state.photos[photoId] = GridDetect.cropCell(src.img, x, y, cardW, cardH);
      state.items.push({
        id: uid('item'), photoId, ip: '', tag: '', price: '', ship: '무료배송',
        subGrade: 'other', pushToEnd: false,
      });
    });
  });

  src.confirmed = true;
  renderSourceList();
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

function renderDataTable() {
  const tbody = document.getElementById('dataTableBody');
  tbody.innerHTML = '';
  state.items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.dataset.id = item.id;
    const tagOptions = ['<option value="">(없음)</option>']
      .concat(tagWhitelistForActiveStore().map((t) => `<option value="${t}" ${item.tag === t ? 'selected' : ''}>${t}</option>`))
      .join('');
    tr.innerHTML = `
      <td class="thumb"></td>
      <td><input class="ip-input" value="${item.ip}" /> <div class="suggest-slot">${ipDictSuggestionHtml(item.ip)}</div></td>
      <td><select class="tag-select">${tagOptions}</select></td>
      <td><input class="price-input" value="${item.price}" placeholder="44,400원" /></td>
      <td><input class="ship-input" value="${item.ship}" placeholder="무료배송 / 3,000원" /></td>
      <td>
        <select class="subgrade-select">
          <option value="other" ${item.subGrade === 'other' ? 'selected' : ''}>기타</option>
          <option value="B_male" ${item.subGrade === 'B_male' ? 'selected' : ''}>B급 남성향</option>
          <option value="B_female" ${item.subGrade === 'B_female' ? 'selected' : ''}>B급 여성향</option>
          <option value="C_male" ${item.subGrade === 'C_male' ? 'selected' : ''}>C급 남성향</option>
          <option value="C_female" ${item.subGrade === 'C_female' ? 'selected' : ''}>C급 여성향</option>
        </select>
      </td>
    `;
    tr.querySelector('.thumb').appendChild(scaledThumb(state.photos[item.photoId]));
    tbody.appendChild(tr);

    tr.querySelector('.ip-input').addEventListener('change', (e) => { item.ip = e.target.value.trim(); renderDataTable(); });
    tr.querySelector('.tag-select').addEventListener('change', (e) => { item.tag = e.target.value; });
    tr.querySelector('.price-input').addEventListener('change', (e) => { item.price = e.target.value.trim(); });
    tr.querySelector('.ship-input').addEventListener('change', (e) => { item.ship = e.target.value.trim(); });
    tr.querySelector('.subgrade-select').addEventListener('change', (e) => { item.subGrade = e.target.value; });
    const suggestBtn = tr.querySelector('[data-apply-suggest]');
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

function renderPreviewGrid(containerId, items, opts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((item, idx) => {
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
      <div class="ip">${item.ip || '<span style=\"color:#c0c4cc\">IP명 없음</span>'}${item.tag ? `<span class="tag">${item.tag}</span>` : ''}</div>
      <div class="price">${item.price || ''}</div>
      <div class="ship">${item.ship || ''}</div>
    `;
    card.querySelector('.thumb-slot').appendChild(scaledThumb(state.photos[item.photoId]));
    container.appendChild(card);

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

  document.getElementById('saveIpDictBtn').addEventListener('click', async () => {
    const value = {};
    document.querySelectorAll('#ipDictRows .dict-row').forEach((row) => {
      const k = row.querySelector('.k').value.trim();
      const v = row.querySelector('.v').value.trim();
      if (k && v) value[k] = v;
    });
    await saveDictSection('ipNameMap', value, `IP명 사전 (${Object.keys(value).length}건)`);
    renderDataTable();
  });

  document.getElementById('saveGradeBtn').addEventListener('click', async () => {
    const S = document.getElementById('gradeSInput').value.split(',').map((s) => s.trim()).filter(Boolean);
    const A = document.getElementById('gradeAInput').value.split(',').map((s) => s.trim()).filter(Boolean);
    await saveDictSection('gradeTable', { S, A }, `등급표 (S ${S.length}건 / A ${A.length}건)`);
  });

  document.getElementById('saveClusterBtn').addEventListener('click', async () => {
    const value = [];
    document.querySelectorAll('#clusterRows .dict-row').forEach((row) => {
      const name = row.querySelector('.cname').value.trim();
      const members = row.querySelector('.cmembers').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (name) value.push({ name, members });
    });
    await saveDictSection('moodClusters', value, `분위기 클러스터 (${value.length}개)`);
  });

  document.getElementById('saveStoreBtn').addEventListener('click', async () => {
    const value = { ...state.dict.storeProfiles };
    document.querySelectorAll('#storeRows .dict-row').forEach((row) => {
      const key = row.dataset.key;
      value[key] = {
        ...value[key],
        genderPriority: row.querySelector('.gender-priority').value,
        tagWhitelist: row.querySelector('.tag-whitelist').value.split(',').map((s) => s.trim()).filter(Boolean),
      };
    });
    await saveDictSection('storeProfiles', value, '스토어 프로필');
    populateStoreSelects();
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
