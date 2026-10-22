// 서버 자동 가져오기를 '인플 응대를 하는 기간'에만 돌리기 위한 날짜 계산.
// 운영 기간 = 스토어 오픈일 D-7 ~ D+5. 그 밖은 쉬는 기간이라 자동으로 가져오지 않는다(버튼으로는 가져올 수 있다).
// 오픈일은 보드와 같은 규칙으로 구한다: ① 저장된 값(creator-logs/open-days.json) ② 아래 예외 ③ 그 달 첫 목요일.
// 화면 쪽 계산은 index.html의 mailWindowInfo() — 두 곳의 규칙(기간 7일 전/5일 후, 예외 목록)은 같아야 한다.

export const WINDOW_BEFORE = 7;
export const WINDOW_AFTER = 5;
// 첫 목요일이 아닌 달. 같은 값: index.html의 OPEN_DAY_FALLBACK, creator-guide(finalOption.jsx)
const OPEN_DAY_FALLBACK = { '2026-09': 10, '2026-10': 8 };

function firstThursday(y, m) {   // m은 1부터
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((4 - dow + 7) % 7);
}

// 그 달 오픈일의 UTC 자정 시각(ms)
function openTime(openDays, y, m) {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((m - 1) % 12 + 12) % 12 + 1;
  const key = `${yy}-${String(mm).padStart(2, '0')}`;
  let day = openDays && openDays[key];
  if (day == null) day = OPEN_DAY_FALLBACK[key];
  if (day == null) day = firstThursday(yy, mm);
  return Date.UTC(yy, mm - 1, Number(day));
}

// now: Date. 한국 날짜 기준으로 오늘이 운영 기간 안인지 본다. { on, start, end } (start/end는 해당 운영 기간의 날짜 ms)
export function operatingWindow(now, openDays) {
  const kst = new Date(now.getTime() + 9 * 36e5);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1;
  const today = Date.UTC(y, m - 1, kst.getUTCDate());
  for (const mm of [m - 1, m, m + 1]) {
    const open = openTime(openDays, y, mm);
    const start = open - WINDOW_BEFORE * 864e5, end = open + WINDOW_AFTER * 864e5;
    if (today >= start && today <= end) return { on: true, start, end };
  }
  return { on: false };
}
