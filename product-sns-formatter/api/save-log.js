// 입력 로그(상품정보/추가지시/변환결과) 저장용 Vercel 서버리스 함수.
// 미공개 신제품 정보가 섞일 수 있어서 이 레포가 아니라 별도 비공개(private)
// 레포에 저장해야 한다 (PLAN.md 참고). 그 비공개 레포 자체가 아직 정해지지
// 않아서 GITHUB_LOG_REPO 환경변수가 없으면 동작하지 않는다.

import { appendToGithubFile } from '../lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_LOG_OWNER || process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_LOG_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_LOG_OWNER / GITHUB_LOG_REPO(비공개 레포) 환경변수가 아직 설정되지 않았어요. 이번 로그는 저장되지 않고 넘어가요.' });
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
