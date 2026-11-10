export type ExamDateError = "required" | "invalid" | "past";
export type ExamDateResult = { ok: true; examDate: string } | { ok: false; error: ExamDateError };

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
// en-CA는 날짜를 `YYYY-MM-DD`로 적는다.
const koreanDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

// 시험 날짜의 오늘은 한국 시간 자정에 바뀐다. 새벽 4시 기준은 공부한 날짜를 저장할 때만 쓴다.
export function parseExamDate(value: string, now: Date): ExamDateResult {
  if (!value) return { ok: false, error: "required" };
  if (!isCalendarDate(value)) return { ok: false, error: "invalid" };
  // 같은 형식의 날짜 문자열은 사전순과 날짜순이 같다.
  if (value < koreanToday(now)) return { ok: false, error: "past" };
  return { ok: true, examDate: value };
}

export function koreanToday(now: Date) {
  return koreanDate.format(now);
}

// `2026-02-30`처럼 달력에 없는 날은 Date가 다음 달로 넘기므로, 되돌린 값이 같은지 본다.
function isCalendarDate(value: string) {
  if (!DATE_FORMAT.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
