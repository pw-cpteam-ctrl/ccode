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
  res.json({
    hasTwitterSession: fs.existsSync(path.join(ROOT, 'x-session.json')),
    hasInstagramSession: fs.existsSync(path.join(ROOT, 'instagram-session.json')),
    job: currentJob ? { id: currentJob.id, label: currentJob.label, status: currentJob.status } : null,
  });
});

// ── 리포트 목록(다운로드용) ──
app.get('/api/reports', (req, res) => {
  const files = fs.readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.xlsx')))
    .map(e => {
      const stat = fs.statSync(path.join(REPORTS_DIR, e.name));
      return { name: e.name, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
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
  const { mode, startDate, endDate, platform } = req.body || {};
  const args = [];
  if (platform) {
    if (platform !== 'twitter' && platform !== 'instagram') return badRequest(res, '플랫폼은 twitter 또는 instagram만 가능합니다.');
    args.push(platform);
  }
  if (mode === 'today') {
    args.push('today');
  } else if (mode === 'range') {
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return badRequest(res, '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).');
    args.push(startDate, endDate);
  } else {
    return badRequest(res, '오늘(today) 또는 기간(range) 중 하나를 선택해주세요.');
  }
  try {
    const id = startJob('SNS 실적 수집', 'run-megahouse.js', args);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 캐시로만 재생성 (rebuild-report.js) ──
app.post('/api/rebuild', (req, res) => {
  try {
    const id = startJob('캐시로 리포트 재생성', 'rebuild-report.js', []);
    res.json({ jobId: id });
  } catch (e) {
    badRequest(res, e.message);
  }
});

// ── 기간별 비교 (compare-periods.js) ──
app.post('/api/compare-periods', (req, res) => {
  const { periods } = req.body || {};
  if (!Array.isArray(periods) || periods.length < 2) return badRequest(res, '기간을 2개 이상 입력해주세요.');
  if (!periods.every(p => PERIOD_ID_RE.test(p))) return badRequest(res, '기간 형식이 올바르지 않습니다(예: 2026-06-10_2026-06-13).');
  try {
    const id = startJob('기간별 비교', 'compare-periods.js', periods);
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
