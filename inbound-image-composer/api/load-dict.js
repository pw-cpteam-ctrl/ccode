// GET /api/load-dict — 데이터 전용 브랜치(GITHUB_BRANCH)에 저장된 IP명 사전/등급표/
// 분위기 클러스터/스토어 프로필(dict-data.json)을 그대로 돌려준다. index.html이 페이지
// 로드 시 이걸 fetch해서 lib/seed-data.js의 초기값과 합친다(서버 데이터가 우선).
// 프론트에 GitHub 토큰을 노출하지 않으려고 항상 이 서버리스 함수를 거쳐서 읽는다.
//
// main이 아니라 별도 데이터 브랜치를 쓰는 이유: main에 커밋하면 Vercel이 그때마다
// 재배포하는데(사전을 저장할 때마다 재배포되면 빌드 시간 낭비), 데이터 브랜치는
// Vercel 배포 대상이 아니라서 재배포를 안 일으킨다. (insta-gen과 동일 패턴)

const API_BASE = 'https://api.github.com';
const EMPTY = { ipNameMap: {}, gradeTable: { S: [], A: [] }, moodClusters: [], storeProfiles: {}, productLineNames: [] };

export default async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'inbound-image-composer-data';

  if (!token || !owner || !repo) { res.status(200).json(EMPTY); return; }

  try {
    const r = await fetch(
      `${API_BASE}/repos/${owner}/${repo}/contents/inbound-image-composer/dict-data.json?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (r.status === 404) { res.status(200).json(EMPTY); return; }
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const file = await r.json();
    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(200).json({ ...EMPTY, ...json });
  } catch (err) {
    // 저장된 사전을 못 읽어도 화면은 seed-data.js 기본값만으로 정상 동작해야 하므로 에러로 막지 않는다.
    res.status(200).json(EMPTY);
  }
}
