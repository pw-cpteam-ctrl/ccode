// Vercel 서버리스 함수: 추첨 결과(당첨자 명단 + 조건)를 GitHub API로 이 레포에 커밋한다.
// 참가자 원본 데이터·댓글은 절대 포함하지 않음 — 당첨자 명단 + 조건 텍스트만 저장.
// Vercel 프로젝트 환경변수에 GITHUB_TOKEN(이 레포 write 권한이 있는 GitHub PAT)을 등록해야 동작한다.
//
// 회차마다 별도 파일을 만들면 나중에 "누가 당첨됐었지" 확인할 때 파일을 하나하나
// 열어봐야 해서 불편하므로, 하나의 누적 기록 파일(history.json)에 계속 추가하는
// 방식으로 저장한다. GitHub Contents API는 파일을 덮어쓸 때 최신 sha가 필요한데,
// 그 사이 다른 저장 요청이 먼저 반영됐을 수 있으니(동시 저장 충돌) 실패하면 최신
// 내용을 다시 받아와 병합 후 재시도한다 — 과거 기록이 덮어써져 사라지는 것을 막기 위함.

const OWNER = 'pw-cpteam-ctrl';
const REPO = 'ccode';
const RESULTS_DIR = 'event-raffle/results';
const HISTORY_PATH = `${RESULTS_DIR}/history.json`;
const MAX_RETRY = 3;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'GITHUB_TOKEN이 설정되지 않았어요. Vercel 프로젝트 환경변수에 등록해주세요.' });
    return;
  }

  const { condition, winners, drawnAt } = req.body || {};
  if (!condition || !Array.isArray(winners) || !winners.length) {
    res.status(400).json({ error: '저장할 결과(조건/당첨자 명단)가 비어 있어요.' });
    return;
  }

  const timestamp = drawnAt && !Number.isNaN(Date.parse(drawnAt)) ? drawnAt : new Date().toISOString();
  const record = { drawnAt: timestamp, condition, winners };
  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${HISTORY_PATH}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  try {
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      let history = [];
      let sha;

      const getRes = await fetch(apiUrl, { headers });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
        try {
          const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          if (Array.isArray(parsed)) history = parsed;
        } catch {
          // 기존 파일이 손상되어 있으면 새로 시작하지 않고 에러로 알림 (과거 기록을 조용히 버리지 않기 위함)
          res.status(500).json({ error: '기존 저장 기록(history.json) 형식이 손상되어 있어요. 레포에서 직접 확인해주세요.' });
          return;
        }
      } else if (getRes.status !== 404) {
        const errBody = await getRes.text();
        res.status(502).json({ error: `기존 기록 조회 실패: ${errBody}` });
        return;
      }

      history.push(record);
      const contentBase64 = Buffer.from(JSON.stringify(history, null, 2), 'utf-8').toString('base64');

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `이벤트 추첨 결과 추가: ${timestamp}`,
          content: contentBase64,
          ...(sha ? { sha } : {}),
        }),
      });

      if (putRes.ok) {
        const putData = await putRes.json();
        res.status(200).json({ path: HISTORY_PATH, url: putData.content?.html_url, totalRecords: history.length });
        return;
      }

      if (putRes.status !== 409 && putRes.status !== 422) {
        const errBody = await putRes.text();
        res.status(502).json({ error: `GitHub 저장 실패: ${errBody}` });
        return;
      }
      // 409/422 = 그 사이 다른 저장이 먼저 반영돼 sha가 낡음 — 최신 내용을 다시 받아서 재시도
    }
    res.status(502).json({ error: '동시에 여러 저장 요청이 몰려서 반영하지 못했어요. 잠시 후 다시 시도해주세요.' });
  } catch (err) {
    res.status(500).json({ error: `저장 처리 중 오류: ${err.message}` });
  }
}
