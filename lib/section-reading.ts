// 학습 화면이 지금 읽는 절과 그 절에 머문 시간을 정한다. 브라우저와 서버가 함께 쓴다.

// 구간 탭 맨 앞의 인트로는 첫 절 앞 본문이고, 그 주소 키다.
export const INTRO_KEY = "intro";

// 한 번 보내는 머문 시간의 상한이다. 탭을 열어 둔 채 자리를 비운 시간이 분석을 흐리지 않게 자른다.
export const MAX_DWELL_SEC = 1800;

// 소제목 위치는 소수 픽셀로 나와, 절 주소로 맞춘 소제목도 기준선보다 조금 아래에 놓일 수 있다.
const REACH_TOLERANCE_PX = 1;

// 소제목마다 기준선에서 떨어진 거리를 받는다. 기준선에 닿았거나 지난 마지막 소제목의 절을 읽는 중으로 본다.
// 마지막 절은 본문이 짧아 소제목이 기준선까지 올라오지 못할 수 있어, 맨 아래에 닿으면 마지막 절로 본다.
export function readingSection(headingOffsets: readonly number[], atBottom: boolean): number | undefined {
  if (atBottom && headingOffsets.length > 0) return headingOffsets.length - 1;
  const index = headingOffsets.findLastIndex((offset) => offset <= REACH_TOLERANCE_PX);
  return index === -1 ? undefined : index;
}

// 탭이 보이는 동안만 쌓는다. `visibleSince`가 비어 있으면 탭이 숨겨진 상태다.
export type DwellClock = { visibleMs: number; visibleSince: number | null };

export function startDwell(now: number, visible = true): DwellClock {
  return { visibleMs: 0, visibleSince: visible ? now : null };
}

export function hideDwell(clock: DwellClock, now: number): DwellClock {
  return { visibleMs: visibleMs(clock, now), visibleSince: null };
}

export function showDwell(clock: DwellClock, now: number): DwellClock {
  return clock.visibleSince === null ? { ...clock, visibleSince: now } : clock;
}

export function dwellSeconds(clock: DwellClock, now: number): number {
  return Math.min(MAX_DWELL_SEC, Math.floor(visibleMs(clock, now) / 1000));
}

function visibleMs({ visibleMs, visibleSince }: DwellClock, now: number) {
  return visibleSince === null ? visibleMs : visibleMs + Math.max(0, now - visibleSince);
}
