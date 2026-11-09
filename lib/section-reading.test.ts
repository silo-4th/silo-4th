import { describe, expect, it } from "vitest";
import { dwellSeconds, hideDwell, readingSection, showDwell, startDwell } from "./section-reading";

describe("지금 읽는 절", () => {
  it("TC-95 본문 맨 아래에 닿으면 마지막 절을 본 절로 봐요", () => {
    const headingOffsets = [-900, -40, 260];

    expect(readingSection(headingOffsets, false)).toBe(1);
    expect(readingSection(headingOffsets, true)).toBe(2);
  });
});

describe("머문 시간", () => {
  it("TC-100 머문 시간은 탭이 숨겨진 동안을 빼고, 초 미만은 버리고, 1800초에서 잘라요", () => {
    const enteredAt = 1_000_000;

    const hidden = hideDwell(startDwell(enteredAt), enteredAt + 5_000);
    const shown = showDwell(hidden, enteredAt + 5_000 + 60_000);
    expect(dwellSeconds(shown, enteredAt + 5_000 + 60_000 + 7_900)).toBe(12);

    expect(dwellSeconds(startDwell(enteredAt), enteredAt + 40 * 60 * 1000)).toBe(1800);

    expect(dwellSeconds(startDwell(enteredAt), enteredAt + 400)).toBe(0);
  });
});
