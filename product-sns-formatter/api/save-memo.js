// 개선사항 메모장 저장용 Vercel 서버리스 함수.
// 메모는 LLM에 절대 전송되지 않고, 사람이 나중에 훑어보고 규칙 파일에 반영할지
// 판단하는 용도다 (PLAN.md 참고). 이 레포에 커밋한다.
// GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 없으면 아직 동작하지 않는다.

import { appendToGithubFile } from '../lib/github.js';

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
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `메모 커밋 중 오류: ${err.message}` });
  }
}
