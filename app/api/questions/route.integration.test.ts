import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { learner, message, question, questionSession, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";
import { POST } from "./route";

const ai = vi.hoisted(() => ({ stream: vi.fn() }));
const afterTasks = vi.hoisted((): Promise<unknown>[] => []);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  after: (task: Promise<unknown>) => afterTasks.push(task),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: ai.stream };
  },
}));

const APP_VERSION = "test-version";
const createdQuestionIds: string[] = [];
const createdSessionIds: string[] = [];

type Chunks = { chunks: string[]; error?: Error; holdBeforeFirst?: Promise<void>; holdAfterFirst?: Promise<void> };

function fakeStream({ chunks, error, holdBeforeFirst, holdAfterFirst }: Chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      await holdBeforeFirst;
      for (const [index, text] of chunks.entries()) {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
        if (index === 0) await holdAfterFirst;
      }
      if (error) throw error;
    },
    finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: chunks.join("") }] }),
  };
}

// SDK처럼 요청에 넘긴 signal이 중단되면 스트림을 오류로 끝낸다.
function aborted(signal: AbortSignal) {
  return new Promise<void>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("요청이 중단됐다.")), { once: true });
  });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function useFakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
}

function aiAnswers(...chunks: string[]) {
  ai.stream.mockImplementation(() => fakeStream({ chunks }));
}

function aiFails(...chunks: string[]) {
  ai.stream.mockImplementationOnce(() => fakeStream({ chunks, error: new Error("AI 오류") }));
}

function newQuestionId() {
  const id = randomUUID();
  createdQuestionIds.push(id);
  return id;
}

function newSessionId() {
  const id = randomUUID();
  createdSessionIds.push(id);
  return id;
}

async function newSession(learnerId: string) {
  const id = newSessionId();
  await getDb().insert(questionSession).values({ id, learnerId });
  return id;
}

async function firstUnit() {
  const [found] = await getDb().select().from(unit).orderBy(asc(unit.id)).limit(1);
  if (!found) throw new Error("테스트 DB에 단원이 없다.");
  return found;
}

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

// 세션 ID를 주지 않으면 요청마다 새 세션으로 보내, 앞 테스트의 대화가 AI에게 넘어가지 않게 한다.
function ask(
  body: { questionId: string; unitId: string; content: string; sessionId?: string },
  { headers = new Headers(), origin = new URL(env.AUTH_URL).origin }: { headers?: Headers; origin?: string } = {},
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  requestHeaders.set("content-type", "application/json");
  return POST(
    new Request(new URL("/api/questions", env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sessionId: newSessionId(), ...body }),
    }),
  );
}

type ServerEvent = { event: string; data: { text?: string } };

function parseEvents(text: string): ServerEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block && !block.startsWith(":"))
    .map((block) => {
      const [event = "", data = ""] = block.split("\n");
      return { event: event.replace("event: ", ""), data: JSON.parse(data.replace("data: ", "")) };
    });
}

async function events(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  return parseEvents(await response.text());
}

function answerText(received: ServerEvent[]) {
  return received.flatMap(({ event, data }) => (event === "delta" ? [data.text] : [])).join("");
}

function questionRows(id: string) {
  return getDb().select().from(question).where(eq(question.id, id));
}

function messageRows(questionId: string) {
  return getDb().select().from(message).where(eq(message.questionId, questionId)).orderBy(asc(message.seq));
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_VERSION);
  aiAnswers("기본 답");
});

afterEach(async () => {
  // 테스트가 중간에 실패해도 가짜 타이머를 기다리던 서버 작업이 끝나야 아래에서 DB를 정리할 수 있다.
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  await Promise.allSettled(afterTasks.splice(0));
  vi.unstubAllEnvs();
  ai.stream.mockReset();
  const ids = createdQuestionIds.splice(0);
  if (ids.length > 0) {
    await getDb().delete(message).where(inArray(message.questionId, ids));
    await getDb().delete(question).where(inArray(question.id, ids));
  }
  const sessionIds = createdSessionIds.splice(0);
  if (sessionIds.length > 0) await getDb().delete(questionSession).where(inArray(questionSession.id, sessionIds));
  await deleteCreatedLearners();
});

