import { describe, expect, it } from "vitest";
import type { QuizAnswer } from "./db/schema";
import { type PastAttempt, pastCard, pastList } from "./past-problems";
import { chipOf } from "./recall-result";

const CHOICE_ANSWER: QuizAnswer = {
  choices: [{ text: "WHERE" }, { text: "HAVING" }, { text: "ORDER BY" }, { text: "LIMIT" }],
  answerIndex: 1,
};
const BLANK_ANSWER: QuizAnswer = { accepted: ["HAVING", "해빙"] };
const FREE_ANSWER: QuizAnswer = { modelAnswer: "그룹을 만든 뒤 조건으로 거른다.", keyPoints: ["그룹", "조건"] };

function attempt(overrides: Partial<PastAttempt> = {}): PastAttempt {
  return {
    attemptId: "attempt",
    answeredAt: "2026-11-09T01:00:00.000Z",
    unitTitle: "GROUP BY",
    format: "mcq",
    stem: "그룹 조건은 어디에 쓰나요?",
    chosenIndex: 1,
    answerText: null,
    confidence: "sure",
    isCorrect: true,
    answer: CHOICE_ANSWER,
    explanation: "그룹 조건은 HAVING에 써요.",
    ...overrides,
  };
}

describe("지난 문제", () => {
  it("TC-250 지난 문제의 칩은 저장된 맞힘과 확신도로 정해지고, 퀴즈 탭 결과 칩과 같은 규칙을 따라요", () => {
    const cases = [
      { saved: attempt({ confidence: "sure", isCorrect: true }), chip: "맞혔어요" },
      { saved: attempt({ confidence: "unsure", isCorrect: true }), chip: "맞았지만 헷갈렸어요" },
      { saved: attempt({ confidence: "guess", isCorrect: true }), chip: "맞았지만 헷갈렸어요" },
      { saved: attempt({ chosenIndex: 0, isCorrect: false }), chip: "틀렸어요" },
      {
        saved: attempt({ format: "free", chosenIndex: null, answerText: "조건을 건다", answer: FREE_ANSWER, isCorrect: null }),
        chip: "채점하지 못했어요",
      },
    ] as const;

    for (const { saved, chip } of cases) {
      expect(pastCard(saved).chip).toBe(chip);
      const submitted = {
        attemptId: saved.attemptId,
        problemId: "problem",
        chosenIndex: saved.chosenIndex,
        answerText: saved.answerText,
        confidence: saved.confidence,
        hintUsed: false,
        dontKnow: false,
      };
      const result =
        saved.isCorrect === null
          ? { outcome: "ungraded" as const, answer: saved.answer, explanation: saved.explanation }
          : { outcome: "graded" as const, isCorrect: saved.isCorrect, answer: saved.answer, explanation: saved.explanation };
      expect(pastCard(saved).chip).toBe(chipOf(submitted, result));
    }
  });

  it("TC-251 지난 문제를 펼치면 칩과 상관없이 문제, 내 답, 정답, 해설을 형식에 맞는 글로 보여 줘요", () => {
    const choice = pastCard(attempt({ format: "mcq", chosenIndex: 1, confidence: "sure", isCorrect: true }));
    const blank = pastCard(
      attempt({ format: "blank", stem: "그룹 조건은 ____에 써요.", chosenIndex: null, answerText: "WHERE", answer: BLANK_ANSWER, isCorrect: false }),
    );
    const free = pastCard(
      attempt({ format: "free", stem: "HAVING은 언제 쓰나요?", chosenIndex: null, answerText: "조건을 건다", answer: FREE_ANSWER, isCorrect: null }),
    );

    expect(choice).toMatchObject({
      stem: "그룹 조건은 어디에 쓰나요?",
      myAnswer: "HAVING",
      correctAnswer: "HAVING",
      explanation: "그룹 조건은 HAVING에 써요.",
    });
    expect(blank).toMatchObject({ myAnswer: "WHERE", correctAnswer: "HAVING, 해빙", explanation: "그룹 조건은 HAVING에 써요." });
    expect(blank.stem).toContain("그룹 조건은");
    expect(free).toMatchObject({
      stem: "HAVING은 언제 쓰나요?",
      myAnswer: "조건을 건다",
      correctAnswer: "그룹을 만든 뒤 조건으로 거른다.",
      explanation: "그룹 조건은 HAVING에 써요.",
    });
  });

  it("TC-252 지난 문제 목록은 최근에 푼 순서이고, 틀림, 헷갈림, 맞힘으로 거르면 그 칩만 남고 채점하지 못한 문제는 전체에만 보여요", () => {
    const attempts = [
      attempt({ attemptId: "wrong", answeredAt: "2026-11-09T02:00:00.000Z", chosenIndex: 0, isCorrect: false }),
      attempt({ attemptId: "unsure", answeredAt: "2026-11-09T04:00:00.000Z", confidence: "unsure", isCorrect: true }),
      attempt({ attemptId: "sure", answeredAt: "2026-11-09T01:00:00.000Z", confidence: "sure", isCorrect: true }),
      attempt({
        attemptId: "ungraded",
        answeredAt: "2026-11-09T03:00:00.000Z",
        format: "free",
        chosenIndex: null,
        answerText: "조건을 건다",
        answer: FREE_ANSWER,
        isCorrect: null,
      }),
    ];
    const ids = (filter: Parameters<typeof pastList>[1]) => pastList(attempts, filter).map((card) => card.attemptId);

    expect(ids("전체")).toEqual(["unsure", "ungraded", "wrong", "sure"]);
    expect(ids("틀림")).toEqual(["wrong"]);
    expect(ids("헷갈림")).toEqual(["unsure"]);
    expect(ids("맞힘")).toEqual(["sure"]);

    const twoWrong = [...attempts, attempt({ attemptId: "wrong-later", answeredAt: "2026-11-09T05:00:00.000Z", chosenIndex: 3, isCorrect: false })];
    expect(pastList(twoWrong, "틀림").map((card) => card.attemptId)).toEqual(["wrong-later", "wrong"]);
  });
});
