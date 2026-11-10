import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttemptInput, AttemptResult } from "./quiz-attempts";
import { BLANK_SHOWN, GRADING_TIMEOUT_MS, choiceMarks, fillLines, resultView, sendAttempt, shownStem } from "./quiz-card";

const base = {
  attemptId: "44444444-4444-4444-8444-444444444444",
  problemId: "55555555-5555-4555-8555-555555555555",
  hintUsed: false,
};
const modelAnswer = "GROUP BY 뒤 그룹 조건은 HAVING에 쓴다";
const freeAnswer = { modelAnswer, keyPoints: ["HAVING은 그룹 조건", "WHERE는 행 조건"] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("퀴즈 컴포넌트 화면", () => {
  it("TC-150 해설 단계에서 포맷마다 채점 결과, 정답, 내가 낸 답을 화면에 보여 줄 글로 바꿔요", () => {
    const mcqSubmitted: AttemptInput = { ...base, chosenIndex: 2, answerText: null, confidence: "sure", dontKnow: false };
    const mcqResult: AttemptResult = {
      outcome: "graded",
      isCorrect: false,
      answer: { choices: [{ text: "WHERE 절" }, { text: "HAVING 절" }, { text: "ORDER BY 절" }], answerIndex: 1 },
      explanation: "그룹 조건은 HAVING에 써요.",
    };
    expect(resultView(mcqSubmitted, mcqResult)).toEqual({
      verdict: "틀렸어요",
      correctAnswers: ["HAVING 절"],
      myAnswer: "ORDER BY 절",
    });

    const blankSubmitted: AttemptInput = { ...base, chosenIndex: null, answerText: "join", confidence: "unsure", dontKnow: false };
    const blankResult: AttemptResult = {
      outcome: "graded",
      isCorrect: true,
      answer: { accepted: ["JOIN", "조인"] },
      explanation: "공통 컬럼으로 잇는 것은 조인이에요.",
    };
    expect(resultView(blankSubmitted, blankResult)).toEqual({
      verdict: "맞았어요",
      correctAnswers: ["JOIN", "조인"],
      myAnswer: "join",
    });

    const written = "HAVING은 묶은 뒤의 조건이라서요";
    const freeSubmitted: AttemptInput = { ...base, chosenIndex: null, answerText: written, confidence: "sure", dontKnow: false };
    const freeResult: AttemptResult = { outcome: "ungraded", answer: freeAnswer, explanation: "WHERE는 묶기 전이에요." };
    expect(resultView(freeSubmitted, freeResult)).toEqual({
      verdict: null,
      correctAnswers: [modelAnswer],
      myAnswer: written,
    });

    const dontKnowSubmitted: AttemptInput = { ...base, chosenIndex: null, answerText: null, confidence: null, dontKnow: true };
    const dontKnowResult: AttemptResult = {
      outcome: "graded",
      isCorrect: false,
      answer: freeAnswer,
      explanation: "WHERE는 묶기 전이에요.",
    };
    expect(resultView(dontKnowSubmitted, dontKnowResult)).toEqual({
      verdict: "틀렸어요",
      correctAnswers: [modelAnswer],
      myAnswer: "잘 모르겠어요",
    });
  });

  it("TC-151 채점 요청이 20초 안에 끝나지 않거나 서버 오류나 연결 끊김으로 끝나면 실패로 알리고, 성공하면 응답의 채점 결과를 돌려줘요", async () => {
    const request: AttemptInput = { ...base, chosenIndex: 1, answerText: null, confidence: "guess", dontKnow: false };
    const graded: AttemptResult = {
      outcome: "graded",
      isCorrect: true,
      answer: { choices: [{ text: "WHERE 절" }, { text: "HAVING 절" }], answerIndex: 1 },
      explanation: "그룹 조건은 HAVING에 써요.",
    };

    const ok = vi.fn<typeof fetch>(async () => Response.json(graded));
    vi.stubGlobal("fetch", ok);
    expect(await sendAttempt(request)).toEqual(graded);
    const [url, init] = ok.mock.calls[0] ?? [];
    expect(url).toBe("/api/quiz-attempts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })));
    expect(await sendAttempt(request)).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await sendAttempt(request)).toBeUndefined();

    vi.useFakeTimers();
    const silent = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", silent);
    let settled = false;
    const waiting = sendAttempt(request).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(GRADING_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toBeUndefined();
    expect(GRADING_TIMEOUT_MS).toBe(20_000);
  });

  it("TC-152 빈칸 문항의 ____ 자리는 줄에 혼자 있어도 마크다운으로 그린 화면에서 빈칸 표시로 남아요", () => {
    const parse = (markdown: string) => unified().use(remarkParse).use(remarkGfm).parse(markdown);

    const inline = parse(shownStem("두 테이블을 잇는 것을 ____이라고 한다"));
    expect(toString(inline)).toBe(`두 테이블을 잇는 것을 ${BLANK_SHOWN}이라고 한다`);
    expect(toString(inline).split(BLANK_SHOWN)).toHaveLength(2);

    const alone = parse(shownStem("SELECT 문에서\n\n____\n\n절을 쓴다"));
    expect(alone.children.map((node) => node.type)).not.toContain("thematicBreak");
    expect(toString(alone)).toBe(`SELECT 문에서${BLANK_SHOWN}절을 쓴다`);
    expect(toString(alone).split(BLANK_SHOWN)).toHaveLength(2);
  });

  it("TC-280 채점 뒤 객관식 보기는 정답에 정답 표시, 내가 고른 오답에 오답 표시를 하고 나머지는 흐리게 보여 줘요", () => {
    const answer = { choices: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }], answerIndex: 2 };
    const chose = (chosenIndex: number): AttemptInput => ({ ...base, chosenIndex, answerText: null, confidence: "sure", dontKnow: false });

    const wrong: AttemptResult = { outcome: "graded", isCorrect: false, answer, explanation: "C가 맞아요." };
    expect(choiceMarks(chose(1), wrong)).toEqual(["dim", "wrong", "right", "dim"]);

    const right: AttemptResult = { outcome: "graded", isCorrect: true, answer, explanation: "C가 맞아요." };
    expect(choiceMarks(chose(2), right)).toEqual(["dim", "dim", "right", "dim"]);
  });

  it("TC-281 채점 뒤 빈칸은 내 답 줄을 맞으면 정답 표시, 틀리면 오답 표시로 보여 주고, 틀렸을 때만 정답 줄을 하나 더 보여 줘요", () => {
    const wrote = (answerText: string): AttemptInput => ({ ...base, chosenIndex: null, answerText, confidence: "sure", dontKnow: false });
    const answer = { accepted: ["HAVING"] };

    const right: AttemptResult = { outcome: "graded", isCorrect: true, answer, explanation: "그룹 조건이에요." };
    expect(fillLines(wrote("HAVING"), right)).toEqual([{ label: "내 답", text: "HAVING", mark: "right" }]);

    const wrong: AttemptResult = { outcome: "graded", isCorrect: false, answer, explanation: "그룹 조건이에요." };
    expect(fillLines(wrote("WHERE"), wrong)).toEqual([
      { label: "내 답", text: "WHERE", mark: "wrong" },
      { label: "정답", text: "HAVING", mark: "right" },
    ]);
  });
});