describe("질문 보내기", () => {
  it("TC-34 질문을 보내면 AI 답을 돌려주고 질문과 답을 함께 저장해요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    aiAnswers("HAVING은 ", "그룹에 조건을 걸어요.");

    const received = await events(await ask({ questionId, unitId, content: "HAVING은 언제 써요?" }, { headers }));

    expect(received.map(({ event }) => event)).toEqual(["delta", "delta", "done"]);
    expect(answerText(received)).toBe("HAVING은 그룹에 조건을 걸어요.");
    const [saved] = await questionRows(questionId);
    expect(saved).toMatchObject({ learnerId, unitId, appVersion: APP_VERSION, status: "ok" });
    expect(saved?.answeredAt).toBeInstanceOf(Date);
    expect(saved?.studyDay).toBe(studyDay(saved!.askedAt));
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ seq: 1, role: "user", content: "HAVING은 언제 써요?" }),
      expect.objectContaining({ seq: 2, role: "assistant", content: "HAVING은 그룹에 조건을 걸어요." }),
    ]);
  });

  it("TC-35 이미 답한 질문이 다시 오면 저장된 답을 그대로 돌려줘요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    aiAnswers("처음 ", "답");
    await events(await ask({ questionId, unitId, content: "질문" }, { headers }));
    aiAnswers("다시 만든 답");

    const received = await events(await ask({ questionId, unitId, content: "질문" }, { headers }));

    expect(received).toEqual([
      { event: "delta", data: { text: "처음 답" } },
      { event: "done", data: {} },
    ]);
    expect(await questionRows(questionId)).toHaveLength(1);
    expect((await messageRows(questionId)).map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(ai.stream).toHaveBeenCalledTimes(1);
  });

  it("TC-36 답하는 중인 질문이 다시 오면 처리 중이라고 알려요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    const askedAt = new Date();
    await getDb()
      .insert(question)
      .values({
        id: questionId,
        learnerId,
        sessionId: await newSession(learnerId),
        unitId,
        askedAt,
        studyDay: studyDay(askedAt),
        appVersion: APP_VERSION,
      });
    await getDb().insert(message).values({ questionId, seq: 1, role: "user", content: "답하는 중인 질문" });
    const questionsBefore = await questionRows(questionId);
    const messagesBefore = await messageRows(questionId);

    const response = await ask({ questionId, unitId, content: "답하는 중인 질문" }, { headers });

    expect(response.status).toBe(409);
    expect(ai.stream).not.toHaveBeenCalled();
    expect(await questionRows(questionId)).toEqual(questionsBefore);
    expect(await messageRows(questionId)).toEqual(messagesBefore);
  });

  it("TC-37 다른 학습자의 질문 ID로 보내면 거부하고 그 질문을 건드리지 않아요", async () => {
    const a = await loginConsented();
    const b = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    await events(await ask({ questionId, unitId, content: "A의 질문" }, { headers: a.headers }));
    const questionsBefore = await questionRows(questionId);
    const messagesBefore = await messageRows(questionId);
    ai.stream.mockClear();

    const response = await ask({ questionId, unitId, content: "B의 질문" }, { headers: b.headers });

    expect(response.status).toBe(403);
    expect(await questionRows(questionId)).toEqual(questionsBefore);
    expect(await messageRows(questionId)).toEqual(messagesBefore);
    expect(ai.stream).not.toHaveBeenCalled();
  });

  it("TC-38 로그인하지 않았거나 저장에 동의하지 않았으면 질문을 받지 않아요", async () => {
    const { id: unitId } = await firstUnit();
    const anonymousQuestionId = newQuestionId();
    const notConsentedQuestionId = newQuestionId();

    const anonymous = await ask({ questionId: anonymousQuestionId, unitId, content: "로그인 없이 보낸 질문" });
    const { headers } = await loginWithGoogle(newProfile());
    const notConsented = await ask(
      { questionId: notConsentedQuestionId, unitId, content: "동의 없이 보낸 질문" },
      { headers },
    );

    expect(anonymous.status).toBe(401);
    expect(notConsented.status).toBe(403);
    for (const response of [anonymous, notConsented]) expect(response.headers.get("location")).toBeNull();
    for (const id of [anonymousQuestionId, notConsentedQuestionId]) {
      expect(await questionRows(id)).toEqual([]);
      expect(await messageRows(id)).toEqual([]);
    }
    expect(ai.stream).not.toHaveBeenCalled();
  });

  it("TC-39 AI가 답하지 못하면 실패를 돌려주고 질문을 error로 남겨요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    aiFails();

    const received = await events(await ask({ questionId, unitId, content: "실패할 질문" }, { headers }));

    expect(received).toEqual([{ event: "error", data: {} }]);
    const [saved] = await questionRows(questionId);
    expect(saved).toMatchObject({ status: "error", answeredAt: null });
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ seq: 1, role: "user", content: "실패할 질문" }),
    ]);
  });

  it("TC-40 실패한 질문을 다시 보내면 같은 줄에 처음 질문으로 답을 받아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    aiFails();
    await events(await ask({ questionId, unitId, content: "처음 질문" }, { headers }));
    aiAnswers("다시 받은 답");

    const received = await events(await ask({ questionId, unitId, content: "바꾼 질문" }, { headers }));

    expect(received.at(-1)?.event).toBe("done");
    expect(answerText(received)).toBe("다시 받은 답");
    const saved = await questionRows(questionId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.status).toBe("ok");
    expect(saved[0]?.answeredAt).toBeInstanceOf(Date);
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ role: "user", content: "처음 질문" }),
      expect.objectContaining({ role: "assistant", content: "다시 받은 답" }),
    ]);
    const lastRequest = JSON.stringify(ai.stream.mock.lastCall);
    expect(lastRequest).toContain("처음 질문");
    expect(lastRequest).not.toContain("바꾼 질문");
  });

  it("TC-42 열려 있던 단원 본문을 AI에게 넘겨요", async () => {
    const { headers } = await loginConsented();
    const opened = await firstUnit();

    await events(await ask({ questionId: newQuestionId(), unitId: opened.id, content: "이 단원 질문" }, { headers }));

    const sent = JSON.stringify(ai.stream.mock.lastCall);
    expect(sent).toContain(JSON.stringify(opened.content).slice(1, -1));
    expect(sent).toContain("이 단원 질문");
  });

  it("TC-43 빈 질문은 받지 않고 아무것도 저장하지 않아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();

    const response = await ask({ questionId, unitId, content: " \n\t " }, { headers });

    expect(response.status).toBe(400);
    expect(await questionRows(questionId)).toEqual([]);
    expect(await messageRows(questionId)).toEqual([]);
    expect(ai.stream).not.toHaveBeenCalled();
  });

  it("TC-45 답을 보내는 도중 AI가 실패하면 실패로 끝내고 질문을 error로 남겨요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    aiFails("답의 ", "앞부분");

    const received = await events(await ask({ questionId, unitId, content: "도중에 실패할 질문" }, { headers }));

    expect(received.map(({ event }) => event)).toEqual(["delta", "delta", "error"]);
    expect(answerText(received)).toBe("답의 앞부분");
    const [saved] = await questionRows(questionId);
    expect(saved).toMatchObject({ status: "error", answeredAt: null });
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ seq: 1, role: "user", content: "도중에 실패할 질문" }),
    ]);
  });

  it("TC-46 답을 받는 도중 연결을 끊어도 서버가 답을 끝까지 저장해요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    const { promise: disconnected, resolve: disconnect } = Promise.withResolvers<void>();
    ai.stream.mockImplementationOnce(() =>
      fakeStream({ chunks: ["끊기 전 ", "끊긴 뒤 ", "끝"], holdAfterFirst: disconnected }),
    );

    const response = await ask({ questionId, unitId, content: "끊길 질문" }, { headers });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const { value: first } = await reader.read();
    expect(parseEvents(first ?? "")).toEqual([{ event: "delta", data: { text: "끊기 전 " } }]);
    await reader.cancel();
    disconnect();
    await Promise.all(afterTasks.splice(0));

    const [saved] = await questionRows(questionId);
    expect(saved?.status).toBe("ok");
    expect(saved?.answeredAt).toBeInstanceOf(Date);
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ role: "user", content: "끊길 질문" }),
      expect.objectContaining({ role: "assistant", content: "끊기 전 끊긴 뒤 끝" }),
    ]);

    const again = await events(await ask({ questionId, unitId, content: "끊길 질문" }, { headers }));
    expect(answerText(again)).toBe("끊기 전 끊긴 뒤 끝");
    expect(ai.stream).toHaveBeenCalledTimes(1);
  });

  it("TC-47 다른 사이트에서 보낸 질문 요청은 받지 않아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();

    const response = await ask(
      { questionId, unitId, content: "다른 사이트의 질문" },
      { headers, origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect(await questionRows(questionId)).toEqual([]);
    expect(await messageRows(questionId)).toEqual([]);
    expect(ai.stream).not.toHaveBeenCalled();
  });
  it("TC-48 AI가 60초 안에 답을 시작하지 않으면 실패로 끝내고 질문을 error로 남겨요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    ai.stream.mockImplementationOnce((_params: unknown, { signal }: { signal: AbortSignal }) =>
      fakeStream({ chunks: ["늦은 답"], holdBeforeFirst: aborted(signal) }),
    );
    useFakeTimers();

    const response = await ask({ questionId, unitId, content: "답이 늦을 질문" }, { headers });
    await vi.waitFor(() => expect(ai.stream).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(55_000);
    expect((await questionRows(questionId))[0]?.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(5_000);
    const received = await events(response);

    expect(received).toEqual([{ event: "error", data: {} }]);
    const [saved] = await questionRows(questionId);
    expect(saved).toMatchObject({ status: "error", answeredAt: null });
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ seq: 1, role: "user", content: "답이 늦을 질문" }),
    ]);
  });

  it("TC-49 AI의 답을 기다리는 동안 연결 유지 신호를 보내요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    useFakeTimers();
    ai.stream.mockImplementationOnce(() => fakeStream({ chunks: ["기다린 ", "답"], holdBeforeFirst: wait(16_000) }));

    const response = await ask({ questionId, unitId, content: "오래 생각할 질문" }, { headers });
    await vi.waitFor(() => expect(ai.stream).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(16_000);
    const text = await response.text();

    expect(text.indexOf(": ping\n\n")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(": ping\n\n")).toBeLessThan(text.indexOf("event: delta"));
    const received = parseEvents(text);
    expect(received.map(({ event }) => event)).toEqual(["delta", "delta", "done"]);
    expect(answerText(received)).toBe("기다린 답");
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ role: "user", content: "오래 생각할 질문" }),
      expect.objectContaining({ role: "assistant", content: "기다린 답" }),
    ]);
  });

  it("TC-50 실패한 질문을 동시에 다시 보내면 한 요청만 답을 받고 나머지는 처리 중이라고 알려요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const questionId = newQuestionId();
    const askedAt = new Date();
    await getDb().insert(question).values({
      id: questionId,
      learnerId,
      sessionId: await newSession(learnerId),
      unitId,
      askedAt,
      studyDay: studyDay(askedAt),
      appVersion: APP_VERSION,
      status: "error",
    });
    await getDb().insert(message).values({ questionId, seq: 1, role: "user", content: "실패했던 질문" });
    // 먼저 가져간 요청이 답을 끝내기 전에 두 요청이 모두 응답을 받아야 나머지 요청이 처리 중인 줄을 본다.
    const bothResponded = Promise.withResolvers<void>();
    ai.stream.mockImplementation(() =>
      fakeStream({ chunks: ["동시에 받은 답"], holdBeforeFirst: bothResponded.promise }),
    );

    // 두 요청이 모두 error를 읽고 상태를 바꾸려는 순간까지 줄을 잠가 둔다. 확인과 갱신이 나뉜 구현이면 둘 다 답을 받는다.
    let asking: Promise<Response[]> | undefined;
    await getDb().transaction(async (tx) => {
      await tx.select({ id: question.id }).from(question).where(eq(question.id, questionId)).for("update");
      asking = Promise.all([
        ask({ questionId, unitId, content: "실패했던 질문" }, { headers }),
        ask({ questionId, unitId, content: "실패했던 질문" }, { headers }),
      ]);
      await vi.waitFor(
        async () => {
          const { rows } = await tx.execute<{ blocked: number }>(
            // 두 번째 요청은 잠금을 쥔 이 트랜잭션이 아니라 먼저 기다리는 요청을 기다린다.
            sql`with waiting as (select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity)
                select count(*)::int as blocked from waiting
                where pg_backend_pid() = any(blockers)
                   or exists (select 1 from waiting first where pg_backend_pid() = any(first.blockers) and first.pid = any(waiting.blockers))`,
          );
          expect(rows[0]?.blocked).toBe(2);
        },
        { timeout: 10_000, interval: 50 },
      );
    });
    if (!asking) throw new Error("질문을 보내지 못했다.");
    const responses = await asking.finally(bothResponded.resolve);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const answered = responses.find(({ status }) => status === 200);
    if (!answered) throw new Error("답을 받은 요청이 없다.");
    const received = await events(answered);
    expect(received.at(-1)?.event).toBe("done");
    expect(answerText(received)).toBe("동시에 받은 답");
    const saved = await questionRows(questionId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.status).toBe("ok");
    expect(await messageRows(questionId)).toEqual([
      expect.objectContaining({ role: "user", content: "실패했던 질문" }),
      expect.objectContaining({ role: "assistant", content: "동시에 받은 답" }),
    ]);
    expect(ai.stream).toHaveBeenCalledTimes(1);
  });
});

