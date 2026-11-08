import { describe, expect, it } from "vitest";
import type { ProblemView } from "./quiz-problems";
import { type QuizTab, type QuizTabEvent, advanceQuizTab, startQuizTab } from "./quiz-tab";

const unitA = "unit-a";
const unitB = "unit-b";
const problem: ProblemView = {
  id: "66666666-6666-4666-8666-666666666666",
  format: "mcq",
  conceptId: "unit-a#1",
  conceptTitle: "GROUP BY",
  stem: "그룹 조건은 어디에 쓰나요?",
  hint: "그룹을 만든 뒤에 걸러요.",
  choices: ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
};

function run(tab: QuizTab, ...events: QuizTabEvent[]): QuizTab {
  return events.reduce(advanceQuizTab, tab);
}

describe("퀴즈 탭", () => {
  it("TC-174 퀴즈 탭에 처음 들어가면 열린 단원으로 문제 하나를 요청하고, 문제를 만드는 동안에는 더 요청하지 않아요", () => {
    const loading = run(startQuizTab(), { type: "enter", unitId: unitA });
    expect(loading).toMatchObject({ stage: "loading", unitId: unitA, number: 1 });

    expect(run(loading, { type: "enter", unitId: unitA })).toBe(loading);
  });

  it("TC-175 한 문제를 풀고 다음 문제로 넘어가면 카운트가 하나 늘고, 그때 열린 단원으로 다음 문제를 요청해요", () => {
    const shown = run(startQuizTab(), { type: "enter", unitId: unitA }, { type: "loaded", problem });
    expect(shown).toMatchObject({ stage: "problem", problem, number: 1 });

    const changed = run(shown, { type: "enter", unitId: unitB });
    expect(changed).toBe(shown);

    const next = run(changed, { type: "next", unitId: unitB });
    expect(next).toMatchObject({ stage: "loading", unitId: unitB, number: 2 });
  });
});
