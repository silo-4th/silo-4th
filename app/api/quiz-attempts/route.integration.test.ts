import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { concept, learner, type QuizAnswer, quizAttempt, quizProblem, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { GRADING_TIMEOUT_MS } from "@/lib/llm/grading";
import { studyDay } from "@/lib/study-day";
import { POST } from "./route";

const ai = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: ai.create };
  },
}));

const APP_VERSION = "test-version";
const createdAttemptIds: string[] = [];
const createdProblemIds: string[] = [];
const createdConceptIds: string[] = [];

const CHOICE_ANSWER: QuizAnswer = {
  choices: [
    { text: "렌더링마다 새로 만든다" },
    { text: "부모가 넘겨준다" },
    { text: "React가 컴포넌트 밖에 보관한다" },
    { text: "전역 변수에 둔다" },
  ],
  answerIndex: 2,
};
const BLANK_ANSWER: QuizAnswer = { accepted: ["useState", "상태 훅"] };
const FREE_ANSWER: QuizAnswer = {
  modelAnswer: "상태가 바뀌면 React가 컴포넌트를 다시 렌더링해 새 값을 화면에 반영한다.",
  keyPoints: ["상태 변경", "다시 렌더링"],
};

function jsonReply(value: object) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] };
}

function aiGrades(grading: "correct" | "wrong") {
  ai.create.mockResolvedValueOnce(jsonReply({ grading }));
}

function useFakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
}

function newAttemptId() {
  const id = randomUUID();
  createdAttemptIds.push(id);
  return id;
}

async function testConcept() {
  const [found] = await getDb().select({ id: unit.id }).from(unit).orderBy(asc(unit.id)).limit(1);
  if (!found) throw new Error("테스트 DB에 단원이 없다.");
  const id = `test-${randomUUID()}`;
  createdConceptIds.push(id);
  await getDb().insert(concept).values({ id, unitId: found.id, title: "테스트 개념" });
  return id;
}

async function newProblem(
  format: "mcq" | "blank" | "free",
  { learnerId = null, retiredAt = null }: { learnerId?: string | null; retiredAt?: Date | null } = {},
) {
  const answer = { mcq: CHOICE_ANSWER, blank: BLANK_ANSWER, free: FREE_ANSWER }[format];
  const [row] = await getDb()
    .insert(quizProblem)
    .values({
      learnerId,
      conceptId: await testConcept(),
      format,
      stem: `${format} 문제`,
      answer,
      hint: `${format} 힌트`,
      explanation: `${format} 해설`,
      retiredAt,
    })
    .returning();
  if (!row) throw new Error("문제를 넣지 못했다.");
  createdProblemIds.push(row.id);
  return row;
}

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

