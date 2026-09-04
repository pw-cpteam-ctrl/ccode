// GitHub Contents API로 저장소의 파일 끝에 한 줄을 이어붙이는(append) 커밋 헬퍼.
// 문의 로그를 남기는 용도로만 쓴다.
//
// api/ 밑이 아니라 lib/에 둔다 — Vercel은 api/ 안의 파일을 전부 별도 엔드포인트로
// 만들기 때문에, 여기 두면 외부에서 직접 호출할 수 없는 내부 함수가 된다.
//
// (insta-gen/lib/github.js와 같은 방식이지만 그 파일을 import하지 않고 따로 둔다 —
//  폴더끼리 의존하면 한쪽을 옮길 때 다른 쪽이 깨지기 때문. CLAUDE.md 3번)

const API_BASE = 'https://api.github.com';
const MAX_RETRY = 3; // 동시 문의로 sha 충돌(409/422)이 나면 최신 상태로 다시 읽어 재시도

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

function contentsUrl(owner, repo, path) {
  return `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
}

// 파일을 읽는다. 없으면(404) null, 있으면 { sha, content }를 돌려준다.
export async function readGithubFile({ token, owner, repo, branch, path }) {
  const res = await fetch(`${contentsUrl(owner, repo, path)}?ref=${branch}`, { headers: ghHeaders(token) });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`파일 조회 실패 (${res.status})`);
  const file = await res.json();
  return { sha: file.sha, content: Buffer.from(file.content, 'base64').toString('utf-8') };
}

// 파일 전체를 새 내용으로 덮어쓴다(없으면 새로 만든다).
// 줄을 이어붙이는 appendToGithubFile과 달리, "읽어서 고친 뒤 통째로 다시 쓰는"
// 경우(예: 확정 여부를 담은 JSON)에 쓴다.
export async function writeGithubFile({ token, owner, repo, branch, path, content, message, sha }) {
  const res = await fetch(contentsUrl(owner, repo, path), {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`커밋 실패 (${res.status})`);
  return res.json();
}

// path 파일 끝에 newLine을 덧붙여 커밋한다. 파일이 없으면 새로 만든다.
export async function appendToGithubFile({ token, owner, repo, branch, path, newLine, message }) {
  const headers = ghHeaders(token);
  let lastErr;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    // 1) 현재 내용과 sha를 읽는다 (없으면 404 — 새 파일로 취급)
    let sha;
    let existing = '';
    const getRes = await fetch(`${contentsUrl(owner, repo, path)}?ref=${branch}`, { headers });
    if (getRes.status === 200) {
      const file = await getRes.json();
      sha = file.sha;
      existing = Buffer.from(file.content, 'base64').toString('utf-8');
    } else if (getRes.status !== 404) {
      throw new Error(`파일 조회 실패 (${getRes.status})`);
    }

    // 2) 뒤에 한 줄 붙여서 커밋
    const content = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + newLine + '\n';
    const putRes = await fetch(contentsUrl(owner, repo, path), {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (putRes.ok) return true;

    // 다른 요청이 먼저 써서 sha가 낡은 경우 → 다시 읽어서 재시도
    if (putRes.status === 409 || putRes.status === 422) {
      lastErr = new Error(`커밋 충돌 (${putRes.status})`);
      continue;
    }
    throw new Error(`커밋 실패 (${putRes.status})`);
  }
  throw lastErr || new Error('커밋 실패 (재시도 초과)');
}
