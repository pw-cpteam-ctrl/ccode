// GET /api/learned-dict — 데이터 전용 브랜치(GITHUB_BRANCH)에 저장된 자동학습
// 사전(learned-dict.json)을 그대로 돌려준다. index.html이 페이지 로드 시 이걸
// fetch해서 무료 사전(dict.js)에 합친다. 프론트에 GitHub 토큰을 노출하지 않으려고
// 항상 이 서버리스 함수를 거쳐서 읽는다.
//
// 데이터를 main이 아닌 별도 브랜치에 두는 이유: main에 커밋하면 Vercel이 그때마다
// 사이트를 재배포하는데(AI로 채우기를 쓸 때마다 재배포되면 빌드 시간 낭비), 데이터
// 브랜치는 Vercel 배포 대상이 아니라서 재배포를 안 일으킨다.

const API_BASE = 'https://api.github.com';

export default async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const empty = { works: {}, chars: {} };

  if (!token || !owner || !repo) { res.status(200).json(empty); return; }

  try {
    const r = await fetch(
      `${API_BASE}/repos/${owner}/${repo}/contents/insta-gen/learned-dict.json?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (r.status === 404) { res.status(200).json(empty); return; }
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const file = await r.json();
    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(json);
  } catch (err) {
    // 학습 사전을 못 읽어도 무료 채우기는 dict.js만으로 정상 동작해야 하므로 에러로 막지 않는다.
    res.status(200).json(empty);
  }
}
