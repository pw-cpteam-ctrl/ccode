// POST /api/save-dict — 화면의 "사전 관리" 패널에서 사용자가 명시적으로 저장
// 버튼을 눌렀을 때만 호출된다 (타이핑할 때마다 자동 커밋하지 않음 — 계속 늘어나는
// 팀 공유 데이터라 실수 커밋을 막기 위해 명시적 확인 후 반영 원칙을 그대로 적용).
//
// body: { section: 'ipNameMap' | 'gradeTable' | 'moodClusters' | 'storeProfiles', value: <새 값> }
// 섹션 전체를 덮어쓴다 — 프론트가 이미 seed값과 병합된 전체 값을 들고 있으므로
// 서버는 부분 병합 없이 그대로 저장한다.

import { updateGithubJsonFile } from '../lib/github.js';

const VALID_SECTIONS = ['ipNameMap', 'gradeTable', 'moodClusters', 'storeProfiles'];
const EMPTY = { ipNameMap: {}, gradeTable: { S: [], A: [] }, moodClusters: [], storeProfiles: {} };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const { section, value } = req.body || {};
  if (!VALID_SECTIONS.includes(section)) {
    res.status(400).json({ error: `section은 ${VALID_SECTIONS.join('/')} 중 하나여야 합니다.` });
    return;
  }
  if (value === undefined) {
    res.status(400).json({ error: 'value가 필요합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'inbound-image-composer-data';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO 환경변수가 설정되지 않았습니다.' });
    return;
  }

  try {
    await updateGithubJsonFile({
      token, owner, repo, branch,
      path: 'inbound-image-composer/dict-data.json',
      defaultValue: EMPTY,
      message: `inbound-image-composer: ${section} 사전 갱신`,
      mutate: (current) => ({ ...EMPTY, ...current, [section]: value }),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `커밋 실패: ${err.message}` });
  }
}