function sessionRows(id: string) {
  return getDb().select().from(questionSession).where(eq(questionSession.id, id));
}

function questionsInSession(sessionId: string) {
  return getDb().select().from(question).where(eq(question.sessionId, sessionId)).orderBy(asc(question.askedAt));
}

function sentConversation() {
  const [params] = ai.stream.mock.lastCall ?? [];
  return (params as { messages: unknown[] }).messages;
}

describe("대화 세션", () => {
  it("TC-75 새 대화에서 첫 질문을 보내면 세션이 생기고, 같은 대화의 다음 질문도 그 세션에 저장돼요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const sessionId = newSessionId();
    const first = newQuestionId();
    const second = newQuestionId();

    await events(await ask({ questionId: first, unitId, content: "첫 질문", sessionId }, { headers }));
    await events(await ask({ questionId: second, unitId, content: "다음 질문", sessionId }, { headers }));

    expect(await sessionRows(sessionId)).toEqual([expect.objectContaining({ id: sessionId, learnerId })]);
    expect((await questionsInSession(sessionId)).map(({ id }) => id)).toEqual([first, second]);
  });

  it("TC-76 다른 학습자의 세션 ID로 질문을 보내면 거부하고 아무것도 저장하지 않아요", async () => {
    const a = await loginConsented();
    const b = await loginConsented();
    const { id: unitId } = await firstUnit();
    const sessionId = newSessionId();
    await events(await ask({ questionId: newQuestionId(), unitId, content: "A의 질문", sessionId }, { headers: a.headers }));
    const sessionBefore = await sessionRows(sessionId);
    const questionsBefore = await questionsInSession(sessionId);
    ai.stream.mockClear();
    const questionId = newQuestionId();

    const response = await ask({ questionId, unitId, content: "B의 질문", sessionId }, { headers: b.headers });

    expect(response.status).toBe(403);
    expect(await questionRows(questionId)).toEqual([]);
    expect(await messageRows(questionId)).toEqual([]);
    expect(await sessionRows(sessionId)).toEqual(sessionBefore);
    expect(await questionsInSession(sessionId)).toEqual(questionsBefore);
    expect(ai.stream).not.toHaveBeenCalled();
  });

  it("TC-81 실패한 질문을 다시 보내면 다른 세션 ID가 와도 처음 세션에 남아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const first = newSessionId();
    const other = newSessionId();
    const questionId = newQuestionId();
    aiFails();
    await events(await ask({ questionId, unitId, content: "실패할 질문", sessionId: first }, { headers }));
    await events(await ask({ questionId: newQuestionId(), unitId, content: "다른 대화 질문", sessionId: other }, { headers }));
    aiAnswers("다시 받은 답");

    const received = await events(await ask({ questionId, unitId, content: "실패할 질문", sessionId: other }, { headers }));

    expect(received.at(-1)?.event).toBe("done");
    expect(answerText(received)).toBe("다시 받은 답");
    expect((await questionRows(questionId))[0]?.sessionId).toBe(first);
    expect((await questionsInSession(other)).map(({ id }) => id)).not.toContain(questionId);
  });

  it("TC-83 세션 ID가 없거나 형식이 맞지 않으면 질문을 받지 않고 아무것도 저장하지 않아요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const missing = newQuestionId();
    const malformed = newQuestionId();

    const withoutSession = await ask({ questionId: missing, unitId, content: "세션 없는 질문", sessionId: undefined }, { headers });
    const badSession = await ask({ questionId: malformed, unitId, content: "형식이 틀린 세션", sessionId: "not-a-uuid" }, { headers });

    expect(withoutSession.status).toBe(400);
    expect(badSession.status).toBe(400);
    for (const id of [missing, malformed]) {
      expect(await questionRows(id)).toEqual([]);
      expect(await messageRows(id)).toEqual([]);
    }
    expect(await getDb().select().from(questionSession).where(eq(questionSession.learnerId, learnerId))).toEqual([]);
    expect(ai.stream).not.toHaveBeenCalled();
  });

  it("TC-84 같은 세션에서 답을 받은 이전 질문과 답만 순서대로 AI에게 넘기고, 다른 세션 대화는 넘기지 않아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const current = newSessionId();
    const other = newSessionId();
    aiAnswers("A1");
    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q1", sessionId: current }, { headers }));
    aiFails();
    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q2", sessionId: current }, { headers }));
    aiAnswers("A3");
    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q3", sessionId: other }, { headers }));
    aiAnswers("A4");

    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q4", sessionId: current }, { headers }));

    expect(sentConversation()).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q4" },
    ]);
  });

  it("TC-85 실패한 질문을 다시 보내면 그 질문보다 먼저 물은 대화만 AI에게 넘겨요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const sessionId = newSessionId();
    const failed = newQuestionId();
    aiAnswers("A1");
    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q1", sessionId }, { headers }));
    aiFails();
    await events(await ask({ questionId: failed, unitId, content: "Q2", sessionId }, { headers }));
    aiAnswers("A3");
    await events(await ask({ questionId: newQuestionId(), unitId, content: "Q3", sessionId }, { headers }));
    aiAnswers("A2");

    await events(await ask({ questionId: failed, unitId, content: "Q2", sessionId }, { headers }));

    expect(sentConversation()).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
  });
});
