import { describe, expect, it } from "vitest";
import type { ProblemView } from "./quiz-problems";
import { type QuizTab, type QuizTabEvent, advanceQuizTab, gaugeFilled, settleProblem, startQuizTab } from "./quiz-tab";

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
  it("TC-174 퀴즈 홈에서 AI 맞춤 문제 풀기를 누르면 열린 단원으로 문제 하나를 요청하고, 문제를 만드는 동안에는 더 요청하지 않아요", () => {
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

describe("관련 문제", () => {
  const questionId = "77777777-7777-4777-8777-777777777777";
  const related: ProblemView = { ...problem, id: "88888888-8888-4888-8888-888888888888", stem: "HAVING은 언제 쓰나요?" };

  it("TC-189 문제를 풀던 중에 관련 문제를 부르면 카운트는 그대로 두고 그 질문으로 문제를 요청해요", () => {
    const second = run(startQuizTab(), { type: "enter", unitId: unitA }, { type: "loaded", problem }, { type: "next", unitId: unitA }, { type: "loaded", problem });
    expect(second).toMatchObject({ stage: "problem", number: 2 });

    const asked = run(second, { type: "related", questionId });
    expect(asked).toEqual({ stage: "loading", number: 2, questionId });

    expect(run(startQuizTab(), { type: "related", questionId })).toEqual({ stage: "loading", number: 1, questionId });
  });

  it("TC-190 관련 문제를 만들다 실패해 다시 시도하면 단원이 아니라 같은 질문으로 다시 요청해요", () => {
    const failed = run(startQuizTab(), { type: "related", questionId }, { type: "failed" });
    expect(failed).toMatchObject({ stage: "failed", number: 1 });

    expect(run(failed, { type: "retry" })).toEqual({ stage: "loading", number: 1, questionId });
  });

  it("TC-191 문제를 만드는 중에 관련 문제를 부르면 먼저 보낸 요청의 응답은 버리고 관련 문제만 띄워요", () => {
    const unitLoading = run(startQuizTab(), { type: "enter", unitId: unitA });
    const relatedLoading = run(unitLoading, { type: "related", questionId });
    expect(relatedLoading).toMatchObject({ stage: "loading", questionId });

    expect(settleProblem(relatedLoading, unitLoading, problem)).toBe(relatedLoading);
    expect(settleProblem(relatedLoading, unitLoading, undefined)).toBe(relatedLoading);

    expect(settleProblem(relatedLoading, relatedLoading, related)).toEqual({ stage: "problem", number: 1, problem: related });
  });
});

describe("이어 풀기", () => {
  it("TC-199 기억해 둔 문제를 다시 불러오지 못하면 같은 카운트로 열린 단원의 새 문제를 만들어요", () => {
    const resuming = run(startQuizTab(), { type: "enter", unitId: unitA, saved: { problemId: problem.id, number: 3 } });
    expect(resuming).toMatchObject({ stage: "resuming", number: 3, problemId: problem.id });

    expect(run(resuming, { type: "failed" })).toEqual({ stage: "loading", number: 3, unitId: unitA });
  });

  it("TC-217 진행 게이지는 지금 문제 번호와 채점 여부로 채운 칸 수를 정하고 세 칸을 넘지 않아요", () => {
    expect(gaugeFilled(1, false)).toBe(0);
    expect(gaugeFilled(2, true)).toBe(2);
    expect(gaugeFilled(5, false)).toBe(3);
  });
});
