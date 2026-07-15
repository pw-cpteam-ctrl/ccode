// PNG 다운로드 시점에만 AI 학습(무료 사전 자동 반영) 로그를 남긴다.
// AI가 방금 뽑아낸 원본 값이 아니라, 사용자가 3번 칸에서 실제로 수정을 마치고
// 다운로드 버튼을 누른 "최종 확정 값"을 기준으로 학습한다 — AI가 캐릭터를 잘못
// 인식했는데 사용자가 고치지 않고 그냥 다운로드한 경우가 아니면 오류가 학습되지 않는다.
import { recordLearning } from '../lib/learning.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const { sourceText, workJp, productJp, work, product } = req.body || {};

  const gh = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || 'main',
  };
  if (!gh.token || !gh.owner || !gh.repo) { res.status(200).json({ ok: false, skipped: true }); return; }
  if (!work && !product) { res.status(200).json({ ok: false, skipped: true }); return; }

  try {
    await recordLearning({ work, workJp, product, productJp }, sourceText || '', gh);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('다운로드 시점 학습 기록 실패(다운로드 자체엔 영향 없음):', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
}
