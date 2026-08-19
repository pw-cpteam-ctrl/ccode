// 작품(시리즈)의 한국 정식 제목을 팀 공용 사전에 저장하는 Vercel 서버리스 함수.
//
// 왜 저장하냐면: 한국 정식 제목은 번역으로 맞힐 수 있는 게 아니라 국내 판권사가 따로
// 정한 이름인 경우가 많다(しゅごキャラ! → 캐릭캐릭 체인지). 지금은 상품마다 사람이
// 검색해서 확인하고 그 답을 버리기 때문에, 같은 작품이 또 오면 또 검색하게 된다.
// 여기 저장해두면 그 작품은 다음부터 자동으로 맞는 표기가 채워진다.
//
// 저장 내용은 공개된 정식 제목뿐이라 민감정보가 아니다(고유명사 사전과 같은 성격).
// GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 없으면 동작하지 않는다.

import { readGithubFile, writeGithubFile } from '../lib/github.js';

const FILE_PATH = 'product-sns-formatter/data/work-titles.json';

function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/[\s　]+/g, ' ')
    .replace(/[!！?？.。,、:：;；~〜\-—–_'"“”‘’()（）[\]【】]/g, '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 환경변수가 설정되지 않았어요. 그동안 표기는 이 브라우저에만 저장돼요.' });
    return;
  }

  const { work, workJa, ko } = req.body || {};
  const koText = String(ko || '').trim();
  if (!koText) { res.status(400).json({ error: '저장할 한국 정식 제목이 비어 있어요.' }); return; }
  if (!String(work || '').trim() && !String(workJa || '').trim()) {
    res.status(400).json({ error: '어느 작품의 표기인지 알 수 있는 원문(영문 또는 일본어)이 필요해요.' });
    return;
  }
  // 사람이 손으로 넣는 값이라 길이만 상식선에서 막는다(실수로 원고를 통째로 붙여넣는 경우 방지).
  if (koText.length > 100) { res.status(400).json({ error: '한국 정식 제목이 너무 길어요(100자 이내).' }); return; }

  try {
    const existing = await readGithubFile({ token, owner, repo, branch, path: FILE_PATH });
    let entries = [];
    if (existing) {
      try { entries = JSON.parse(existing.content).entries || []; }
      catch { entries = []; } // 파일이 깨져 있어도 새로 쓰는 걸 막지 않는다
    }
    const entry = { work: String(work || '').trim(), workJa: String(workJa || '').trim(), ko: koText };
    // 같은 작품이면 새 값으로 갈아끼운다 — 표기가 바뀌었을 때 옛 값이 남아 충돌하지 않게.
    const keys = [normalizeKey(entry.work), normalizeKey(entry.workJa)].filter(Boolean);
    const kept = entries.filter(e => {
      const ek = [normalizeKey(e.work), normalizeKey(e.workJa)].filter(Boolean);
      return !ek.some(k => keys.includes(k));
    });
    kept.push(entry);
    kept.sort((a, b) => (a.ko || '').localeCompare(b.ko || '', 'ko'));

    const content = JSON.stringify({
      note: '작품(시리즈)의 한국 정식 제목 사전. 원고작성페이지에서 사람이 확인한 표기가 쌓인다.',
      updatedAt: new Date().toISOString(),
      entries: kept,
    }, null, 1);

    await writeGithubFile({
      token, owner, repo, branch, path: FILE_PATH, content,
      message: `작품명 정식표기 추가: ${entry.ko}`,
      sha: existing?.sha,
    });
    res.status(200).json({ ok: true, count: kept.length });
  } catch (err) {
    res.status(502).json({ error: `표기 저장 중 오류: ${err.message}` });
  }
}
