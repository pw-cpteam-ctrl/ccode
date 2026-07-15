// GitHub Contents API로 특정 저장소의 파일에 내용을 이어붙이거나(append) JSON을
// 읽고-고쳐서-다시 쓰는(read-modify-write) 커밋 헬퍼.
// 브라우저에서 깃허브 토큰을 직접 쓰지 않고 이 백엔드 함수를 거쳐서만 쓰기 위해 사용한다.
// api/ 밑이 아니라 lib/에 둬서 Vercel이 이 파일 자체를 별도 엔드포인트로 만들지 않게 했다.

const API_BASE = 'https://api.github.com';
const MAX_RETRY = 3; // 동시 다운로드로 sha 충돌(409/422)이 나면 최신 sha로 다시 읽어 재시도

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

// 여러 요청이 거의 동시에 같은 파일을 수정하면 먼저 읽은 sha가 낡아 PUT이 409/422로
// 거절될 수 있다. 그때마다 파일을 다시 읽어(=최신 sha·최신 내용) 수정을 얹어 재시도한다.
// buildBody(current)는 {content, extra} 형태로 커밋 바디에 넣을 값을 만들거나,
// null을 반환해 커밋을 건너뛴다.
async function commitWithRetry({ token, owner, repo, branch, path }, buildBody) {
  const headers = ghHeaders(token);
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    let sha;
    let existing = null;
    const getRes = await fetch(
      `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${branch}`,
      { headers }
    );
    if (getRes.status === 200) {
      const file = await getRes.json();
      sha = file.sha;
      existing = Buffer.from(file.content, 'base64').toString('utf-8');
    } else if (getRes.status !== 404) {
      throw new Error(`파일 조회 실패 (${getRes.status}): ${await getRes.text()}`);
    }

    const built = buildBody(existing);
    if (built === null) return null; // 바꿀 게 없으면 커밋 스킵

    const putRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: built.message,
        content: Buffer.from(built.content, 'utf-8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (putRes.ok) return putRes.json();
    // sha 충돌이면 최신 상태로 다시 시도, 그 외 오류는 즉시 실패
    if (putRes.status === 409 || putRes.status === 422) {
      lastErr = new Error(`커밋 충돌 (${putRes.status}) — 재시도`);
      continue;
    }
    throw new Error(`커밋 실패 (${putRes.status}): ${await putRes.text()}`);
  }
  throw lastErr || new Error('커밋 실패 (재시도 초과)');
}

// path의 JSON 파일을 읽어서 mutate(현재값)로 고친 뒤 다시 커밋한다.
// 파일이 없으면(404) defaultValue에서 시작한다. mutate가 false를 반환하면 커밋을 건너뛴다.
export async function updateGithubJsonFile({ token, owner, repo, branch, path, defaultValue, mutate, message }) {
  return commitWithRetry({ token, owner, repo, branch, path }, (existing) => {
    const current = existing === null ? defaultValue : JSON.parse(existing);
    const updated = mutate(current);
    if (updated === false) return null;
    return { content: JSON.stringify(updated, null, 2) + '\n', message };
  });
}

export async function appendToGithubFile({ token, owner, repo, branch, path, newLine, message }) {
  return commitWithRetry({ token, owner, repo, branch, path }, (existing) => {
    const base = existing || '';
    return { content: base + (base ? '\n' : '') + newLine, message };
  });
}
