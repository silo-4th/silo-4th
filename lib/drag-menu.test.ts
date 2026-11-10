import { describe, expect, it } from "vitest";
import { placeDragMenu, selectionQuestion } from "./drag-menu";

describe("드래그한 글", () => {
  it("TC-264 드래그한 글이 절 안에서 2자 이상일 때만 질문할 문장으로 잡고, 1500자까지 잘라요", () => {
    const section = { conceptId: "unit-1" };

    expect(selectionQuestion("  가 \n", section)).toBeUndefined();
    expect(selectionQuestion("  가나 \n", section)).toEqual({ text: "가나", conceptId: "unit-1" });

    expect(selectionQuestion("절 밖의 문장", undefined)).toBeUndefined();

    const long = "가".repeat(1500) + "나";
    expect(selectionQuestion(long, section)).toEqual({ text: "가".repeat(1500), conceptId: "unit-1" });
  });
});

describe("드래그 메뉴 위치", () => {
  it("TC-265 드래그 메뉴는 선택한 곳 위에 뜨고, 위쪽 공간이 모자라면 아래로 내려가요", () => {
    const view = { width: 800, scrollTop: 1000, tocHeight: 44 };
    const menu = { width: 240, height: 40 };

    const roomy = { left: 300, right: 500, top: 1300, bottom: 1320 };
    const above = placeDragMenu({ view, menu, selection: roomy });
    expect(above.top + menu.height).toBeLessThanOrEqual(roomy.top);
    expect(above.top).toBeGreaterThanOrEqual(view.scrollTop + view.tocHeight);
    expect(above.left + menu.width / 2).toBe((roomy.left + roomy.right) / 2);

    const underToc = { left: 300, right: 500, top: 1060, bottom: 1080 };
    const below = placeDragMenu({ view, menu, selection: underToc });
    expect(below.top).toBeGreaterThanOrEqual(underToc.bottom);
    expect(below.left + menu.width / 2).toBe((underToc.left + underToc.right) / 2);

    for (const edge of [
      { left: 0, right: 40, top: 1300, bottom: 1320 },
      { left: 760, right: 800, top: 1300, bottom: 1320 },
    ]) {
      const placed = placeDragMenu({ view, menu, selection: edge });
      expect(placed.left).toBeGreaterThanOrEqual(0);
      expect(placed.left + menu.width).toBeLessThanOrEqual(view.width);
    }
  });
});
