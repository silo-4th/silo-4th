import { describe, expect, it } from "vitest";
import { gradeBlank, gradeChoice } from "./quiz-grading";

describe("퀴즈 채점", () => {
  it("TC-101 객관식은 고른 보기가 정답일 때만 맞다고 채점해요", () => {
    const answer = { choices: [{ text: "가" }, { text: "나" }, { text: "다" }, { text: "라" }], answerIndex: 2 };

    expect(gradeChoice(answer, 2)).toBe(true);
    expect(gradeChoice(answer, 0)).toBe(false);
  });

  it("TC-102 빈칸은 모든 공백과 대소문자를 무시하고 정답 후보와 비교해요", () => {
    const answer = { accepted: ["useState", "상태 훅"] };

    expect(gradeBlank(answer, "상태 훅")).toBe(true);
    expect(gradeBlank(answer, "상태훅")).toBe(true);
    expect(gradeBlank(answer, "  UseState  ")).toBe(true);
    expect(gradeBlank(answer, "use State")).toBe(true);
    expect(gradeBlank(answer, "useEffect")).toBe(false);
  });
});
