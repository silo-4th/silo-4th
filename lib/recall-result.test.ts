import { describe, expect, it } from "vitest";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { type RecallAnswer, advanceRecall, startRecall } from "@/lib/recall-flow";
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

const CHOICES = ["WHERE", "HAVING", "ORDER BY", "LIMIT"];

function mcqItem(position: number): RecallSetView["items"][number] {
  const base = item(position);
  return { ...base, problem: { ...base.problem, format: "mcq", choices: CHOICES } };
}

function blankItem(position: number): RecallSetView["items"][number] {
  const base = item(position);
  return { ...base, problem: { ...base.problem, format: "blank" } };
}

function mcqResult(isCorrect: boolean): AttemptResult {
  return { outcome: "graded", isCorrect, answer: { choices: CHOICES.map((text) => ({ text })), answerIndex: 1 }, explanation: "해설" };
}

function blankResult(isCorrect: boolean): AttemptResult {
  return { outcome: "graded", isCorrect, answer: { accepted: ["HAVING"] }, explanation: "해설" };
}

function answeredOf(position: number) {
  return { submitted: submitted(position, "모범 답안", "sure"), result: result(true) };
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

  it("TC-290 꺼내 먹기 결과 카드의 칩은 맞힘과 확신도, 건너뜀, 채점 여부로 정해지고, 풀지 않고 결과를 연 문항은 틀렸어요로 세요", () => {
    const cards = cardsOf(
      { kind: "correct", confidence: "sure" },
      { kind: "correct", confidence: "unsure" },
      { kind: "correct", confidence: "guess" },
      { kind: "wrong" },
      { kind: "dontKnow" },
      { kind: "skipped" },
      { kind: "ungraded" },
    );
    expect(cards.map((card) => card.chip)).toEqual([
      "맞혔어요",
      "맞았지만 헷갈렸어요",
      "맞았지만 헷갈렸어요",
      "틀렸어요",
      "틀렸어요",
      "틀렸어요",
      "채점하지 못했어요",
    ]);

    const set: RecallSetView = { id: "set-1", items: [1, 2, 3].map(item) };
    const started = advanceRecall(startRecall(set), { type: "start" });
    const finished = advanceRecall(advanceRecall(started, { type: "answered", ...answeredOf(1) }), { type: "finish" });
    if (finished.stage !== "result") throw new Error("결과 단계여야 한다.");
    const unfinished = resultCards(set, finished.answers);
    expect(unfinished.map((card) => card.chip)).toEqual(["맞혔어요", "틀렸어요", "틀렸어요"]);
    expect(resultTitle(unfinished)).toBe("3개 중 2개를 틀렸어요");
  });

  it("TC-291 꺼내 먹기 결과 카드는 맞혀도 지문, 내 답, 정답, 해설을 보여 주고, 객관식은 보기마다 정답과 내 답을 표시하며, 건너뛰거나 풀지 않고 넘긴 문항도 정답과 해설을 보여 줘요", () => {
    const blankRight = blankItem(1);
    const mcqWrong = mcqItem(2);
    const skipped = blankItem(3);
    const unfinished = mcqItem(4);
    const noResult = blankItem(5);
    const set: RecallSetView = { id: "set-1", items: [blankRight, mcqWrong, skipped, unfinished, noResult] };
    const cards = resultCards(set, [
      { itemId: blankRight.id, kind: "answered", submitted: { ...submitted(1, "HAVING", "sure") }, result: blankResult(true) },
      { itemId: mcqWrong.id, kind: "answered", submitted: { ...submitted(2, null, "sure"), chosenIndex: 2 }, result: mcqResult(false) },
      { itemId: skipped.id, kind: "answered", submitted: submitted(3, null, null, true), result: blankResult(false) },
      { itemId: unfinished.id, kind: "answered", submitted: submitted(4, null, null, true), result: mcqResult(false) },
      { itemId: noResult.id, kind: "answered", submitted: submitted(5, "WHERE", "sure") },
    ]);

    expect(cards.map((card) => card.stem)).toEqual(["문제 1", "문제 2", "문제 3", "문제 4", "문제 5"]);
    const [right, wrong, skip, rest, none] = cards;
    expect(right).toMatchObject({ myAnswer: "HAVING", correctAnswer: "HAVING", explanation: "해설" });
    expect(wrong).toMatchObject({
      choices: [
        { text: "WHERE", mark: "dim", mine: false },
        { text: "HAVING", mark: "right", mine: false },
        { text: "ORDER BY", mark: "wrong", mine: true },
        { text: "LIMIT", mark: "dim", mine: false },
      ],
      explanation: "해설",
    });
    expect(skip).toMatchObject({ myAnswer: "건너뛰었어요", correctAnswer: "HAVING", explanation: "해설" });
    expect(rest).toMatchObject({ myAnswer: "건너뛰었어요", correctAnswer: "HAVING", explanation: "해설" });
    expect(none).toMatchObject({ myAnswer: "WHERE", correctAnswer: undefined, explanation: undefined });
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
