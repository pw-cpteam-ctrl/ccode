// Vercel 서버리스 함수: 추첨 결과(당첨자 명단 + 조건)를 GitHub API로 이 레포에 커밋한다.
// 참가자 원본 데이터·댓글은 절대 포함하지 않음 — 당첨자 명단 + 조건 텍스트만 저장.
// Vercel 프로젝트 환경변수에 GITHUB_TOKEN(이 레포 write 권한이 있는 GitHub PAT)을 등록해야 동작한다.

const OWNER = 'pw-cpteam-ctrl';
const REPO = 'ccode';
const RESULTS_DIR = 'event-raffle/results';

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
  const fileName = `${timestamp.replace(/[:.]/g, '-')}.json`;
  const filePath = `${RESULTS_DIR}/${fileName}`;
  const content = JSON.stringify({ drawnAt: timestamp, condition, winners }, null, 2);
  const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `이벤트 추첨 결과 저장: ${fileName}`,
        content: contentBase64,
      }),
    });

    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      res.status(502).json({ error: `GitHub 저장 실패: ${errBody}` });
      return;
    }

    const data = await ghRes.json();
    res.status(200).json({ path: filePath, url: data.content?.html_url });
  } catch (err) {
    res.status(500).json({ error: `저장 처리 중 오류: ${err.message}` });
  }
}
