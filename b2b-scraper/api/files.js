/**
 * 팀원 PC의 update.js가 최신 코드를 받아가는 유일한 통로.
 *
 * 왜 GitHub에서 직접 받지 않고 이 endpoint를 거치나:
 *   - 팀원 파일 어디에도 개발 저장소(계정/레포) 이름이 남지 않는다. 팀원이 update.js를
 *     열어봐도 보이는 건 이 프로젝트의 vercel.app 주소뿐이다.
 *   - zip을 통째로 받아 푸는 방식과 달리, 여기서 골라낸 파일만 내려가므로 다른 프로젝트
 *     파일이 팀원 폴더에 잠깐이라도 풀리는 일이 없다.
 *
 * 토큰이 필요 없는 이유: 원본 저장소가 공개(public)라 인증 없이 읽힌다. 그래서 "토큰이
 * 만료돼서 배포가 조용히 멈추는" 실패 모드가 아예 없다. (나중에 저장소를 비공개로 바꾸면
 * 이 endpoint에 토큰이 필요해진다 — 그때 여기만 고치면 됨)
 *
 * 응답:
 *   GET /api/files          → { version, generatedAt, files: [{ name, content }] }
 *   GET /api/files?meta=1   → { version, generatedAt, count }   (새 버전 확인용, 가벼움)
 */
const crypto = require('crypto');

const OWNER = 'pw-cpteam-ctrl';
const REPO = 'ccode';
const BRANCH = 'main';
const DIR = 'b2b-scraper';

// 평소엔 GitHub. 환경변수로 바꿔 끼울 수 있게 둔 이유는 두 가지다:
//   (1) 이 endpoint 전체를 가짜 저장소로 테스트할 수 있어야 한다 (실제 배포 통로라 검증이 필수).
//   (2) 나중에 저장소를 비공개로 바꾸면 인증이 필요해지는데, 그때 손댈 곳이 여기로 모인다.
const API_BASE = process.env.GH_API_BASE || 'https://api.github.com';

// 팀원에게 내려보내지 않는 것들.
const EXCLUDE = new Set([
  'README.md',      // 개발용 문서 — 내부 판단 근거와 저장소 구조가 적혀있어 팀원용이 아니다
  'recon.js',       // 개발용 사이트 정찰 도구
  'vercel.json',    // 배포 설정
  'update.bat',     // 실행 중 자기 자신을 덮어쓰면 CMD가 오작동한다 (아래 주석 참고)
  '.local-version', // 팀원 PC의 로컬 상태
]);

// update.bat을 제외하는 이유: CMD는 배치 파일을 줄 단위로 읽으면서 실행해서, 실행 중에
// 그 파일이 바뀌면 엉뚱한 줄로 튄다. 그래서 update.bat은 "노드를 부르기만 하는 껍데기"로
// 두고 앞으로 손대지 않는 쪽을 택했다. 실제 업데이트 로직(update.js)은 노드가 파일을
// 통째로 읽고 닫는 방식이라 자기 자신이 덮어써져도 안전하므로 여기서 함께 내려보낸다.

const TIMEOUT_MS = 8000;

async function ghFetch(url, accept) {
  const res = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'b2b-scraper-update' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

async function collectFiles() {
  const listUrl = `${API_BASE}/repos/${OWNER}/${REPO}/contents/${DIR}?ref=${BRANCH}`;
  const listing = await (await ghFetch(listUrl, 'application/vnd.github+json')).json();
  if (!Array.isArray(listing)) throw new Error('목록 형식이 예상과 다릅니다');

  const targets = listing
    .filter(e => e.type === 'file' && !EXCLUDE.has(e.name) && e.download_url)
    .sort((a, b) => a.name.localeCompare(b.name)); // 정렬해둬야 version 해시가 안정적

  const files = [];
  for (const entry of targets) {
    const content = await (await ghFetch(entry.download_url, 'text/plain')).text();
    files.push({ name: entry.name, content });
  }
  return files;
}

/**
 * "새 파일을 추가했는데 목록에서 빠져서 팀원 쪽이 Cannot find module로 죽는" 사고를 막는
 * 자체 점검. 내려보낼 .js 파일들이 require하는 같은 폴더 파일이 전부 들어있는지 확인한다.
 * (이건 실제로 겪을 가능성이 가장 높은 실패라, 팀원이 겪기 전에 여기서 터지게 만든다)
 */
function findMissingRequires(files) {
  const present = new Set(files.map(f => f.name));
  const missing = new Set();
  for (const f of files) {
    if (!f.name.endsWith('.js')) continue;
    for (const m of f.content.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
      const target = m[1].replace(/^\.\//, '');
      const candidates = [target, `${target}.js`, `${target}.json`];
      if (!candidates.some(c => present.has(c))) missing.add(`${f.name} → ${m[1]}`);
    }
  }
  return [...missing];
}

function versionOf(files) {
  const h = crypto.createHash('sha256');
  // 내용이 바뀔 때만 값이 바뀌도록 이름+내용을 전부 넣어 해시한다(커밋 sha를 쓰면 관계없는
  // 커밋에도 값이 바뀌어서 "새 버전 있음"이 헛되게 뜬다).
  for (const f of files) h.update(f.name).update('\0').update(f.content).update('\0');
  return h.digest('hex').slice(0, 12);
}

module.exports = async (req, res) => {
  try {
    const files = await collectFiles();

    const missing = findMissingRequires(files);
    if (missing.length) {
      // 불완전한 묶음을 내려보내면 팀원 도구가 아예 실행 불가가 된다 — 차라리 실패시킨다.
      res.status(500).json({
        error: '배포 묶음이 불완전합니다(내부 점검 실패). 담당자 확인이 필요합니다.',
        missing,
      });
      return;
    }

    const payload = { version: versionOf(files), generatedAt: new Date().toISOString(), count: files.length };

    // 원본을 매번 다시 읽지 않도록 잠깐 캐시 — GitHub 쪽 요청 횟수를 아낀다.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');

    if (req.query && (req.query.meta === '1' || req.query.meta === 'true')) {
      res.status(200).json(payload);
      return;
    }
    res.status(200).json({ ...payload, files });
  } catch (err) {
    res.status(502).json({ error: `최신 코드를 읽어오지 못했습니다: ${err.message}` });
  }
};
