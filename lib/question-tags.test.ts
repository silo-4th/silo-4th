import { describe, expect, it } from "vitest";
import { knownConceptIds, normalizeKeywords } from "./question-tags";

describe("질문 분류 결과 정리", () => {
  it("TC-66 분류 결과에서 개념 목록에 있는 ID만 남기고 중복을 없애요", () => {
    const concepts = ["C1", "C2", "C3"];

    expect(knownConceptIds(["C1", "C9", "C1", "C2"], concepts)).toEqual(["C1", "C2"]);
    expect(knownConceptIds([], concepts)).toEqual([]);
  });

  it("TC-70 키워드를 소문자로 맞추고 앞뒤 공백과 중복을 없애요", () => {
    expect(normalizeKeywords([" SQL ", "sql", "Index", " 인덱스 ", "인덱스", ""])).toEqual(["sql", "index", "인덱스"]);
  });
});
