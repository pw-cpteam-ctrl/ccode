/**
 * "어떤 날짜분 상품을 받을지" 정하는 순수 로직 (브라우저/시계와 분리).
 *
 * 왜 시계(new Date())로 정하지 않는가:
 *   GoodSmile B2B는 전날 18시경에 다음날 발표분을 미리 공개한다. 그래서 "PC 시계의 오늘"을
 *   기준으로 잡으면 19시에 돌렸을 때 이미 올라온 내일 상품을 통째로 놓친다. 반대로 "18시
 *   넘으면 내일로 치기"처럼 시계로 추측하면 공개가 늦어진 날엔 없는 날짜를 찾아 0건이 된다.
 *   그래서 시계가 아니라 **사이트에 실제로 올라와 있는 발표일 목록**을 기준으로 고른다.
 *
 * 발표일은 상품 카드에 이미 데이터로 박혀있다:
 *   <li class="p-top__products__item" data-guidance_date="20260730">
 */

// '20260730' / '2026-07-30' / '2026/07/30' / '2026.07.30' → '20260730' (못 알아들으면 null)
function normalizeDateArg(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

// '20260730' → '2026-07-30' (결과 폴더 이름용 — 기존 폴더명 형식을 그대로 유지)
function toFolderName(yyyymmdd) {
  const d = normalizeDateArg(yyyymmdd);
  if (!d) return String(yyyymmdd || '');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// '20260730' → '2026년 7월 30일' (사람에게 보여주는 문구용)
function formatDateLabel(yyyymmdd) {
  const d = normalizeDateArg(yyyymmdd);
  if (!d) return String(yyyymmdd || '');
  return `${d.slice(0, 4)}년 ${Number(d.slice(4, 6))}월 ${Number(d.slice(6, 8))}일`;
}

// [{ date, url }, ...] → [{ date, urls: [...] }, ...] (최신 날짜가 앞으로, 중복 URL 제거)
function groupByDate(items) {
  const byDate = new Map();
  for (const { date, url } of items || []) {
    if (!normalizeDateArg(date) || !url) continue;
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date).add(url);
  }
  return [...byDate.entries()]
    .map(([date, urls]) => ({ date, urls: [...urls] }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// 콘솔에 보여줄 "고를 수 있는 날짜" 목록 문구
function dateOptionsText(dateOptions) {
  return dateOptions
    .map((o, i) => `  ${i + 1}) ${formatDateLabel(o.date)} — ${o.urls.length}건${i === 0 ? '   ← 가장 최신' : ''}`)
    .join('\n');
}

/**
 * dateOptions: groupByDate()의 결과
 * requestedRaw: 사용자가 직접 지정한 날짜(없으면 자동 = 가장 최신)
 * 반환: { ok: true, date, urls, reason } 또는 { ok: false, message }
 */
function resolveTargetDate(dateOptions, requestedRaw) {
  if (!dateOptions || !dateOptions.length) {
    return {
      ok: false,
      message:
        '사이트 첫 화면에서 상품을 하나도 찾지 못했어요.\n' +
        '로그인이 풀렸거나 사이트 화면 구조가 바뀐 경우일 수 있어요.\n' +
        '이 화면을 그대로 캡처해서 담당자에게 보내주세요.',
    };
  }

  if (!requestedRaw) {
    const newest = dateOptions[0];
    return { ok: true, date: newest.date, urls: newest.urls, reason: '사이트에 올라온 가장 최신 발표일' };
  }

  const wanted = normalizeDateArg(requestedRaw);
  if (!wanted) {
    return {
      ok: false,
      message:
        `날짜를 못 알아들었어요: "${requestedRaw}"\n` +
        '2026년 7월 30일이면 20260730 처럼 숫자 8자리로 적어주세요.\n\n' +
        '지금 받을 수 있는 날짜:\n' + dateOptionsText(dateOptions),
    };
  }

  const hit = dateOptions.find(o => o.date === wanted);
  if (!hit) {
    return {
      ok: false,
      message:
        `${formatDateLabel(wanted)} 상품은 지금 사이트 첫 화면에 없어요.\n` +
        '(아직 공개되지 않은 날짜이거나, 너무 오래돼서 첫 화면에서 밀려난 날짜예요)\n\n' +
        '지금 받을 수 있는 날짜:\n' + dateOptionsText(dateOptions),
    };
  }

  return { ok: true, date: hit.date, urls: hit.urls, reason: '직접 지정한 날짜' };
}

module.exports = { normalizeDateArg, toFolderName, formatDateLabel, groupByDate, dateOptionsText, resolveTargetDate };
