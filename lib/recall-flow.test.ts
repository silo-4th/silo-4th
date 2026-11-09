import { describe, expect, it } from "vitest";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { type RecallFlow, advanceRecall, entryOf, progressOf, startRecall } from "@/lib/recall-flow";
import type { RecallSetView } from "@/lib/recall-sets";

type Reason = RecallSetView["items"][number]["reason"];

function item(position: number, reason: Reason): RecallSetView["items"][number] {
  return {
    id: `item-${position}`,
    position,
    reason,
    problem: {
      id: `problem-${position}`,
      format: "mcq",
      conceptId: `concept-${position}`,
      conceptTitle: `개념 ${position}`,
      stem: `문제 ${position}`,
      hint: "힌트",
      choices: ["가", "나", "다", "라"],
    },
  };
}

function setOf(...reasons: Reason[]): RecallSetView {
  return { id: "set-1", items: reasons.map((reason, index) => item(index + 1, reason)) };
}

function submitted(problemId: string): AttemptInput {
  return {
    attemptId: `attempt-${problemId}`,
    problemId,
    chosenIndex: 1,
    answerText: null,
    confidence: "sure",
    hintUsed: false,
    dontKnow: false,
  };
}

const graded: AttemptResult = {
  outcome: "graded",
  isCorrect: true,
  answer: { choices: [{ text: "가" }, { text: "나" }, { text: "다" }, { text: "라" }], answerIndex: 1 },
  explanation: "해설",
};

describe("꺼내 먹기 흐름", () => {
  it("TC-200 꺼내 먹기를 시작하면 문항을 차례로 넘기고, 마지막 문항 뒤 결과 단계로 넘어가며 문항별 답과 건너뜀을 모아 둬요", () => {
    const entry = startRecall(setOf("read_no_question", "read_no_question", "asked"));
    expect(entry.stage).toBe("entry");

    const first = advanceRecall(entry, { type: "start" });
    expect(first.stage).toBe("problem");
    expect(progressOf(first)).toBe("1 / 3");

    const second = advanceRecall(first, { type: "answered", submitted: submitted("problem-1"), result: graded });
    expect(second.stage).toBe("problem");
    expect(progressOf(second)).toBe("2 / 3");

    const third = advanceRecall(second, { type: "skip" });
    expect(third.stage).toBe("problem");
    expect(progressOf(third)).toBe("3 / 3");

    const result = advanceRecall(third, { type: "answered", submitted: submitted("problem-3"), result: graded });
    expect(result.stage).toBe("result");
    if (result.stage !== "result") throw new Error("결과 단계여야 한다.");
    expect(result.answers).toEqual([
      { itemId: "item-1", kind: "answered", submitted: submitted("problem-1"), result: graded },
      { itemId: "item-2", kind: "skipped" },
      { itemId: "item-3", kind: "answered", submitted: submitted("problem-3"), result: graded },
    ]);

    const events: Parameters<typeof advanceRecall>[1][] = [
      { type: "start" },
      { type: "skip" },
      { type: "answered", submitted: submitted("problem-1"), result: graded },
    ];
    for (const event of events) {
      expect(advanceRecall(result, event)).toBe<RecallFlow>(result);
    }
  });
});

describe("꺼내 먹기 입구", () => {
  it("TC-201 꺼내 먹기 입구 목록은 질문 없이 넘어간 절을 넘어감으로, 질문한 절과 퀴즈를 푼 절을 물어봄으로 보여 주고 이유별 개수를 요약해요", () => {
    const first = entryOf(setOf("read_no_question", "asked", "read_no_question").items);
    expect(first.rows.filter((row) => row.reason === "넘어감")).toHaveLength(2);
    expect(first.rows.filter((row) => row.reason === "물어봄")).toHaveLength(1);
    expect(first.rows.find((row) => row.conceptTitle === "개념 2")?.reason).toBe("물어봄");
    expect(first.summary).toBe("질문 없이 넘어간 2개, 물어본 1개예요");

    const second = entryOf(setOf("read_no_question", "quiz").items);
    expect(second.rows.find((row) => row.conceptTitle === "개념 2")?.reason).toBe("물어봄");
    expect(second.summary).toBe("질문 없이 넘어간 1개, 물어본 1개예요");

    expect(entryOf(setOf("read_no_question").items).summary).toBe("질문 없이 넘어간 1개예요");
    expect(entryOf(setOf("asked", "quiz").items).summary).toBe("물어본 2개예요");
  });
});
