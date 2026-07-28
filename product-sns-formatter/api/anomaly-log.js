// 이상 감지 로그(api/format.js가 남긴 logs/format-anomalies.jsonl)를 읽어서 반환하는 GET 엔드포인트.
// 웹 UI의 "이상 감지 로그" 토글에서 이 엔드포인트를 호출해 화면에 뿌린다.

import { readGithubFile } from '../lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_LOG_OWNER || process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_LOG_REPO || process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 아직 설정되지 않았어요.' });
    return;
  }

  try {
    const file = await readGithubFile({ token, owner, repo, branch, path: 'logs/format-anomalies.jsonl' });
    if (!file) {
      res.status(200).json({ entries: [] });
      return;
    }
    const entries = file.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // 최신이 먼저 오게
    res.status(200).json({ entries });
  } catch (err) {
    res.status(502).json({ error: `로그 조회 실패: ${err.message}` });
  }
}
