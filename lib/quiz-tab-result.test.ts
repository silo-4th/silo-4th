import { describe, expect, it } from "vitest";
import type { Solved } from "./quiz-card";
import type { ProblemView } from "./quiz-problems";
import { type QuizSet, type QuizSetEvent, advanceQuizSet, setGuide, setTitle, startQuizSet } from "./quiz-tab";

const unitA = "unit-a";

function problemOf(position: number, conceptTitle = "GROUP BY"): ProblemView {
  return {
    id: `00000000-0000-4000-8000-00000000000${position}`,
    format: "mcq",
    conceptId: `unit-a#${position}`,
    conceptTitle,
    stem: `문제 ${position}`,
    hint: "힌트",
    choices: ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
  };
}

type Confidence = "sure" | "unsure" | "guess";

function solved(isCorrect: boolean | undefined, confidence: Confidence = "sure"): Solved {
  const submitted = {
    attemptId: "attempt",
    problemId: "problem",
    chosenIndex: 1,
    answerText: null,
    confidence,
    hintUsed: false,
    dontKnow: false,
  };
  if (isCorrect === undefined) return { submitted };
  return { submitted, result: { outcome: "graded", isCorrect, answer: { modelAnswer: "HAVING", keyPoints: [] }, explanation: "해설" } };
}

function run(set: QuizSet, ...events: QuizSetEvent[]): QuizSet {
  return events.reduce(advanceQuizSet, set);
}

// 채점을 받으면 graded가 오고, 다음으로 넘길 때 낸 답을 함께 보낸다. 채점을 받지 못한 답은 graded 없이 넘긴다.
function solve(set: QuizSet, problem: ProblemView, answer: Solved): QuizSet {
  const shown = run(set, { type: "loaded", problem });
  const graded = answer.result ? run(shown, { type: "graded", solved: answer }) : shown;
  return run(graded, { type: "next", unitId: unitA, solved: answer });
}

function solveSet(...answers: Solved[]): QuizSet {
  return answers.reduce(
    (set, answer, index) => solve(set, problemOf(index + 1), answer),
    run(startQuizSet(), { type: "enter", unitId: unitA }),
  );
}

describe("퀴즈 탭 결과", () => {
  it("TC-243 퀴즈 탭 결과 제목은 모두 틀림, 일부 틀림, 다 맞혔지만 헷갈림, 모두 확실하게 맞힘에 따라 네 가지 중 하나를 골라요", () => {
    expect(setTitle(solveSet(solved(false), solved(false), solved(false)).results)).toBe("3개 모두 틀렸어요");
    expect(setTitle(solveSet(solved(true), solved(false), solved(true)).results)).toBe("3개 중 1개를 틀렸어요");
    expect(setTitle(solveSet(solved(true), solved(true, "guess"), solved(true)).results)).toBe("3개 다 맞혔지만 1개는 헷갈렸어요");
    expect(setTitle(solveSet(solved(true), solved(true), solved(true)).results)).toBe("3개 모두 맞혔어요");
  });

  it("TC-244 퀴즈 탭 결과 안내는 헷갈리거나 틀린 문제가 있을 때만 본문을 다시 읽어 보라고 권해요", () => {
    expect(setGuide(solveSet(solved(true, "unsure"), solved(true), solved(true)).results)).toBe(
      "헷갈리거나 틀린 개념은 본문에서 한 번 더 읽어 보면 좋아요.",
    );
    expect(setGuide(solveSet(solved(true), solved(true), solved(true)).results)).toBe("이 흐름 그대로 다음 단원으로 가도 좋아요.");
  });

  it("TC-245 세 번째 문제를 풀고 넘기면 다음 문제를 요청하지 않고 결과 단계로 가며, 묶음에서 푼 문제마다 칩을 푼 순서대로 담아요", () => {
    const entered = run(startQuizSet(), { type: "enter", unitId: unitA });
    const afterFirst = solve(entered, problemOf(1), solved(true, "sure"));
    expect(afterFirst.tab).toMatchObject({ stage: "loading", number: 2, unitId: unitA });
    const afterSecond = solve(afterFirst, problemOf(2), solved(true, "guess"));
    expect(afterSecond.tab).toMatchObject({ stage: "loading", number: 3, unitId: unitA });
    const afterThird = solve(afterSecond, problemOf(3), solved(false));
    expect(afterThird.tab).toEqual({ stage: "result" });
    expect(afterThird.results.map((slot) => slot?.chip)).toEqual(["맞혔어요", "맞았지만 헷갈렸어요", "틀렸어요"]);

    const ungraded = solveSet(solved(true), solved(true), solved(undefined));
    expect(ungraded.tab).toEqual({ stage: "result" });
    expect(ungraded.results.map((slot) => slot?.chip)).toEqual(["맞혔어요", "맞혔어요", "채점하지 못했어요"]);
  });

  it("TC-246 묶음을 푸는 중에 관련 문제를 풀면 카운트는 그대로 두고, 결과에는 교체된 문제 대신 관련 문제를 담아요", () => {
    const afterFirst = solve(run(startQuizSet(), { type: "enter", unitId: unitA }), problemOf(1, "첫 개념"), solved(true));
    const second = run(afterFirst, { type: "loaded", problem: problemOf(2, "둘째 개념") }, { type: "graded", solved: solved(false) });

    const asked = run(second, { type: "related", questionId: "question-1" });
    expect(asked.tab).toMatchObject({ stage: "loading", number: 2, questionId: "question-1" });

    const afterRelated = solve(asked, problemOf(4, "관련 개념"), solved(true));
    expect(afterRelated.tab).toMatchObject({ stage: "loading", number: 3, unitId: unitA });

    const done = solve(afterRelated, problemOf(3, "셋째 개념"), solved(true));
    expect(done.tab).toEqual({ stage: "result" });
    expect(done.results.map((slot) => slot?.conceptTitle)).toEqual(["첫 개념", "관련 개념", "셋째 개념"]);
  });

  it("TC-247 마지막 문제를 채점받고 새로고침해 이미 푼 문제로 확인되면 다음 문제 대신 결과 단계로 가고, 묶음에서 푼 세 문제의 칩이 모두 담겨요", () => {
    const beforeReload = solve(solve(run(startQuizSet(), { type: "enter", unitId: unitA }), problemOf(1), solved(true)), problemOf(2), solved(false));
    const graded = run(beforeReload, { type: "loaded", problem: problemOf(3) }, { type: "graded", solved: solved(true, "unsure") });
    const saved = { problemId: problemOf(3).id, number: 3, results: graded.results };

    const resuming = run(startQuizSet(), { type: "enter", unitId: unitA, saved });
    expect(resuming.tab).toMatchObject({ stage: "resuming", number: 3 });

    const reopened = run(resuming, { type: "solved" });
    expect(reopened.tab).toEqual({ stage: "result" });
    expect(reopened.results.map((slot) => slot?.chip)).toEqual(["맞혔어요", "틀렸어요", "맞았지만 헷갈렸어요"]);
  });
});
