// 작품(시리즈) 한국 정식 제목 공용 사전을 GitHub에서 바로 읽어다 주는 서버 함수.
//
// 왜 필요하냐면: 예전에는 페이지가 배포된 파일(./data/work-titles.json)을 읽었다.
// 그러면 누가 표기를 하나 저장할 때마다 배포가 한 번 돌아야 팀원 화면에 들어갔다 —
// 글자 몇 개 바뀐 것 때문에 페이지 전체를 다시 만들어 올리는 셈이고, 반영까지 몇 분
// 기다려야 했다. 여기서 GitHub 파일을 직접 읽어다 주면 배포와 무관하게 저장 즉시
// 팀원에게 반영되고, 덕분에 사전만 바뀐 커밋은 배포를 건너뛸 수 있다(vercel.json).
//
// 저장 쪽은 api/save-work-title.js가 같은 파일을 쓴다 — 읽기/쓰기 경로가 한 파일을 본다.

import { readGithubFile } from '../lib/github.js';

const FILE_PATH = 'product-sns-formatter/data/work-titles.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  // 환경변수가 없으면 오류로 막지 않고 빈 목록을 준다 — 페이지는 이걸 받으면
  // 배포된 파일을 대신 읽으러 가므로, 설정 전이어도 사전이 아예 안 뜨는 일은 없다.
  if (!token || !owner || !repo) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ entries: [], source: 'unconfigured' });
    return;
  }

  try {
    const existing = await readGithubFile({ token, owner, repo, branch, path: FILE_PATH });
    let entries = [];
    if (existing) {
      // 파일이 깨져 있어도 페이지가 멈추지 않게 빈 목록으로 넘긴다.
      try { entries = JSON.parse(existing.content).entries || []; } catch { entries = []; }
    }
    // 방금 저장한 표기가 곧바로 보여야 하는 값이라 캐시를 두지 않는다.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ entries, source: 'github' });
  } catch (err) {
    res.status(502).json({ error: `사전을 읽지 못했어요: ${err.message}` });
  }
}
