// 개선사항 메모장 저장용 Vercel 서버리스 함수.
// 메모는 LLM에 절대 전송되지 않고, 사람이 나중에 훑어보고 규칙 파일에 반영할지
// 판단하는 용도다 (PLAN.md 참고). 이 레포에 커밋한다.
// GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 없으면 아직 동작하지 않는다.

import { appendToGithubFile } from '../lib/github.js';

// 이슈 제목·본문에 붙는 도구 이름. 다른 도구가 이 함수를 같이 쓰게 되면 요청 본문에서
// 받도록 바꾸면 된다 — 지금은 이 페이지 전용이라 고정해둔다.
const TOOL_LABEL = '원고작성페이지';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 아직 설정되지 않았어요. 그동안 메모는 브라우저에만 임시 저장돼요.' });
    return;
  }

  const { memo } = req.body || {};
  if (!memo || !memo.trim()) {
    res.status(400).json({ error: '저장할 메모 내용이 비어 있어요.' });
    return;
  }

  try {
    const line = `- [${new Date().toISOString()}] ${memo.trim().replace(/\n/g, ' ')}`;
    await appendToGithubFile({
      token,
      owner,
      repo,
      branch,
      path: 'product-sns-formatter/improvement-notes.md',
      newLine: line,
      message: '개선사항 메모 추가',
    });

    // 파일에 쌓는 것과 별개로 이슈를 하나 만든다. GitHub는 커밋에 대해서는 메일을
    // 보내주지 않아서(Watch는 이슈·PR·릴리스만 대상), 파일만 쌓으면 관리자가 직접
    // 열어보기 전까지 새 메모가 들어온 걸 알 수 없다. 실제로 7/29에 들어온 메모를
    // 한참 뒤에야 발견한 적이 있다. 담당자로 지정하면 알림 설정과 무관하게 메일이 온다.
    //
    // 이슈 만들기가 실패해도 실패로 처리하지 않는다 — 메모 저장은 이미 끝났고,
    // 알림이 안 온 것 때문에 사용자에게 "저장 실패"라고 알리면 사실과 다르다.
    let notified = false;
    let issueUrl = '';
    try {
      const assignee = process.env.GITHUB_ISSUE_ASSIGNEE || owner;
      const first = memo.trim().replace(/\s+/g, ' ').slice(0, 40);
      const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `[개선사항] ${TOOL_LABEL} — ${first}${memo.trim().length > 40 ? '…' : ''}`,
          body: `**도구**: ${TOOL_LABEL}\n**적은 시각**: ${new Date().toISOString()}\n\n${memo.trim()}\n\n---\n처리했으면 이 이슈를 닫아주세요. 열려 있는 이슈 = 아직 처리 안 한 개선사항입니다.`,
          labels: ['개선사항'],
          assignees: [assignee],
        }),
      });
      notified = issueRes.ok;
      if (issueRes.ok) {
        const issue = await issueRes.json().catch(() => ({}));
        issueUrl = issue.html_url || '';
      } else {
        console.warn('이슈 생성 실패(메모 저장은 완료됨):', issueRes.status, await issueRes.text());
      }
    } catch (e) {
      console.warn('이슈 생성 실패(메모 저장은 완료됨):', e);
    }

    // 슬랙으로도 알린다. GitHub는 본인이 만든 이슈에 대해서는 알림을 보내지 않아서
    // (알림 설정으로도 안 풀린다), 이슈만으로는 새 메모가 들어온 걸 알 수가 없다.
    // SLACK_WEBHOOK_URL이 없으면 이 단계는 통째로 건너뛴다.
    let slacked = false;
    const hook = process.env.SLACK_WEBHOOK_URL;
    if (hook) {
      try {
        const body = `*[개선사항] ${TOOL_LABEL}*\n${memo.trim()}` + (issueUrl ? `\n${issueUrl}` : '');
        const slackRes = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: body }),
        });
        slacked = slackRes.ok;
        if (!slackRes.ok) console.warn('슬랙 알림 실패(메모 저장은 완료됨):', slackRes.status);
      } catch (e) {
        console.warn('슬랙 알림 실패(메모 저장은 완료됨):', e);
      }
    }

    // 메일로도 보낸다. 슬랙을 안 보는 시간대(외근·휴가)를 위한 두 번째 경로다.
    // RESEND_API_KEY와 MEMO_MAIL_TO가 없으면 통째로 건너뛴다 — 슬랙만 쓰는 상태에서도
    // 지금과 똑같이 동작한다.
    let mailed = false;
    const mailKey = process.env.RESEND_API_KEY;
    const mailTo = process.env.MEMO_MAIL_TO;
    if (mailKey && mailTo) {
      try {
        const mailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mailKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 도메인 인증을 안 했으면 이 발신 주소만 쓸 수 있고, 받는 사람도 가입한
            // 본인 주소로 제한된다. 팀원에게도 보내려면 도메인 인증이 필요하다.
            from: process.env.MEMO_MAIL_FROM || 'onboarding@resend.dev',
            to: [mailTo],
            subject: `[개선사항] ${TOOL_LABEL} — ${memo.trim().replace(/\s+/g, ' ').slice(0, 40)}`,
            text: `도구: ${TOOL_LABEL}\n적은 시각: ${new Date().toISOString()}\n\n${memo.trim()}` +
                  (issueUrl ? `\n\n처리 기록: ${issueUrl}` : ''),
          }),
        });
        mailed = mailRes.ok;
        if (!mailRes.ok) console.warn('메일 알림 실패(메모 저장은 완료됨):', mailRes.status, await mailRes.text());
      } catch (e) {
        console.warn('메일 알림 실패(메모 저장은 완료됨):', e);
      }
    }

    res.status(200).json({ ok: true, notified, slacked, mailed });
  } catch (err) {
    res.status(502).json({ error: `메모 커밋 중 오류: ${err.message}` });
  }
}
