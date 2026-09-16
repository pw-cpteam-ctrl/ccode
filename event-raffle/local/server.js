/**
 * 로컬 실행기 — 추첨기 화면을 내 컴퓨터에서 띄우고, 인스타 댓글 수집을 버튼으로 실행한다.
 *
 * 하는 일 세 가지:
 *   1) 추첨기 화면(../index.html)을 그대로 보여준다. 단 파일은 손대지 않고, 보내줄 때만
 *      수집 패널을 띄우는 스크립트 한 줄을 끼워 넣는다 — 그래서 웹에 올라간 추첨기는
 *      지금과 100% 똑같이 동작한다.
 *   2) "인스타 로그인" / "댓글 수집" 버튼을 누르면 해당 스크립트를 따로 실행하고,
 *      진행 상황을 화면으로 흘려보낸다.
 *   3) 추첨기가 쓰는 AI 판단 기능은 인터넷에 올라간 주소로 대신 물어봐준다(중계).
 *      로컬에서 직접 부르면 브라우저가 막기 때문.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const 포트 = Number(process.env.PORT) || 4850;
const 추첨기폴더 = path.join(__dirname, '..');            // event-raffle/
const 세션파일 = path.join(__dirname, 'instagram-session.json');
const 원격API = 'https://ccode-delta.vercel.app';          // AI 판단을 대신 물어볼 주소

const app = express();
app.use(express.json({ limit: '50mb' }));
// 잘못된 형식의 요청이 와도 화면이 읽을 수 있는 형태로 답한다(기본값은 HTML이라 화면이 못 읽음)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: '요청 형식이 잘못됐어요.' });
  next();
});

/* 인스타그램 게시물 주소가 맞는지 제대로 확인한다.
   "주소 안에 instagram.com/p/ 라는 글자가 있나"로만 보면
   https://남의사이트.com/?x=instagram.com/p/ 같은 주소도 통과해버린다 —
   그 상태로 열면 내 인스타 로그인이 붙은 브라우저로 엉뚱한 사이트에 들어가게 된다. */
function 인스타게시물주소인가(값) {
  try {
    const u = new URL(String(값));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (!['instagram.com', 'www.instagram.com'].includes(u.hostname.toLowerCase())) return false;
    const 조각 = u.pathname.split('/').filter(Boolean);
    // /p/XXXX/ · /reel/XXXX/ · /계정/p/XXXX/ · /계정/reel/XXXX/
    return (['p', 'reel'].includes(조각[0]) && Boolean(조각[1]))
        || (['p', 'reel'].includes(조각[1]) && Boolean(조각[2]));
  } catch (e) { return false; }
}


/* ── 지금 돌고 있는 작업 하나만 관리 (동시에 두 개 돌리면 브라우저가 엉킴) ── */
const 작업 = { 진행중: null, 종류: '', 로그: [], 결과: null, 듣는이: [] };

function 알림(줄) {
  작업.로그.push(줄);
  if (작업.로그.length > 500) 작업.로그.shift();
  for (const res of 작업.듣는이) res.write(`data: ${JSON.stringify({ 줄 })}\n\n`);
}
function 끝알림(정보) {
  for (const res of 작업.듣는이) res.write(`data: ${JSON.stringify({ 끝: true, ...정보 })}\n\n`);
}

