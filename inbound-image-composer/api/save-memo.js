// POST /api/save-memo — 개선사항 메모장 저장용 공용 서버리스 함수.
//
// 메모는 AI에 절대 전송되지 않고, 사람이 나중에 훑어보고 규칙을 고칠지 판단하는
// 용도다. GitHub 파일(기록)과 이슈(처리 여부 관리) + 슬랙/메일(실제 알림)로 보낸다.
//
// GitHub 이슈는 알림 수단이 아니다 — 서버가 관리자 토큰으로 만들기 때문에 GitHub
// 입장에서는 항상 "본인이 만든 이슈"이고, GitHub는 본인 활동에 알림을 보내지 않는다
// (직접 확인함). 그래서 실제 알림은 슬랙/메일처럼 GitHub 밖 경로가 반드시 필요하다.
//
// CORS를 열어둬서 다른 프로젝트(Vercel/GitHub Pages 등)의 프론트에서도 이 주소를
// 그대로 불러 쓸 수 있다 — 새 도구를 붙일 때 서버 함수를 새로 만들 필요가 없다.
//
// main이 아니라 데이터 전용 브랜치(GITHUB_BRANCH, 기본 inbound-image-composer-data)에
// 커밋한다 — main에 쌓으면 메모 하나마다 이 프로젝트 배포가 다시 돌기 때문
// (load-dict.js/save-dict.js와 동일한 이유, 동일한 기본값).

import { appendToGithubFile } from '../lib/github.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST 요청만 지원합니다.' }); return; }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'inbound-image-composer-data';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: '환경변수가 아직 설정되지 않았어요. 그동안 메모는 브라우저에만 저장돼요.' });
    return;
  }

  const { memo, tool } = req.body || {};
  const TOOL = String(tool || '알 수 없는 도구').slice(0, 40);
  if (!memo || !memo.trim()) { res.status(400).json({ error: '저장할 메모 내용이 비어 있어요.' }); return; }
  if (memo.length > 2000) { res.status(400).json({ error: '메모가 너무 길어요(2000자 이내).' }); return; } // 실수로 원고를 통째로 붙여넣는 경우 방지

  const text = memo.trim();
  const short = text.replace(/\s+/g, ' ').slice(0, 40) + (text.length > 40 ? '…' : '');

  try {
    // ── ① 파일에 한 줄 쌓기 (나중에 통째로 훑어볼 기록)
    await appendToGithubFile({
      token, owner, repo, branch,
      path: `${TOOL}/improvement-notes.md`,
      newLine: `- [${new Date().toISOString()}] ${text.replace(/\n/g, ' ')}`,
      message: '개선사항 메모 추가',
    });

    // ── ② 이슈 만들기 (처리했는지 관리하는 용도 — 알림 용도가 아님, 위 설명 참고)
    let notified = false;
    let issueUrl = '';
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `[개선사항] ${TOOL} — ${short}`,
          body: `**도구**: ${TOOL}\n**적은 시각**: ${new Date().toISOString()}\n\n${text}\n\n---\n처리했으면 이 이슈를 닫아주세요. 열려 있는 이슈 = 아직 처리 안 한 개선사항입니다.`,
          labels: ['개선사항'],
          assignees: [process.env.GITHUB_ISSUE_ASSIGNEE || owner],
        }),
      });
      notified = r.ok;
      if (r.ok) issueUrl = (await r.json().catch(() => ({}))).html_url || '';
      else console.warn('이슈 생성 실패(메모 저장은 완료됨):', r.status, await r.text());
    } catch (e) { console.warn('이슈 생성 실패(메모 저장은 완료됨):', e); }

    // ── ③ 슬랙 알림 (실제로 알림이 오는 경로)
    let slacked = false;
    const hook = process.env.SLACK_WEBHOOK_URL;
    if (hook) {
      try {
        const r = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `*[개선사항] ${TOOL}*\n${text}` + (issueUrl ? `\n${issueUrl}` : '') }),
        });
        slacked = r.ok;
        if (!r.ok) console.warn('슬랙 알림 실패(메모 저장은 완료됨):', r.status);
      } catch (e) { console.warn('슬랙 알림 실패(메모 저장은 완료됨):', e); }
    }

    // ── ④ 메일 알림 (선택 — 슬랙을 못 보는 시간대용)
    let mailed = false;
    const mailKey = process.env.RESEND_API_KEY;
    const mailTo = process.env.MEMO_MAIL_TO;
    if (mailKey && mailTo) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mailKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.MEMO_MAIL_FROM || 'onboarding@resend.dev',
            to: [mailTo],
            subject: `[개선사항] ${TOOL} — ${short}`,
            text: `도구: ${TOOL}\n적은 시각: ${new Date().toISOString()}\n\n${text}` + (issueUrl ? `\n\n처리 기록: ${issueUrl}` : ''),
          }),
        });
        mailed = r.ok;
        if (!r.ok) console.warn('메일 알림 실패(메모 저장은 완료됨):', r.status, await r.text());
      } catch (e) { console.warn('메일 알림 실패(메모 저장은 완료됨):', e); }
    }

    // 알림 실패는 저장 실패가 아니다 — 파일 기록은 이미 끝났으므로 200으로 돌려주고
    // 어느 경로까지 갔는지만 알려준다 (프론트가 "저장됨 / 알림 실패"를 구분해서 보여줌).
    res.status(200).json({ ok: true, notified, slacked, mailed });
  } catch (err) {
    res.status(502).json({ error: `메모 저장 중 오류: ${err.message}` });
  }
}
