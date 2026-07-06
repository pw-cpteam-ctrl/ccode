// 입력 로그(상품정보/추가지시/변환결과) 저장용 Vercel 서버리스 함수.
// 공개돼도 되는 정보로 판단해서 별도 비공개 레포 없이 이 레포(GITHUB_REPO)에
// 같이 저장하기로 결정함 (PLAN.md 참고). 필요해지면 GITHUB_LOG_OWNER /
// GITHUB_LOG_REPO 환경변수로 다른 레포를 지정할 수 있게 남겨둠.

import { appendToGithubFile } from '../lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_LOG_OWNER || process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_LOG_REPO || process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 아직 설정되지 않았어요. 이번 로그는 저장되지 않고 넘어가요.' });
    return;
  }

  const { productText, extraInstruction, result } = req.body || {};
  if (!productText || !productText.trim()) {
    res.status(400).json({ error: '저장할 입력(productText)이 비어 있어요.' });
    return;
  }

  try {
    const entry = {
      at: new Date().toISOString(),
      productText,
      extraInstruction: extraInstruction || '',
      result: result || '',
    };
    const today = entry.at.slice(0, 10);
    await appendToGithubFile({
      token,
      owner,
      repo,
      branch,
      path: `logs/${today}.jsonl`,
      newLine: JSON.stringify(entry),
      message: `입력 로그 추가 (${today})`,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `로그 커밋 중 오류: ${err.message}` });
  }
}
