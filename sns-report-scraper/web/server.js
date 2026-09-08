/**
 * 팀원이 터미널 명령어를 몰라도 이 SNS 리포트 도구를 쓸 수 있게 만든 로컬 웹 대시보드.
 *
 * ⚠️ 중요: 이건 "웹 서비스"가 아니라 이 컴퓨터 안에서만 도는 화면임(다른 컴퓨터에서
 * 접속 못 함, localhost). 실제 수집/로그인 세션은 지금까지와 완전히 똑같이 이 컴퓨터
 * 안에서만 처리되고, 어디로도 전송되지 않음 — 그냥 "터미널에 명령어 치기"를 "브라우저에서
 * 버튼 누르기"로 바꿔주는 껍데기. 기존 CLI 스크립트(run-megahouse.js 등)는 하나도 안
 * 바꾸고 그대로 자식 프로세스로 실행만 해줌.
 *
 * 사용법: node web/server.js (또는 npm run dashboard) → 브라우저에서 http://localhost:4848 접속
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const express = require('express');

const ROOT = path.join(__dirname, '..'); // sns-report-scraper 폴더 (스크립트들이 있는 곳)
const REPORTS_DIR = path.join(ROOT, 'reports');
const PORT = 4848;
const { listBrands, loadBrand, prepareBrand, readLastRun, DEFAULT_BRAND } = require(path.join(ROOT, 'brand-config'));
const { classifyUrl } = require(path.join(ROOT, 'collect-by-link'));

// 브랜드(메가하우스/굿스마일…)는 화면에서 고르고, 그 값이 모든 버튼에 같이 넘어옴.
// 아무 브랜드나 문자열로 들어오면 안 되니 brands/*.json에 실제로 있는 키만 통과시킴.
function resolveBrandKey(raw) {
  const keys = listBrands().map(b => b.key);
  if (!raw) return DEFAULT_BRAND;
  if (!keys.includes(raw)) throw new Error(`알 수 없는 브랜드입니다: ${raw} (가능: ${keys.join(', ')})`);
  return raw;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/; // 트위터 핸들 형식(영문/숫자/밑줄, 최대 15자)
const PERIOD_ID_RE = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/; // compare-periods.js 인자 형식

// ── 한 번에 하나만 실행(동시에 여러 개 돌리면 브라우저 세션 충돌 위험) ──
let currentJob = null; // { id, label, child, logs: string[], status, exitCode }
let jobCounter = 0;
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

function appendLog(line) {
  if (!currentJob) return;
  currentJob.logs.push(line);
  if (currentJob.logs.length > 2000) currentJob.logs.shift(); // 로그가 무한정 쌓이지 않게
  broadcast('log', { line });
}

/**
 * 스크립트를 자식 프로세스로 실행(항상 args 배열로 넘겨서 셸 인젝션 위험 없음, shell:true 안 씀).
 * label: 화면에 보여줄 한국어 설명. scriptFile: ROOT 기준 파일명. args: 문자열 배열.
 */
function startJob(label, scriptFile, args) {
  if (currentJob && currentJob.status === 'running') {
    throw new Error('이미 다른 작업이 실행 중입니다 — 끝날 때까지 기다리거나 취소해주세요.');
  }
  const id = ++jobCounter;
  const child = spawn(process.execPath, [path.join(ROOT, scriptFile), ...args], { cwd: ROOT });
  currentJob = { id, label, child, logs: [], status: 'running', exitCode: null };

  child.stdout.on('data', d => appendLog(d.toString()));
  child.stderr.on('data', d => appendLog(d.toString()));
  child.on('close', code => {
    currentJob.status = code === 0 ? 'done' : 'error';
    currentJob.exitCode = code;
    broadcast('status', { status: currentJob.status, exitCode: code });
  });
  child.on('error', err => {
    appendLog(`❌ 실행 자체가 안 됨: ${err.message}`);
    currentJob.status = 'error';
    broadcast('status', { status: 'error' });
  });

  broadcast('status', { status: 'running', label });
  return id;
}

const app = express();
app.use(express.json());
app.use('/reports', express.static(REPORTS_DIR)); // 다운로드용 정적 서빙(이 컴퓨터 안에서만 접근 가능)
app.use(express.static(path.join(__dirname, 'public')));

