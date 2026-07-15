// AI가 인식한 (일본어→한글) 작품/캐릭터 짝을 계속 기록하고, 같은 짝이 2번째로
// 나오는 순간 '무료로 채우기'가 읽는 learned-dict.json에 반영한다.
// GITHUB_TOKEN/OWNER/REPO 환경변수가 없으면 호출 쪽에서 아예 부르지 않는다(메인 기능엔 영향 없음).
//
// 호출 시점: PNG 다운로드 시점(api/log-download.js) — AI가 막 뽑아낸 원본 값이 아니라
// 사용자가 3번 칸에서 실제로 수정을 마치고 다운로드한 최종 값을 기준으로 학습한다.

import { appendToGithubFile, updateGithubJsonFile } from './github.js';

export async function recordLearning(parsed, sourceText, gh) {
  const today = new Date().toISOString().slice(0, 10);
  await appendToGithubFile({
    ...gh,
    path: `insta-gen/logs/${today}.jsonl`,
    newLine: JSON.stringify({ at: new Date().toISOString(), sourceText, parsed }),
    message: `insta-gen 파싱 로그 (${today})`,
  });

  const candidates = [];
  if (parsed.workJp && parsed.work) candidates.push({ kind: 'works', jp: parsed.workJp.trim(), kr: parsed.work.trim() });
  const prodLines = (parsed.product || '').split('\n').map(s => s.trim()).filter(Boolean);
  const prodJpLines = (parsed.productJp || '').split('\n').map(s => s.trim()).filter(Boolean);
  // product/productJp 줄 수가 다르면 인덱스 기반 매칭이 엉뚱한 이름끼리 짝지어질 수 있어
  // 캐릭터 학습은 건너뛴다(작품명은 1:1이라 이 문제가 없어 그대로 진행).
  if (prodLines.length === prodJpLines.length) {
    prodLines.forEach((kr, i) => { const jp = prodJpLines[i]; if (jp) candidates.push({ kind: 'chars', jp, kr }); });
  }
  if (!candidates.length) return;

  const promoted = { works: {}, chars: {} };
  await updateGithubJsonFile({
    ...gh,
    path: 'insta-gen/learned-counts.json',
    defaultValue: { works: {}, chars: {} },
    message: 'insta-gen 학습 카운트 갱신',
    mutate: (counts) => {
      counts.works = counts.works || {}; counts.chars = counts.chars || {};
      for (const c of candidates) {
        const seen = counts[c.kind][c.jp]?.n || 0;
        counts[c.kind][c.jp] = { kr: c.kr, n: seen + 1 };
        if (seen + 1 === 2) promoted[c.kind][c.jp] = c.kr; // 반복 등장 2회째 → 승격
      }
      return counts;
    },
  });

  if (!Object.keys(promoted.works).length && !Object.keys(promoted.chars).length) return;

  await updateGithubJsonFile({
    ...gh,
    path: 'insta-gen/learned-dict.json',
    defaultValue: { works: {}, chars: {} },
    message: 'insta-gen 무료 사전 자동 학습 반영',
    mutate: (dict) => ({
      works: { ...dict.works, ...promoted.works },
      chars: { ...dict.chars, ...promoted.chars },
    }),
  });
}
