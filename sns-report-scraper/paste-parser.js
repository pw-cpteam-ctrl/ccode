/**
 * 트위터 게시물 상세페이지를 전체 복사(Ctrl+A류)했을 때 나오는 텍스트를 그대로 붙여넣으면
 * 본문/게시 시각/지표(좋아요·리트윗)를 뽑아내는 파서. 리포트의 "붙여넣기로 게시물 추가"
 * 기능(html-report.js)이 브라우저 안에서 그대로 쓰기 때문에, matching-core.js와 마찬가지로
 * Node 전용 API를 함수 몸통 안에서 쓰면 안 됨.
 *
 * 실제 사용자가 복사한 텍스트로 확인한 형태(순서 고정):
 *   [본문 여러 줄 — 상품 설명/링크/해시태그/"이미지" 플레이스홀더 포함]
 *   오후 1:01 · 2026년 7월 16일     ← 게시 시각(오전/오후 12시간제)
 *   ·
 *   5.4만
 *    조회수
 *   (빈 줄)
 *   1        ← 답글 수
 *   (빈 줄)
 *   445      ← 리트윗
 *   (빈 줄)
 *   373      ← 좋아요
 *   (빈 줄)
 *   218      ← 북마크
 *   이 게시물에 답글을 달 수 있습니다.
 *   ...
 * "조회수" 줄 다음에 나오는 숫자를 순서대로(답글→리트윗→좋아요→북마크) 읽음 — 지금 이
 * 도구는 좋아요/리트윗만 쓰므로 나머지 둘은 참고용으로만 반환.
 */

// matching-core.js의 parseCount와 이름이 겹치면(둘 다 리포트의 같은 <script> 안에 이어붙여
// 넣어짐) 재선언 충돌이 나서, 이 파일 전용으로 이름을 다르게 둠(로직은 단순 숫자+만/천
// 표기만 다루므로 굳이 공유 안 해도 됨).
function parsePastedCount(raw) {
  const t = (raw || '').trim();
  const m = t.match(/^([\d,]+(?:\.\d+)?)\s*(만|천)?$/);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(base)) return null;
  if (m[2] === '만') return Math.round(base * 10000);
  if (m[2] === '천') return Math.round(base * 1000);
  return Math.round(base);
}

const TIMESTAMP_RE = /^(오전|오후)\s*(\d{1,2}):(\d{2})\s*·\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;

// "오후 1:01 · 2026년 7월 16일"(KST, 12시간제) → UTC ISO 문자열. 트위터/인스타 원본
// datetime과 형식을 맞춰야 나머지 파이프라인(formatKstTime 등)이 그대로 재사용됨.
function parseKstTimestampToIso(line) {
  const m = TIMESTAMP_RE.exec((line || '').trim());
  if (!m) return null;
  const [, ampm, hh, mm, year, month, day] = m;
  let hour = parseInt(hh, 10) % 12;
  if (ampm === '오후') hour += 12;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
    `T${String(hour).padStart(2, '0')}:${mm}:00+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// "이미지" 줄은 사진 첨부 표시일 뿐 상품명과 무관한데, 지우지 않으면 사진 여러 장 붙은
// 게시물끼리 이 단어 하나로 우연히 묶이는(오묶음) 위험이 있음 — matching-core.js의
// GENERIC_KEYWORDS에도 같은 이유로 추가돼 있지만, 본문 자체에서도 미리 걷어냄.
function stripPastedNoise(lines) {
  return lines.filter(line => line.trim() !== '이미지');
}

/**
 * @param {string} rawText 붙여넣은 원문 그대로
 * @returns {{ok:true, text:string, datetime:string, replies:number|null, retweets:number|null,
 *            likes:number|null, bookmarks:number|null} | {ok:false, error:string, text?:string, datetime?:string}}
 */
function parsePastedPost(rawText) {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const tsIndex = lines.findIndex(l => TIMESTAMP_RE.test(l.trim()));
  if (tsIndex === -1) {
    return { ok: false, error: '게시 시각 줄("오후 1:01 · 2026년 7월 16일" 같은 형태)을 못 찾았습니다 — 게시물 상세페이지에서 전체 복사했는지 확인해주세요.' };
  }

  const bodyLines = stripPastedNoise(lines.slice(0, tsIndex).map(l => l.trim()));
  const text = bodyLines.join('\n').replace(/^\n+|\n+$/g, '');

  const datetime = parseKstTimestampToIso(lines[tsIndex]);
  if (!datetime) {
    return { ok: false, error: '게시 시각을 이해하지 못했습니다.', text };
  }

  const viewsIndex = lines.findIndex((l, i) => i > tsIndex && l.includes('조회수'));
  if (viewsIndex === -1) {
    return {
      ok: false,
      error: '"조회수" 줄을 못 찾아서 좋아요/리트윗 숫자를 못 뽑았습니다 — 숫자를 직접 입력해주세요.',
      text, datetime,
    };
  }

  const counts = [];
  for (let i = viewsIndex + 1; i < lines.length && counts.length < 4; i++) {
    const t = lines[i].trim();
    if (t === '') continue;
    if (!/^[\d,]+(?:\.\d+)?\s*(만|천)?$/.test(t)) break; // 숫자 형태가 아니면 지표 구간 끝
    counts.push(parsePastedCount(t));
  }
  if (counts.length < 4) {
    return {
      ok: false,
      error: `지표 숫자 4개(답글·리트윗·좋아요·북마크 순)를 다 못 찾았습니다(찾은 개수: ${counts.length}) — 숫자를 직접 입력해주세요.`,
      text, datetime,
    };
  }

  const [replies, retweets, likes, bookmarks] = counts;
  return { ok: true, text, datetime, replies, retweets, likes, bookmarks };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parsePastedPost, parseKstTimestampToIso, stripPastedNoise, parsePastedCount };
}