// ── 처음 쓰는 사람을 위한 준비 상태 확인(로그인 세션 있는지 등) ──
app.get('/api/status', (req, res) => {
  let brandInfo = null;
  try {
    const brand = loadBrand(resolveBrandKey(req.query.brand));
    const lastRun = readLastRun(brand);
    brandInfo = {
      key: brand.key,
      label: brand.label,
      accounts: [...brand.own, ...brand.competitors].filter(a => a.account).length,
      ready: [...brand.own, ...brand.competitors].some(a => a.account),
      hasStock: brand.stockStores.length > 0,
      hasCache: fs.existsSync(brand.paths.cache),
      lastRun,
      datePresets: brand.datePresets,
      defaultDateMode: brand.defaultDateMode,
    };
  } catch (e) {
    brandInfo = { error: e.message };
  }
  res.json({
    hasTwitterSession: fs.existsSync(path.join(ROOT, 'x-session.json')),
    hasInstagramSession: fs.existsSync(path.join(ROOT, 'instagram-session.json')),
    hasNotionConfig: fs.existsSync(path.join(ROOT, 'notion-config.json')),
    brand: brandInfo,
    job: currentJob ? { id: currentJob.id, label: currentJob.label, status: currentJob.status } : null,
  });
});

// ── 설치된 브랜드 목록(화면 맨 위 브랜드 선택용) ──
app.get('/api/brands', (req, res) => {
  try {
    res.json(listBrands());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 리포트 목록(다운로드용) ──
app.get('/api/reports', (req, res) => {
  let brandKey;
  try {
    brandKey = resolveBrandKey(req.query.brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  // 브랜드 폴더(reports/<브랜드>/) 안의 리포트를 보여줌. 추가로 기본 브랜드일 때는 예전
  // 위치(reports/ 바로 아래)에 있던 파일도 같이 보여줌 — 브랜드 폴더 도입 전에 만든
  // 리포트가 목록에서 갑자기 사라진 것처럼 보이면 안 되므로(데이터 유실 오해 방지).
  const dirs = [
    { rel: brandKey, abs: path.join(REPORTS_DIR, brandKey) },
    // 맞대결 리포트는 기간 리포트와 섞이면 헷갈려서 하위 폴더에 따로 저장됨 —
    // 목록에서는 같이 보여야 함(만든 사람 입장에선 둘 다 "방금 만든 리포트")
    { rel: `${brandKey}/matchup`, abs: path.join(REPORTS_DIR, brandKey, 'matchup') },
  ];
  if (brandKey === DEFAULT_BRAND) dirs.push({ rel: '', abs: REPORTS_DIR });

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir.abs)) continue;
    for (const e of fs.readdirSync(dir.abs, { withFileTypes: true })) {
      if (!e.isFile() || !(e.name.endsWith('.html') || e.name.endsWith('.xlsx'))) continue;
      const stat = fs.statSync(path.join(dir.abs, e.name));
      files.push({
        name: e.name,
        path: dir.rel ? `${dir.rel}/${e.name}` : e.name,
        legacy: dir.rel === '',
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// ── 실시간 로그 스트림(SSE) ──
app.get('/api/jobs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  if (currentJob) {
    res.write(`event: init\ndata: ${JSON.stringify({ label: currentJob.label, status: currentJob.status, logs: currentJob.logs })}\n\n`);
  }
  req.on('close', () => sseClients.delete(res));
});

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

// ── 오늘/기간 지정 수집 (run-megahouse.js) ──
app.post('/api/collect', (req, res) => {
  const { mode, startDate, endDate, platform, withStock, stockMode, keyword } = req.body || {};
  let brandKey;
  try {
    brandKey = resolveBrandKey((req.body || {}).brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  const args = [`brand=${brandKey}`];
  if (platform) {
    if (platform !== 'twitter' && platform !== 'instagram') return badRequest(res, '플랫폼은 twitter 또는 instagram만 가능합니다.');
    args.push(platform);
  }
  if (mode === 'today') {
    args.push('today');
  } else if (mode === 'range') {
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return badRequest(res, '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).');
    args.push(startDate, endDate);
  } else if (mode === 'since-last') {
    // 게시 주기가 뜨문한 브랜드(굿스마일 등)에서 빠뜨리는 기간이 없게 — 마지막 수집 다음날부터 오늘까지
    args.push('since-last');
  } else {
    return badRequest(res, '오늘(today) / 기간(range) / 마지막 수집 이후(since-last) 중 하나를 선택해주세요.');
  }
  // 재고 스냅샷은 기본으로 같이 찍음(안 찍으면 나중에 소급이 안 돼서 추이가 비어버림).
  // 화면에서 체크를 끄면 nostock으로 넘어와서 SNS만 수집.
  if (withStock === false) args.push('nostock');
  if (stockMode === 'ratio' || stockMode === 'none') args.push(`stock=${stockMode}`);
  // 키워드는 한 단어만 받음 — 공백이 들어오면 스크립트 인자가 쪼개져 엉뚱하게 해석되므로 막음
  if (keyword) {
    const word = String(keyword).trim();
    if (/\s/.test(word)) return badRequest(res, '키워드는 띄어쓰기 없이 한 단어만 넣어주세요.');
    if (word.length > 30) return badRequest(res, '키워드가 너무 깁니다(30자 이내).');
    args.push(`keyword=${word}`);
  }
  try {
    const id = startJob(`SNS 실적 수집 (${brandKey})`, 'run-megahouse.js', args);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 캐시로만 재생성 (rebuild-report.js) ──
app.post('/api/rebuild', (req, res) => {
  const { stockMode, keyword } = req.body || {};
  let brandKey;
  try {
    brandKey = resolveBrandKey((req.body || {}).brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  const args = [`brand=${brandKey}`];
  if (stockMode === 'ratio' || stockMode === 'none') args.push(`stock=${stockMode}`);
  if (keyword) {
    const word = String(keyword).trim();
    if (/\s/.test(word)) return badRequest(res, '키워드는 띄어쓰기 없이 한 단어만 넣어주세요.');
    if (word.length > 30) return badRequest(res, '키워드가 너무 깁니다(30자 이내).');
    args.push(`keyword=${word}`);
  }
  try {
    const id = startJob(`캐시로 리포트 재생성 (${brandKey})`, 'rebuild-report.js', args);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── ⚔️ 게시글 맞대결 (run-matchup.js) ──
// 기간 수집과 달리 링크만 받음. 링크 형식 검사는 서버에서 먼저 해서, 잘못된 주소 때문에
// 브라우저를 띄웠다가 실패하는 헛수고를 막고 어디가 틀렸는지 바로 알려줌.
app.post('/api/matchup', (req, res) => {
  const body = req.body || {};
  let brandKey;
  try {
    brandKey = resolveBrandKey(body.brand);
  } catch (e) {
    return badRequest(res, e.message);
  }

  const title = String(body.title || '').trim();
  if (!title) return badRequest(res, '이 맞대결의 이름을 적어주세요.');
  if (title.length > 100) return badRequest(res, '이름이 너무 깁니다(100자 이내).');

  const rawPairs = Array.isArray(body.pairs) ? body.pairs : [];
  const pairs = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const p = rawPairs[i] || {};
    const pw = String(p.pw || '').trim();
    const bh = String(p.bh || '').trim();
    if (!pw && !bh) continue; // 빈 줄은 그냥 건너뜀 — "＋ 한 쌍 더"로 늘려놓고 안 채운 경우
    for (const [side, url] of [['당사', pw], ['경쟁사', bh]]) {
      if (!url) continue;
      const c = classifyUrl(url);
      if (!c.ok) return badRequest(res, `${i + 1}번째 ${side} 링크를 못 알아봤어요 — ${c.error}`);
    }
    pairs.push({ label: String(p.label || '').trim() || undefined, pw: pw || undefined, bh: bh || undefined });
  }
  if (pairs.length === 0) return badRequest(res, '비교할 링크를 최소 한 개는 넣어주세요.');

  const outDir = path.join(REPORTS_DIR, brandKey, 'matchup');
  fs.mkdirSync(outDir, { recursive: true });
  const inputPath = path.join(outDir, '_pending-input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ title, pairs }, null, 2));

  try {
    const id = startJob(`게시글 맞대결 (${brandKey})`, 'run-matchup.js', [`brand=${brandKey}`, `input=${inputPath}`]);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 재고만 찍기 (naver-stock-snapshot.js) ──
// SNS 수집은 몇 분씩 걸리고 로그인 세션도 필요한데, 재고 스냅샷은 공개 페이지라 세션 없이
// 수십 초면 끝남. 추이 그래프는 같은 상품이 2개 시점 이상 관측돼야 나오므로, SNS 수집과
// 무관하게 재고만 자주 쌓고 싶을 때 쓰라고 분리한 버튼.
app.post('/api/stock-snapshot', (req, res) => {
  let brandKey;
  try {
    brandKey = resolveBrandKey((req.body || {}).brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  try {
    const id = startJob(`재고 스냅샷 찍기 (${brandKey})`, 'naver-stock-snapshot.js', [`brand=${brandKey}`]);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 노션으로 보내기 (notion-export.js) ──
app.post('/api/export-notion', (req, res) => {
  let brandKey;
  try {
    brandKey = resolveBrandKey((req.body || {}).brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  try {
    const id = startJob(`노션으로 리포트 보내기 (${brandKey})`, 'notion-export.js', [`brand=${brandKey}`]);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 노션용 마크다운 표(복사-붙여넣기용) — 연동/토큰 필요 없이 바로 계산해서 반환 ──
app.get('/api/export-markdown', (req, res) => {
  try {
    // notion-export.js는 로드 시점에 커맨드라인에서 브랜드를 읽으므로, 여기서 브랜드별로
    // 다시 불러오려면 모듈 캐시를 비워야 함 — 대시보드에서 브랜드를 바꿔 눌렀을 때
    // 이전 브랜드 캐시를 그대로 쓰는 것을 막기 위함.
    const brandKey = resolveBrandKey(req.query.brand);
    process.argv = [process.argv[0], process.argv[1], `brand=${brandKey}`];
    delete require.cache[require.resolve(path.join(ROOT, 'notion-export'))];
    const { loadReport, buildMarkdownExport } = require(path.join(ROOT, 'notion-export'));
    const report = loadReport();
    res.json({ markdown: buildMarkdownExport(report) });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 기간별 비교 (compare-periods.js) ──
app.post('/api/compare-periods', (req, res) => {
  const { periods } = req.body || {};
  let brandKey;
  try {
    brandKey = resolveBrandKey((req.body || {}).brand);
  } catch (e) {
    return badRequest(res, e.message);
  }
  if (!Array.isArray(periods) || periods.length < 2) return badRequest(res, '기간을 2개 이상 입력해주세요.');
  if (!periods.every(p => PERIOD_ID_RE.test(p))) return badRequest(res, '기간 형식이 올바르지 않습니다(예: 2026-06-10_2026-06-13).');
  try {
    const id = startJob(`기간별 비교 (${brandKey})`, 'compare-periods.js', [`brand=${brandKey}`, ...periods]);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 임의 계정 단독 수집 (collect-account.js) ──
app.post('/api/collect-account', (req, res) => {
  const { handle, startDate, endDate, plaintext } = req.body || {};
  if (!HANDLE_RE.test(handle)) return badRequest(res, '핸들 형식이 올바르지 않습니다(영문/숫자/밑줄, @ 없이).');
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return badRequest(res, '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).');
  const args = [handle, startDate, endDate];
  if (plaintext) args.push('plaintext');
  try {
    const id = startJob(`@${handle} 계정 단독 수집`, 'collect-account.js', args);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 로그인 세션 만들기 (login-session.js) — 브라우저 창이 이 컴퓨터 화면에 직접 뜸 ──
app.post('/api/login-session/start', (req, res) => {
  const { platform } = req.body || {};
  if (platform !== 'twitter' && platform !== 'instagram') return badRequest(res, '플랫폼은 twitter 또는 instagram만 가능합니다.');
  try {
    const id = startJob(`${platform} 로그인 세션 만들기`, 'login-session.js', [platform]);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});
// login-session.js는 터미널에서 엔터 입력을 기다리는데, 자식 프로세스로 띄웠으니 화면의
// "로그인 완료했어요" 버튼을 누르면 그 입력을 대신 보내줌(사람이 직접 로그인하는 과정
// 자체는 그대로 — 이 버튼은 "다 했다"는 신호만 대신 전달하는 것).
app.post('/api/login-session/confirm', (req, res) => {
  if (!currentJob || currentJob.status !== 'running') return badRequest(res, '진행 중인 로그인 작업이 없습니다.');
  currentJob.child.stdin.write('\n');
  res.json({ ok: true });
});

app.post('/api/jobs/cancel', (req, res) => {
  if (!currentJob || currentJob.status !== 'running') return badRequest(res, '진행 중인 작업이 없습니다.');
  currentJob.child.kill();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ 대시보드 실행 중 — 브라우저에서 http://localhost:${PORT} 열어주세요`);
});