function submit(
  body: Record<string, unknown>,
  { headers = new Headers(), origin = new URL(env.AUTH_URL).origin }: { headers?: Headers; origin?: string } = {},
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  requestHeaders.set("content-type", "application/json");
  return POST(
    new Request(new URL("/api/quiz-attempts", env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

async function result(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

function attemptRows(id: string) {
  return getDb().select().from(quizAttempt).where(eq(quizAttempt.id, id));
}

async function attemptRow(id: string) {
  const rows = await attemptRows(id);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function sentToGradingAi() {
  return JSON.stringify(ai.create.mock.calls.map(([params]: unknown[]) => params));
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_VERSION);
});

afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  ai.create.mockReset();
  const db = getDb();
  const attemptIds = createdAttemptIds.splice(0);
  const problemIds = createdProblemIds.splice(0);
  const conceptIds = createdConceptIds.splice(0);
  if (attemptIds.length > 0) await db.delete(quizAttempt).where(inArray(quizAttempt.id, attemptIds));
  if (problemIds.length > 0) {
    await db.delete(quizAttempt).where(inArray(quizAttempt.problemId, problemIds));
    await db.delete(quizProblem).where(inArray(quizProblem.id, problemIds));
  }
  if (conceptIds.length > 0) await db.delete(concept).where(inArray(concept.id, conceptIds));
  await deleteCreatedLearners();
});

describe("퀴즈 풀이 저장과 채점", () => {
  it("TC-103 객관식과 빈칸 풀이를 보내면 한 줄씩 남고, 응답에 채점 결과와 정답, 해설이 와요", async () => {
    const { headers, learnerId } = await loginConsented();
    const choice = await newProblem("mcq");
    const blank = await newProblem("blank");
    const choiceId = newAttemptId();
    const blankId = newAttemptId();

    const choiceResult = await result(
      await submit(
        { attemptId: choiceId, problemId: choice.id, chosenIndex: 2, confidence: "sure", hintUsed: true, dontKnow: false },
        { headers },
      ),
    );
    const blankResult = await result(
      await submit(
        { attemptId: blankId, problemId: blank.id, answerText: "useEffect", confidence: "guess", hintUsed: false, dontKnow: false },
        { headers },
      ),
    );

    const choiceRow = await attemptRow(choiceId);
    const blankRow = await attemptRow(blankId);
    expect(choiceRow).toMatchObject({
      learnerId,
      problemId: choice.id,
      chosenIndex: 2,
      answerText: null,
      confidence: "sure",
      hintUsed: true,
      isCorrect: true,
    });
    expect(blankRow).toMatchObject({
      learnerId,
      problemId: blank.id,
      chosenIndex: null,
      answerText: "useEffect",
      confidence: "guess",
      hintUsed: false,
      isCorrect: false,
    });
    for (const row of [choiceRow, blankRow]) {
      expect(row).toMatchObject({ reasonText: null, recallItemId: null, appVersion: APP_VERSION });
      expect(row.studyDay).toBe(studyDay(row.answeredAt));
    }
    expect(choiceResult).toMatchObject({ isCorrect: true, answer: choice.answer, explanation: choice.explanation });
    expect(blankResult).toMatchObject({ isCorrect: false, answer: blank.answer, explanation: blank.explanation });
  });

  it("TC-104 서술형에서 잘 모르겠어요로 넘긴 풀이는 AI 채점 없이 찍었어요와 틀림으로 저장되고, 응답에 정답과 해설이 와요", async () => {
    const { headers } = await loginConsented();
    const free = await newProblem("free");
    const partialId = newAttemptId();
    const emptyId = newAttemptId();
    const blankId = newAttemptId();

    const responses = [
      await submit({ attemptId: partialId, problemId: free.id, answerText: "상태가 바뀌면", hintUsed: false, dontKnow: true }, { headers }),
      await submit({ attemptId: emptyId, problemId: free.id, hintUsed: false, dontKnow: true }, { headers }),
      await submit({ attemptId: blankId, problemId: free.id, answerText: "   ", hintUsed: false, dontKnow: true }, { headers }),
    ];

    for (const response of responses) {
      expect(await result(response)).toMatchObject({ isCorrect: false, answer: free.answer, explanation: free.explanation });
    }
    for (const id of [partialId, emptyId, blankId]) {
      expect(await attemptRow(id)).toMatchObject({ confidence: "guess", isCorrect: false });
    }
    expect((await attemptRow(partialId)).answerText).toBe("상태가 바뀌면");
    expect((await attemptRow(emptyId)).answerText).toBeNull();
    expect((await attemptRow(blankId)).answerText).toBeNull();
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("TC-105 서술형 풀이는 AI가 맞음과 틀림으로 채점하고, 응답에 채점 결과와 정답, 해설이 와요", async () => {
    const { headers } = await loginConsented();
    const free = await newProblem("free");
    const attemptId = newAttemptId();
    const explained = "값이 바뀌면 컴포넌트를 다시 그려요";
    aiGrades("correct");

    const body = await result(
      await submit(
        { attemptId, problemId: free.id, answerText: explained, confidence: "unsure", hintUsed: false, dontKnow: false },
        { headers },
      ),
    );

    expect(await attemptRow(attemptId)).toMatchObject({
      answerText: explained,
      confidence: "unsure",
      isCorrect: true,
      reasonText: null,
    });
    expect(body).toEqual({ outcome: "graded", isCorrect: true, answer: free.answer, explanation: free.explanation });
    const sent = sentToGradingAi();
    for (const part of [free.stem, FREE_ANSWER.modelAnswer, ...FREE_ANSWER.keyPoints, free.hint, free.explanation, explained]) {
      expect(sent).toContain(part);
    }
  });

  it("TC-106 같은 풀이 ID로 다시 보내면 한 줄만 남고 처음과 같은 응답이 와요", async () => {
    const { headers } = await loginConsented();
    const choice = await newProblem("mcq");
    const attemptId = newAttemptId();
    const correct = { attemptId, problemId: choice.id, chosenIndex: 2, confidence: "sure", hintUsed: false, dontKnow: false };
    const first = await result(await submit(correct, { headers }));
    const rowBefore = await attemptRow(attemptId);

    const same = await result(await submit(correct, { headers }));
    const changed = await result(await submit({ ...correct, chosenIndex: 0 }, { headers }));

    expect(await attemptRows(attemptId)).toEqual([rowBefore]);
    for (const body of [same, changed]) {
      expect(body.isCorrect).toEqual(first.isCorrect);
      expect(body.answer).toEqual(first.answer);
      expect(body.explanation).toEqual(first.explanation);
    }
  });

  it("TC-107 다른 학습자의 풀이 ID로 보내면 거부하고 그 풀이를 건드리지 않아요", async () => {
    const a = await loginConsented();
    const b = await loginConsented();
    const choice = await newProblem("mcq");
    const attemptId = newAttemptId();
    const base = { attemptId, problemId: choice.id, confidence: "sure", hintUsed: false, dontKnow: false };
    await result(await submit({ ...base, chosenIndex: 2 }, { headers: a.headers }));
    const rowBefore = await attemptRow(attemptId);

    const response = await submit({ ...base, chosenIndex: 0 }, { headers: b.headers });

    expect(response.status).toBe(403);
    expect(await attemptRows(attemptId)).toEqual([rowBefore]);
    expect(rowBefore.learnerId).toBe(a.learnerId);
  });

  it("TC-108 로그인하지 않았거나 저장에 동의하지 않았으면 풀이를 받지 않아요", async () => {
    const choice = await newProblem("mcq");
    const anonymousId = newAttemptId();
    const notConsentedId = newAttemptId();
    const body = { problemId: choice.id, chosenIndex: 2, confidence: "sure", hintUsed: false, dontKnow: false };

    const anonymous = await submit({ ...body, attemptId: anonymousId });
    const { headers } = await loginWithGoogle(newProfile());
    const notConsented = await submit({ ...body, attemptId: notConsentedId }, { headers });

    expect(anonymous.status).toBe(401);
    expect(notConsented.status).toBe(403);
    for (const id of [anonymousId, notConsentedId]) expect(await attemptRows(id)).toEqual([]);
  });

  it("TC-109 답이나 확신도가 포맷 규칙에 맞지 않거나 없는 문제면 거부하고 아무것도 저장하지 않아요", async () => {
    const { headers } = await loginConsented();
    const choice = await newProblem("mcq");
    const blank = await newProblem("blank");
    const free = await newProblem("free");
    const base = { confidence: "sure", hintUsed: false, dontKnow: false };
    const cases: [string, Record<string, unknown>, number][] = [
      ["객관식인데 고른 보기가 없어요", { ...base, problemId: choice.id }, 400],
      ["객관식인데 보기 개수를 넘어요", { ...base, problemId: choice.id, chosenIndex: 4 }, 400],
      ["빈칸인데 답이 없어요", { ...base, problemId: blank.id }, 400],
      ["빈칸인데 답이 공백뿐이에요", { ...base, problemId: blank.id, answerText: "   " }, 400],
      ["서술형인데 설명이 없어요", { ...base, problemId: free.id }, 400],
      ["서술형인데 설명이 공백뿐이에요", { ...base, problemId: free.id, answerText: " \n " }, 400],
      ["객관식인데 확신도가 없어요", { ...base, confidence: undefined, problemId: choice.id, chosenIndex: 2 }, 400],
      ["빈칸인데 확신도가 없어요", { ...base, confidence: undefined, problemId: blank.id, answerText: "useState" }, 400],
      ["서술형인데 확신도가 없어요", { ...base, confidence: undefined, problemId: free.id, answerText: "설명" }, 400],
      ["서술형 잘 모르겠어요인데 확신도가 있어요", { ...base, dontKnow: true, problemId: free.id }, 400],
      ["객관식인데 잘 모르겠어요가 참이에요", { ...base, dontKnow: true, problemId: choice.id, chosenIndex: 2 }, 400],
      ["빈칸인데 잘 모르겠어요가 참이에요", { ...base, dontKnow: true, problemId: blank.id, answerText: "useState" }, 400],
      ["없는 문제예요", { ...base, problemId: randomUUID(), chosenIndex: 2 }, 404],
    ];

    for (const [name, body, status] of cases) {
      const attemptId = newAttemptId();
      const response = await submit({ ...body, attemptId }, { headers });
      expect(response.status, name).toBe(status);
      expect(await attemptRows(attemptId), name).toEqual([]);
    }
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("TC-110 채점 결과를 직접 넣어 보내도 서버가 채점한 값만 남고 응답도 그 값을 담아요", async () => {
    const { headers } = await loginConsented();
    const choice = await newProblem("mcq");
    const free = await newProblem("free");
    const choiceId = newAttemptId();
    const freeId = newAttemptId();
    aiGrades("wrong");

    const choiceResult = await result(
      await submit(
        {
          attemptId: choiceId,
          problemId: choice.id,
          chosenIndex: 0,
          confidence: "sure",
          hintUsed: false,
          dontKnow: false,
          is_correct: true,
          isCorrect: true,
        },
        { headers },
      ),
    );
    const freeResult = await result(
      await submit(
        {
          attemptId: freeId,
          problemId: free.id,
          answerText: "잘 모르지만 써 봐요",
          confidence: "sure",
          hintUsed: false,
          dontKnow: false,
          isCorrect: true,
        },
        { headers },
      ),
    );

    expect((await attemptRow(choiceId)).isCorrect).toBe(false);
    expect((await attemptRow(freeId)).isCorrect).toBe(false);
    expect(choiceResult).toMatchObject({ isCorrect: false, answer: choice.answer, explanation: choice.explanation });
    expect(freeResult).toMatchObject({ isCorrect: false, answer: free.answer, explanation: free.explanation });
  });

  it("TC-111 다른 사이트에서 보낸 풀이 요청은 403으로 거부해요", async () => {
    const { headers } = await loginConsented();
    const choice = await newProblem("mcq");
    const attemptId = newAttemptId();

    const response = await submit(
      { attemptId, problemId: choice.id, chosenIndex: 2, confidence: "sure", hintUsed: false, dontKnow: false },
      { headers, origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect(await attemptRows(attemptId)).toEqual([]);
  });

  it("TC-112 서술형 AI 채점이 실패해도 풀이는 채점 결과 없이 저장되고, 다시 보내도 같은 응답이 와요", async () => {
    const { headers } = await loginConsented();
    const free = await newProblem("free");
    const failedId = newAttemptId();
    const slowId = newAttemptId();
    const body = { problemId: free.id, answerText: "다시 그려요", confidence: "sure", hintUsed: false, dontKnow: false };

    ai.create.mockRejectedValueOnce(new Error("채점 오류"));
    const failed = await result(await submit({ ...body, attemptId: failedId }, { headers }));

    useFakeTimers();
    ai.create.mockImplementationOnce(
      (_params: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("요청이 중단됐다.")), { once: true });
        }),
    );
    const slowResponse = submit({ ...body, attemptId: slowId }, { headers });
    // 채점을 부르기 전에 원격 DB를 여러 번 오가므로 기본 1초보다 넉넉히 기다린다.
    await vi.waitFor(() => expect(ai.create).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(GRADING_TIMEOUT_MS);
    const slow = await result(await slowResponse);
    vi.useRealTimers();

    for (const [received, id] of [
      [failed, failedId],
      [slow, slowId],
    ] as const) {
      expect(await attemptRow(id)).toMatchObject({
        answerText: "다시 그려요",
        confidence: "sure",
        isCorrect: null,
      });
      expect(received).toMatchObject({ outcome: "ungraded", answer: free.answer, explanation: free.explanation });
    }

    ai.create.mockClear();
    const retried = await result(await submit({ ...body, attemptId: failedId }, { headers }));

    expect(retried).toEqual(failed);
    expect(ai.create).not.toHaveBeenCalled();
    expect((await attemptRow(failedId)).isCorrect).toBeNull();
  });

  it("TC-113 다른 학습자에게 만든 문제로 풀이를 보내면 거부하고 정답을 내려주지 않아요", async () => {
    const a = await loginConsented();
    const b = await loginConsented();
    const problem = await newProblem("mcq", { learnerId: a.learnerId });
    const attemptId = newAttemptId();

    const response = await submit(
      { attemptId, problemId: problem.id, chosenIndex: 2, confidence: "sure", hintUsed: false, dontKnow: false },
      { headers: b.headers },
    );

    expect(response.status).toBe(403);
    expect(await attemptRows(attemptId)).toEqual([]);
    const text = await response.text();
    expect(text).not.toContain(problem.explanation);
    expect(text).not.toContain("answerIndex");
  });

  it("TC-114 푸는 동안 내려간 문제로 온 풀이도 채점해서 저장해요", async () => {
    const { headers } = await loginConsented();
    const retired = await newProblem("mcq", { retiredAt: new Date() });
    const attemptId = newAttemptId();

    const body = await result(
      await submit(
        { attemptId, problemId: retired.id, chosenIndex: 2, confidence: "unsure", hintUsed: false, dontKnow: false },
        { headers },
      ),
    );

    expect((await attemptRow(attemptId)).isCorrect).toBe(true);
    expect(body).toMatchObject({ isCorrect: true, answer: retired.answer, explanation: retired.explanation });
  });

  it("TC-134 서술형 잘 모르겠어요 풀이를 같은 풀이 ID로 다시 보내면 한 줄만 남고 처음과 같은 응답이 와요", async () => {
    const { headers } = await loginConsented();
    const free = await newProblem("free");
    const attemptId = newAttemptId();
    const body = { attemptId, problemId: free.id, answerText: "상태가 바뀌면", hintUsed: false, dontKnow: true };

    const first = await result(await submit(body, { headers }));
    const second = await result(await submit(body, { headers }));

    expect(await attemptRows(attemptId)).toHaveLength(1);
    expect(second).toEqual(first);
    expect(ai.create).not.toHaveBeenCalled();
  });
});
