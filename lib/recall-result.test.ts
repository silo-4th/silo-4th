import { describe, expect, it } from "vitest";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import type { RecallAnswer } from "@/lib/recall-flow";
import { resultCards, resultSubtitle, resultTitle } from "@/lib/recall-result";
import type { RecallSetView } from "@/lib/recall-sets";

type Confidence = "sure" | "unsure" | "guess";
type Outcome =
  | { kind: "correct"; confidence: Confidence }
  | { kind: "wrong"; confidence?: Confidence; myAnswer?: string; correctAnswer?: string }
  | { kind: "dontKnow" }
  | { kind: "skipped" }
  | { kind: "ungraded" }
  | { kind: "noResult" };

function item(position: number): RecallSetView["items"][number] {
  return {
    id: `item-${position}`,
    position,
    reason: "asked",
    problem: {
      id: `problem-${position}`,
      format: "free",
      conceptId: `unit-${position}`,
      conceptTitle: `개념 ${position}`,
      stem: `문제 ${position}`,
      hint: "힌트",
    },
    section: { unitId: "unit", key: `section-${position}` },
  };
}

function submitted(position: number, answerText: string | null, confidence: Confidence | null, dontKnow = false): AttemptInput {
  return {
    attemptId: `attempt-${position}`,
    problemId: `problem-${position}`,
    recallItemId: `item-${position}`,
    chosenIndex: null,
    answerText,
    confidence,
    hintUsed: false,
    dontKnow,
  };
}

function result(isCorrect: boolean | null, modelAnswer = "모범 답안"): AttemptResult {
  const answer = { modelAnswer, keyPoints: [] };
  return isCorrect === null
    ? { outcome: "ungraded", answer, explanation: "해설" }
    : { outcome: "graded", isCorrect, answer, explanation: "해설" };
}

function answerOf(position: number, outcome: Outcome): RecallAnswer {
  const itemId = `item-${position}`;
  switch (outcome.kind) {
    case "correct":
      return { itemId, kind: "answered", submitted: submitted(position, "모범 답안", outcome.confidence), result: result(true) };
    case "wrong":
      return {
        itemId,
        kind: "answered",
        submitted: submitted(position, outcome.myAnswer ?? "틀린 답", outcome.confidence ?? "sure"),
        result: result(false, outcome.correctAnswer),
      };
    case "dontKnow":
      return { itemId, kind: "answered", submitted: submitted(position, null, null, true), result: result(false) };
    case "skipped":
      return { itemId, kind: "skipped" };
    case "ungraded":
      return { itemId, kind: "answered", submitted: submitted(position, "서술한 답", "sure"), result: result(null) };
    case "noResult":
      return { itemId, kind: "answered", submitted: submitted(position, "서술한 답", "sure") };
  }
}

function cardsOf(...outcomes: Outcome[]) {
  const set: RecallSetView = { id: "set-1", items: outcomes.map((_, index) => item(index + 1)) };
  return resultCards(
    set,
    outcomes.map((outcome, index) => answerOf(index + 1, outcome)),
  );
}

