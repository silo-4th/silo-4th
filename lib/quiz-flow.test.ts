import { describe, expect, it } from "vitest";
import type { AttemptResult } from "./quiz-attempts";
import {
  MAX_ANSWER_LENGTH,
  type QuizFlow,
  type QuizFlowEvent,
  advanceQuizFlow,
  canSubmit,
  startQuizFlow,
} from "./quiz-flow";

const mcq = { id: "11111111-1111-4111-8111-111111111111", format: "mcq" as const, choices: ["가", "나", "다", "라"] };
const blank = { id: "22222222-2222-4222-8222-222222222222", format: "blank" as const };
const free = { id: "33333333-3333-4333-8333-333333333333", format: "free" as const };

function run(flow: QuizFlow, ...events: QuizFlowEvent[]): QuizFlow {
  return events.reduce(advanceQuizFlow, flow);
}

function requestOf(flow: QuizFlow) {
  if (flow.stage !== "grading") throw new Error(`채점 대기가 아니라 ${flow.stage} 단계예요.`);
  return flow.request;
}

describe("퀴즈 풀이 흐름", () => {
  it("TC-139 객관식 문제에서 답을 내고 확신도를 고르면 채점 대기를 거쳐 해설 단계에서 채점 결과, 정답, 해설, 내가 낸 답을 보여 줘요", () => {
    const result: AttemptResult = {
      outcome: "graded",
      isCorrect: true,
      answer: { choices: mcq.choices.map((text) => ({ text })), answerIndex: 2 },
      explanation: "다가 맞는 이유",
    };
    const start = startQuizFlow(mcq);
    expect(start.stage).toBe("problem");

    const answered = run(start, { type: "choose", index: 2 }, { type: "submit" });
    expect(answered.stage).toBe("confidence");

    const grading = run(answered, { type: "pick-confidence", confidence: "sure" });
    expect(grading.stage).toBe("grading");

    const explained = run(grading, { type: "graded", result });
    expect(explained).toMatchObject({ stage: "explanation", result });
    if (explained.stage !== "explanation") return;
    expect(explained.submitted.chosenIndex).toBe(2);
  });

  it("TC-140 객관식에서 보기를 고르지 않았거나 빈칸과 서술형 답이 비어 있거나 공백뿐이면 답을 낼 수 없어요", () => {
    const unchosen = startQuizFlow(mcq);
    expect(canSubmit(unchosen)).toBe(false);
    expect(run(unchosen, { type: "submit" }).stage).toBe("problem");

    for (const problem of [blank, free]) {
      for (const text of ["", "   \n\t"]) {
        const empty = run(startQuizFlow(problem), { type: "write", text });
        expect(canSubmit(empty)).toBe(false);
        expect(run(empty, { type: "submit" }).stage).toBe("problem");
      }
      const filled = run(startQuizFlow(problem), { type: "write", text: " 상태 " });
      expect(canSubmit(filled)).toBe(true);
      expect(run(filled, { type: "submit" }).stage).toBe("confidence");
    }

    const chosen = run(startQuizFlow(mcq), { type: "choose", index: 0 });
    expect(canSubmit(chosen)).toBe(true);
    expect(run(chosen, { type: "submit" }).stage).toBe("confidence");
  });

  it("TC-141 확신도 단계에서는 확신도를 고르지 않고 채점 대기로 넘어갈 수 없어요", () => {
    const confidence = run(startQuizFlow(mcq), { type: "choose", index: 1 }, { type: "submit" });
    expect(confidence.stage).toBe("confidence");

    const result: AttemptResult = {
      outcome: "graded",
      isCorrect: false,
      answer: { choices: mcq.choices.map((text) => ({ text })), answerIndex: 2 },
      explanation: "해설",
    };
    expect(run(confidence, { type: "graded", result }).stage).toBe("confidence");
    expect(run(confidence, { type: "next" }).stage).toBe("confidence");

    for (const pick of ["sure", "unsure", "guess"] as const) {
      expect(run(confidence, { type: "pick-confidence", confidence: pick }).stage).toBe("grading");
    }
  });

  it("TC-142 서술형에서 잘 모르겠어요를 누르면 확신도를 건너뛰고 채점 대기로 가며, 잘 모르겠어요는 객관식과 빈칸에서 쓸 수 없어요", () => {
    const grading = run(startQuizFlow(free), { type: "dont-know" });
    expect(grading.stage).toBe("grading");
    expect(requestOf(grading)).toMatchObject({ dontKnow: true, confidence: null });

    const result: AttemptResult = {
      outcome: "graded",
      isCorrect: false,
      answer: { modelAnswer: "모범 답안", keyPoints: ["핵심"] },
      explanation: "해설",
    };
    expect(run(grading, { type: "graded", result }).stage).toBe("explanation");

    expect(run(startQuizFlow(mcq), { type: "dont-know" }).stage).toBe("problem");
    expect(run(startQuizFlow(blank), { type: "dont-know" }).stage).toBe("problem");
  });

  it("TC-143 채점 대기의 풀이 저장 요청 본문에 문제를 시작할 때 만든 풀이 ID, 낸 답, 확신도, 힌트를 봤는지가 담겨요", () => {
    const start = startQuizFlow(blank);
    const answer = [{ type: "write", text: "useState" }, { type: "submit" }] as const;
    const pick = { type: "pick-confidence", confidence: "unsure" } as const;

    const withHint = run(start, { type: "show-hint" }, ...answer, pick);
    expect(requestOf(withHint)).toEqual({
      attemptId: start.attemptId,
      problemId: blank.id,
      chosenIndex: null,
      answerText: "useState",
      confidence: "unsure",
      hintUsed: true,
      dontKnow: false,
    });

    const withoutHint = run(start, ...answer, pick);
    expect(requestOf(withoutHint).hintUsed).toBe(false);
  });

  it("TC-144 채점 요청이 실패하면 같은 풀이 ID로 한 번 자동으로 다시 보내고, 또 실패하면 다시 시도와 다음 문제로를 고를 수 있어요", () => {
    const grading = run(
      startQuizFlow(mcq),
      { type: "choose", index: 3 },
      { type: "submit" },
      { type: "pick-confidence", confidence: "guess" },
    );
    if (grading.stage !== "grading") throw new Error("채점 대기가 아니에요.");
    const request = grading.request;

    const resend = run(grading, { type: "grading-failed" });
    expect(resend.stage).toBe("grading");
    if (resend.stage !== "grading") return;
    expect(resend.sent).not.toBe(grading.sent);
    expect(resend.request).toEqual(request);

    const failed = run(resend, { type: "grading-failed" });
    expect(failed.stage).toBe("grading-failed");

    const retried = run(failed, { type: "retry" });
    expect(retried.stage).toBe("grading");
    expect(requestOf(retried)).toEqual(request);
    expect(requestOf(retried).attemptId).toBe(grading.request.attemptId);

    expect(run(failed, { type: "next" }).stage).toBe("done");
  });

  it("TC-145 서버 응답이 채점하지 못함이면 기다리지 않고 채점 결과 없이 정답과 해설만 담아 해설 단계로 가요", () => {
    const grading = run(
      startQuizFlow(free),
      { type: "write", text: "상태가 바뀌면 다시 그려요" },
      { type: "submit" },
      { type: "pick-confidence", confidence: "sure" },
    );
    const result: AttemptResult = {
      outcome: "ungraded",
      answer: { modelAnswer: "모범 답안", keyPoints: ["핵심"] },
      explanation: "해설",
    };

    const explained = run(grading, { type: "graded", result });
    expect(explained.stage).toBe("explanation");
    if (explained.stage !== "explanation") return;
    expect(explained.result).toEqual(result);
    expect(explained.result).not.toHaveProperty("isCorrect");
    expect(explained.submitted.answerText).toBe("상태가 바뀌면 다시 그려요");
  });

  it("TC-148 빈칸과 서술형 답이 4000자를 넘으면 넘친 글만 자르고, 이모지는 반만 남기지 않아요", () => {
    const written = (text: string) => {
      const flow = run(startQuizFlow(free), { type: "write", text });
      if (flow.stage !== "problem") throw new Error(`문제 단계가 아니라 ${flow.stage} 단계예요.`);
      return flow;
    };
    const exact = "a".repeat(MAX_ANSWER_LENGTH);
    const before = "a".repeat(MAX_ANSWER_LENGTH - 1);

    expect(written(exact).text).toBe(exact);
    expect(written(`${exact}b`).text).toBe(exact);

    const straddled = written(`${before}😀`);
    expect(straddled.text).toBe(before);
    expect(straddled.text.isWellFormed()).toBe(true);
    expect(canSubmit(straddled)).toBe(true);
  });
});
