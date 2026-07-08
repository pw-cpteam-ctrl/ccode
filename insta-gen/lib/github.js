// GitHub Contents API로 특정 저장소의 파일에 내용을 이어붙이거나(append) JSON을
// 읽고-고쳐서-다시 쓰는(read-modify-write) 커밋 헬퍼.
// 브라우저에서 깃허브 토큰을 직접 쓰지 않고 이 백엔드 함수를 거쳐서만 쓰기 위해 사용한다.
// api/ 밑이 아니라 lib/에 둬서 Vercel이 이 파일 자체를 별도 엔드포인트로 만들지 않게 했다.

const API_BASE = 'https://api.github.com';

// path의 JSON 파일을 읽어서 mutate(현재값)로 고친 뒤 다시 커밋한다.
// 파일이 없으면(404) defaultValue에서 시작한다. mutate가 false를 반환하면 커밋을 건너뛴다.
export async function updateGithubJsonFile({ token, owner, repo, branch, path, defaultValue, mutate, message }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let sha;
  let current = defaultValue;
  const getRes = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers }
  );
  if (getRes.status === 200) {
    const file = await getRes.json();
    sha = file.sha;
    current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
  } else if (getRes.status !== 404) {
    const errText = await getRes.text();
    throw new Error(`파일 조회 실패 (${getRes.status}): ${errText}`);
  }

  const updated = mutate(current);
  if (updated === false) return null; // 바꿀 게 없으면 커밋 스킵

  const putRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(updated, null, 2) + '\n', 'utf-8').toString('base64'),
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