function 실행(파일, 인자들, 종류) {
  작업.종류 = 종류;
  작업.로그 = [];
  const 자식 = spawn(process.execPath, [path.join(__dirname, 파일), ...인자들], {
    cwd: __dirname,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  작업.진행중 = 자식;

  // 자식이 내보내는 글은 덩어리로 끊겨서 온다 — 한 줄이 두 덩어리에 걸쳐 오는 일이 흔하다.
  // 특히 수집 결과는 댓글이 많으면 수십만 글자라 반드시 쪼개져서, 그대로 읽으면 결과를
  // 통째로 못 읽는다. 그래서 줄바꿈이 나올 때까지 모았다가 완성된 줄만 처리한다.
  let 결과줄 = '';
  const 줄모으기 = () => {
    let 남은것 = '';
    return (덩어리) => {
      남은것 += String(덩어리);
      const 줄들 = 남은것.split(/\r?\n/);
      남은것 = 줄들.pop();            // 마지막 조각은 아직 안 끝난 줄일 수 있으니 남겨둔다
      for (const 줄 of 줄들) {
        if (!줄.trim()) continue;
        if (줄.startsWith('__RESULT__')) { 결과줄 = 줄.slice('__RESULT__'.length); continue; }
        알림(줄);
      }
    };
  };
  자식.stdout.on('data', 줄모으기());
  자식.stderr.on('data', 줄모으기());

  자식.on('close', (코드) => {
    작업.진행중 = null;
    if (결과줄) {
      try {
        // 같은 수집 결과를 화면이 두 번 받아 넣는 걸 막기 위해 고유 표시를 붙인다
        작업.결과 = { ...JSON.parse(결과줄), 수집id: `${Date.now()}` };
      } catch (e) { 알림(`결과를 읽지 못했어요: ${e.message}`); }
    }
    끝알림({ 성공: 코드 === 0, 코드, 사람수: 작업.결과?.행들?.length ?? 0 });
  });
  return 자식;
}

/* ── 추첨기 화면 보여주기 (파일은 안 고치고, 보낼 때만 한 줄 끼워 넣음) ── */
function 추첨기화면() {
  const html = fs.readFileSync(path.join(추첨기폴더, 'index.html'), 'utf-8');
  const 끼울것 = `<script src="/local/inject-collect-ui.js"></script>\n</body>`;
  return html.replace('</body>', 끼울것);
}
app.get('/', (req, res) => res.type('html').send(추첨기화면()));
app.get('/index.html', (req, res) => res.type('html').send(추첨기화면()));
app.get('/local/inject-collect-ui.js', (req, res) =>
  res.type('js').sendFile(path.join(__dirname, 'inject-collect-ui.js')));

/* ── 지금 상태 ── */
app.get('/api/local/status', (req, res) => {
  res.json({
    로컬: true,
    로그인됨: fs.existsSync(세션파일),
    진행중: Boolean(작업.진행중),
    종류: 작업.종류,
    결과있음: Boolean(작업.결과),
  });
});

/* ── 진행 상황 흘려보내기 ── */
app.get('/api/local/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  for (const 줄 of 작업.로그) res.write(`data: ${JSON.stringify({ 줄 })}\n\n`);
  작업.듣는이.push(res);
  req.on('close', () => {
    const i = 작업.듣는이.indexOf(res);
    if (i >= 0) 작업.듣는이.splice(i, 1);
  });
});

/* ── 인스타 로그인 ── */
app.post('/api/local/login', (req, res) => {
  if (작업.진행중) return res.status(409).json({ error: '다른 작업이 진행 중이에요.' });
  실행('login-session.js', [], '로그인');
  res.json({ ok: true });
});

/* ── 댓글 수집 ── */
app.post('/api/local/collect', (req, res) => {
  if (작업.진행중) return res.status(409).json({ error: '다른 작업이 진행 중이에요.' });
  const { 주소, 옵션 } = req.body || {};
  if (!인스타게시물주소인가(주소)) {
    return res.status(400).json({ error: '인스타그램 게시물 주소를 확인해주세요 (…/p/… 또는 …/reel/…).' });
  }
  if (!fs.existsSync(세션파일)) {
    return res.status(400).json({ error: '먼저 "인스타 로그인"을 해주세요.' });
  }
  작업.결과 = null;
  실행('collect-instagram.js', [String(주소), JSON.stringify(옵션 || {})], '수집');
  res.json({ ok: true });
});

app.post('/api/local/cancel', (req, res) => {
  if (!작업.진행중) return res.json({ ok: true });
  작업.진행중.kill();
  알림('사용자가 중지했어요.');
  res.json({ ok: true });
});

/* ── 수집 결과 가져가기 ── */
app.get('/api/local/result', (req, res) => {
  if (!작업.결과) return res.status(404).json({ error: '아직 수집된 결과가 없어요.' });
  res.json(작업.결과);
});

/* ── AI 판단 중계 — 로컬 화면에서 부른 걸 인터넷 주소로 대신 물어봐준다 ── */
for (const 길 of ['/api/plan-filter', '/api/filter', '/api/save-result']) {
  app.post(길, async (req, res) => {
    try {
      const r = await fetch(원격API + 길, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const 본문 = await r.text();
      res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(본문);
    } catch (err) {
      res.status(502).json({ error: `AI 판단 서버에 연결하지 못했어요: ${err.message}` });
    }
  });
}

/* ── 그 밖의 주소는 열어주지 않는다 ──
   예전엔 추첨기 폴더를 통째로 공개했는데, 그러면 이 폴더 안의 인스타 로그인 정보
   (instagram-session.json)까지 주소만 알면 내려받아졌다. 추첨기 화면은 자기 파일 하나로
   완결돼 있어서 폴더를 공개할 이유가 없다. */
app.use((req, res) => res.status(404).type('text').send('없는 주소예요.'));

// 내 컴퓨터에서만 열리게 한다 — 이렇게 안 하면 같은 와이파이를 쓰는 다른 사람도
// 이 주소로 들어올 수 있고, 그건 곧 내 인스타 로그인으로 댓글을 긁을 수 있다는 뜻이다.
app.listen(포트, '127.0.0.1', () => {
  console.log(`\n추첨기가 준비됐어요 → http://localhost:${포트}`);
  console.log('이 창을 닫으면 프로그램도 같이 꺼집니다. 다 쓸 때까지 열어두세요.\n');
});