describe("꺼내 먹기 결과", () => {
  it("TC-220 꺼내 먹기 결과 제목은 틀린 문항, 헷갈린 문항, 채점하지 못한 문항 수에 따라 네 가지 중 하나를 골라요", () => {
    const a = cardsOf(
      { kind: "correct", confidence: "sure" },
      { kind: "wrong" },
      { kind: "skipped" },
      { kind: "dontKnow" },
      { kind: "ungraded" },
    );
    const b = cardsOf(
      { kind: "correct", confidence: "sure" },
      { kind: "correct", confidence: "unsure" },
      { kind: "correct", confidence: "guess" },
      { kind: "ungraded" },
    );
    const c = cardsOf({ kind: "correct", confidence: "sure" }, { kind: "correct", confidence: "sure" }, { kind: "ungraded" });
    const d = cardsOf({ kind: "ungraded" }, { kind: "noResult" });

    expect(resultTitle(a)).toBe("4개 중 3개를 틀렸어요");
    expect(resultTitle(b)).toBe("3개 다 맞혔지만 2개는 헷갈렸어요");
    expect(resultTitle(c)).toBe("2개 모두 맞혔어요");
    expect(resultTitle(d)).toBe("꺼내 먹기를 마쳤어요");
  });

  it("TC-221 꺼내 먹기 결과 부제는 헷갈렸거나 틀린 문항이 있을 때만 다시 볼 곳을 알려 준다고 하고, 채점하지 못한 문항은 세지 않아요", () => {
    const a = cardsOf({ kind: "correct", confidence: "sure" }, { kind: "correct", confidence: "unsure" });
    const b = cardsOf({ kind: "correct", confidence: "sure" }, { kind: "skipped" });
    const c = cardsOf({ kind: "correct", confidence: "sure" }, { kind: "ungraded" });

    const review = "잘 기억한 건 넘어가고, 다른 건 다시 볼 곳을 알려줄게요.";
    expect(resultSubtitle(a)).toBe(review);
    expect(resultSubtitle(b)).toBe(review);
    expect(resultSubtitle(c)).toBe("오늘은 새로운 내용으로 넘어가도 좋아요.");
  });

  it("TC-222 문항 카드의 칩은 맞힘과 확신도, 건너뜀, 채점 여부에 따라 정해지고, 맞혔어요가 아닌 카드에만 공부하러 가기가 있어요", () => {
    const cards = cardsOf(
      { kind: "correct", confidence: "sure" },
      { kind: "correct", confidence: "unsure" },
      { kind: "correct", confidence: "guess" },
      { kind: "wrong" },
      { kind: "skipped" },
      { kind: "dontKnow" },
      { kind: "ungraded" },
      { kind: "noResult" },
    );

    expect(cards.map((card) => card.chip)).toEqual([
      "맞혔어요",
      "맞았지만 헷갈렸어요",
      "맞았지만 헷갈렸어요",
      "틀렸어요",
      "틀렸어요",
      "틀렸어요",
      "채점하지 못했어요",
      "채점하지 못했어요",
    ]);
    expect(cards.map((card) => card.studyLink)).toEqual([false, true, true, true, true, true, true, true]);
  });

  it("TC-223 문항 카드는 맞히면 해설만, 틀리면 내 답과 정답과 해설을, 건너뛰면 내 답을 건너뛰었어요로, 채점하지 못하면 받은 만큼 보여 줘요", () => {
    const [correct, wrong, dontKnow, ungraded, skipped, noResult] = cardsOf(
      { kind: "correct", confidence: "sure" },
      { kind: "wrong" },
      { kind: "dontKnow" },
      { kind: "ungraded" },
      { kind: "skipped" },
      { kind: "noResult" },
    );

    expect(correct).toMatchObject({ myAnswer: undefined, correctAnswer: undefined, explanation: "해설" });
    expect(wrong).toMatchObject({ myAnswer: "틀린 답", correctAnswer: "모범 답안", explanation: "해설" });
    expect(dontKnow?.myAnswer).toBe("건너뛰었어요");
    expect(skipped?.myAnswer).toBe("건너뛰었어요");
    expect(ungraded).toMatchObject({ myAnswer: "서술한 답", correctAnswer: "모범 답안", explanation: "해설" });
    expect(noResult).toMatchObject({ myAnswer: "서술한 답", correctAnswer: undefined, explanation: undefined });
  });

  it("TC-224 틀린 카드의 내 답과 정답 중 긴 쪽이 30자를 넘으면 나란히 두지 않고 위아래로 쌓아요", () => {
    const [even, long] = cardsOf(
      { kind: "wrong", myAnswer: "가".repeat(30), correctAnswer: "나".repeat(30) },
      { kind: "wrong", myAnswer: "가", correctAnswer: "나".repeat(31) },
    );

    expect(even?.stacked).toBe(false);
    expect(long?.stacked).toBe(true);
  });
});
