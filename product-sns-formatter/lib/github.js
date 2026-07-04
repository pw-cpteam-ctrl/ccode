// GitHub Contents API로 특정 저장소의 파일에 내용을 이어붙이는(append) 커밋 헬퍼.
// 브라우저에서 깃허브 토큰을 직접 쓰지 않고 이 백엔드 함수를 거쳐서만 쓰기 위해 사용한다.
// api/ 밑이 아니라 lib/에 둬서 Vercel이 이 파일 자체를 별도 엔드포인트로 만들지 않게 했다.

const API_BASE = 'https://api.github.com';

export async function appendToGithubFile({ token, owner, repo, branch, path, newLine, message }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let sha;
  let existingContent = '';
  const getRes = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers }
  );
  if (getRes.status === 200) {
    const file = await getRes.json();
    sha = file.sha;
    existingContent = Buffer.from(file.content, 'base64').toString('utf-8');
  } else if (getRes.status !== 404) {
    const errText = await getRes.text();
    throw new Error(`파일 조회 실패 (${getRes.status}): ${errText}`);
  }

  const updatedContent = existingContent + (existingContent ? '\n' : '') + newLine;
  const putRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`커밋 실패 (${putRes.status}): ${errText}`);
  }
  return putRes.json();
}
