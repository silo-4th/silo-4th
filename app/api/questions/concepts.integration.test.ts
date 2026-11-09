import { randomUUID } from "node:crypto";
import { asc, eq, inArray, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { concept, learner, message, question, questionConcept, questionSession, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";
import { POST } from "./route";

const ai = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn() }));
const afterTasks = vi.hoisted((): Promise<unknown>[] => []);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  after: (task: Promise<unknown>) => afterTasks.push(task),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: ai.stream, create: ai.create };
  },
}));

const APP_VERSION = "test-version";
const createdQuestionIds: string[] = [];
const createdConceptIds: string[] = [];
const createdSessionIds: string[] = [];

function fakeStream({ chunks, error }: { chunks: string[]; error?: Error }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
      if (error) throw error;
    },
    finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: chunks.join("") }] }),
  };
}

function aiAnswers(...chunks: string[]) {
  ai.stream.mockImplementation(() => fakeStream({ chunks }));
}

function aiFails() {
  ai.stream.mockImplementationOnce(() => fakeStream({ chunks: [], error: new Error("AI 오류") }));
}

function jsonReply(value: object) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] };
}

// 분류는 답하기 전에, 요약은 답한 뒤에 부르므로 순서대로 한 번씩 정해 둔다.
function aiClassifies(conceptIds: string[], keywords: string[] = []) {
  ai.create.mockResolvedValueOnce(jsonReply({ conceptIds, keywords }));
}

function aiSummarizes(summary: string, keywords: string[]) {
  ai.create.mockResolvedValueOnce(jsonReply({ summary, keywords }));
}

function useFakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
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

async function firstUnit() {
  const [found] = await getDb().select().from(unit).orderBy(asc(unit.id)).limit(1);
  if (!found) throw new Error("테스트 DB에 단원이 없다.");
  return found;
}

async function newConcepts(count: number) {
  const { id: unitId } = await firstUnit();
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `test-${randomUUID()}`,
    unitId,
    title: `테스트 개념 ${index + 1}`,
  }));
  createdConceptIds.push(...rows.map(({ id }) => id));
  await getDb().insert(concept).values(rows);
  return rows.map(({ id }) => id);
}

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

async function pastQuestion(
  learnerId: string,
  {
    summary,
    keywords = [],
    conceptIds = [],
    askedAt = new Date(),
    sessionId,
    turn,
  }: {
    summary: string;
    keywords?: string[];
    conceptIds?: string[];
    askedAt?: Date;
    // 주지 않으면 질문마다 새 대화에 둔다.
    sessionId?: string;
    turn?: { question: string; answer: string };
  },
) {
  const { id: unitId } = await firstUnit();
  const id = newQuestionId();
  sessionId ??= await newSession(learnerId);
  await getDb().insert(question).values({
    id,
    learnerId,
    sessionId,
    unitId,
    askedAt,
    studyDay: studyDay(askedAt),
    appVersion: APP_VERSION,
    status: "ok",
    answeredAt: askedAt,
    summary,
    keywords,
    summarizedAt: askedAt,
  });
  if (conceptIds.length > 0) {
    await getDb()
      .insert(questionConcept)
      .values(conceptIds.map((conceptId) => ({ questionId: id, conceptId })));
  }
  if (turn) {
    await getDb()
      .insert(message)
      .values([
        { questionId: id, seq: 1, role: "user", content: turn.question },
        { questionId: id, seq: 2, role: "assistant", content: turn.answer },
      ]);
  }
}

async function newSession(learnerId: string) {
  const id = newSessionId();
  await getDb().insert(questionSession).values({ id, learnerId });
  return id;
}

// 요청마다 새 세션으로 보내, 같은 세션의 앞 대화가 아니라 과거 요약만 AI에게 넘어가는지 본다.
function ask(body: { questionId: string; unitId: string; content: string; sessionId?: string }, headers: Headers) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", new URL(env.AUTH_URL).origin);
  requestHeaders.set("content-type", "application/json");
  return POST(
    new Request(new URL("/api/questions", env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sessionId: newSessionId(), ...body }),
    }),
  );
}

async function events(response: Response) {
  expect(response.status).toBe(200);
  return (await response.text())
    .split("\n\n")
    .filter((block) => block && !block.startsWith(":"))
    .map((block) => block.split("\n")[0]?.replace("event: ", ""));
}

async function afterResponse() {
  await Promise.all(afterTasks.splice(0));
}

function questionRow(id: string) {
  return getDb()
    .select()
    .from(question)
    .where(eq(question.id, id))
    .then(([row]) => row);
}

function linkedConcepts(questionId: string) {
  return getDb()
    .select({ conceptId: questionConcept.conceptId })
    .from(questionConcept)
    .where(eq(questionConcept.questionId, questionId))
    .then((rows) => rows.map(({ conceptId }) => conceptId));
}

function sentToAnswerAi() {
  return JSON.stringify(ai.stream.mock.lastCall);
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_VERSION);
  aiAnswers("기본 답");
  ai.create.mockRejectedValue(new Error("정하지 않은 AI 호출"));
});

afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  await Promise.allSettled(afterTasks.splice(0));
  vi.unstubAllEnvs();
  ai.stream.mockReset();
  ai.create.mockReset();
  const questionIds = createdQuestionIds.splice(0);
  const conceptIds = createdConceptIds.splice(0);
  const db = getDb();
  if (questionIds.length > 0 || conceptIds.length > 0) {
    await db
      .delete(questionConcept)
      .where(
        or(
          inArray(questionConcept.questionId, questionIds.length > 0 ? questionIds : [randomUUID()]),
          inArray(questionConcept.conceptId, conceptIds.length > 0 ? conceptIds : [""]),
        ),
      );
  }
  if (questionIds.length > 0) {
    await db.delete(message).where(inArray(message.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  const sessionIds = createdSessionIds.splice(0);
  if (sessionIds.length > 0) await db.delete(questionSession).where(inArray(questionSession.id, sessionIds));
  if (conceptIds.length > 0) await db.delete(concept).where(inArray(concept.id, conceptIds));
  await deleteCreatedLearners();
});

describe("질문 개념 분류와 요약", () => {
  it("TC-180 AI가 개념을 여러 개 골라도 질문에는 목록에 있는 첫 번째 개념 하나만 연결돼요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x, y] = await newConcepts(3);
    aiClassifies([`unknown-${randomUUID()}`, x!, y!]);
    const questionId = newQuestionId();

    await events(await ask({ questionId, unitId, content: "개념을 고를 질문" }, headers));

    expect(await linkedConcepts(questionId)).toEqual([x]);
  });

  it("TC-62 답을 받은 질문에 요약과 키워드가 채워져요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    aiAnswers("GROUP BY 뒤에 ", "HAVING을 써요.");
    aiClassifies([]);
    aiSummarizes("HAVING은 그룹에 조건을 거는 절이라고 답했다.", ["HAVING", "group by"]);
    const questionId = newQuestionId();

    const received = await events(await ask({ questionId, unitId, content: "HAVING은 어디에 써요?" }, headers));
    await afterResponse();

    expect(received.at(-1)).toBe("done");
    const saved = await questionRow(questionId);
    expect(saved?.summary).toBe("HAVING은 그룹에 조건을 거는 절이라고 답했다.");
    expect(saved?.keywords).toEqual(["having", "group by"]);
    expect(saved?.summarizedAt).toBeInstanceOf(Date);
  });

  it("TC-63 같은 개념으로 물었던 내 과거 질문 요약만 답변 AI에게 넘겨요", async () => {
    const me = await loginConsented();
    const other = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x, y] = await newConcepts(2);
    await pastQuestion(me.learnerId, { summary: "과거 요약 A", conceptIds: [x!] });
    await pastQuestion(other.learnerId, { summary: "과거 요약 B", conceptIds: [x!] });
    await pastQuestion(me.learnerId, { summary: "과거 요약 C", conceptIds: [y!] });
    aiClassifies([x!]);

    await events(await ask({ questionId: newQuestionId(), unitId, content: "개념 X 질문" }, me.headers));

    const sent = sentToAnswerAi();
    expect(sent).toContain("과거 요약 A");
    expect(sent).not.toContain("과거 요약 B");
    expect(sent).not.toContain("과거 요약 C");
  });

  it("TC-86 지금 대화의 질문은 과거 요약으로 다시 넘기지 않아요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x] = await newConcepts(1);
    const sessionId = await newSession(learnerId);
    await pastQuestion(learnerId, {
      summary: "과거 요약 A",
      conceptIds: [x!],
      sessionId,
      turn: { question: "같은 대화의 앞 질문", answer: "같은 대화의 앞 답" },
    });
    await pastQuestion(learnerId, { summary: "과거 요약 B", conceptIds: [x!] });
    aiClassifies([x!]);

    await events(await ask({ questionId: newQuestionId(), unitId, content: "개념 X 질문", sessionId }, headers));

    const sent = sentToAnswerAi();
    expect(sent).toContain("같은 대화의 앞 질문");
    expect(sent).toContain("같은 대화의 앞 답");
    expect(sent).not.toContain("과거 요약 A");
    expect(sent).toContain("과거 요약 B");
  });

  it("TC-64 개념 분류가 실패해도 답을 받고 질문은 ok로 남아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();

    ai.create.mockRejectedValueOnce(new Error("분류 오류"));
    const failedId = newQuestionId();
    const failed = await events(await ask({ questionId: failedId, unitId, content: "분류가 실패할 질문" }, headers));
    await afterResponse();
    ai.create.mockClear();

    useFakeTimers();
    ai.create.mockImplementationOnce(
      (_params: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("요청이 중단됐다.")), { once: true });
        }),
    );
    const slowId = newQuestionId();
    const slowResponse = ask({ questionId: slowId, unitId, content: "분류가 늦을 질문" }, headers);
    // 분류를 부르기 전에 원격 DB를 여러 번 오가므로 기본 1초보다 넉넉히 기다린다.
    await vi.waitFor(() => expect(ai.create).toHaveBeenCalled(), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const slow = await events(await slowResponse);

    for (const [received, id] of [
      [failed, failedId],
      [slow, slowId],
    ] as const) {
      expect(received).toEqual(["delta", "done"]);
      expect((await questionRow(id))?.status).toBe("ok");
      expect(await linkedConcepts(id)).toEqual([]);
    }
  });

  it("TC-65 요약을 만들지 못해도 답은 ok로 남고 요약은 비어 있어요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    aiAnswers("요약되지 않을 답");
    aiClassifies([]);
    ai.create.mockRejectedValueOnce(new Error("요약 오류"));
    const questionId = newQuestionId();

    const received = await events(await ask({ questionId, unitId, content: "요약이 실패할 질문" }, headers));
    await afterResponse();

    expect(received.at(-1)).toBe("done");
    const saved = await questionRow(questionId);
    expect(saved).toMatchObject({ status: "ok", summary: null, keywords: null, summarizedAt: null });
    const [answer] = await getDb()
      .select()
      .from(message)
      .where(eq(message.questionId, questionId))
      .orderBy(asc(message.seq))
      .offset(1);
    expect(answer).toMatchObject({ seq: 2, role: "assistant", content: "요약되지 않을 답" });
  });

  it("TC-67 실패한 질문을 다시 보내도 개념 연결이 겹치지 않고 답을 받아요", async () => {
    const { headers } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x] = await newConcepts(1);
    const questionId = newQuestionId();
    ai.create.mockResolvedValue(jsonReply({ conceptIds: [x], keywords: [] }));
    aiFails();
    await events(await ask({ questionId, unitId, content: "다시 보낼 질문" }, headers));
    expect((await questionRow(questionId))?.status).toBe("error");
    expect(await linkedConcepts(questionId)).toEqual([x]);
    aiAnswers("다시 받은 답");
    await afterResponse();
    ai.create.mockClear();

    const received = await events(await ask({ questionId, unitId, content: "다시 보낼 질문" }, headers));
    await afterResponse();

    expect(received.at(-1)).toBe("done");
    expect((await questionRow(questionId))?.status).toBe("ok");
    expect(await linkedConcepts(questionId)).toEqual([x]);
    expect(ai.create, "분류 AI는 다시 부르지 않고 요약만 한 번 부름").toHaveBeenCalledTimes(1);
  });

  it("TC-68 과거 질문이 많으면 최근 5개의 요약만 넘겨요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x] = await newConcepts(1);
    const now = Date.now();
    for (let order = 1; order <= 6; order++) {
      await pastQuestion(learnerId, {
        summary: `과거 요약 ${order}번째`,
        conceptIds: [x!],
        askedAt: new Date(now - (7 - order) * 60_000),
      });
    }
    aiClassifies([x!]);

    await events(await ask({ questionId: newQuestionId(), unitId, content: "개념 X 질문" }, headers));

    const sent = sentToAnswerAi();
    for (let order = 2; order <= 6; order++) expect(sent).toContain(`과거 요약 ${order}번째`);
    expect(sent).not.toContain("과거 요약 1번째");
  });

  it("TC-69 개념 목록에 없는 질문이면 키워드가 겹치는 내 과거 질문 요약을 넘겨요", async () => {
    const me = await loginConsented();
    const other = await loginConsented();
    const { id: unitId } = await firstUnit();
    await pastQuestion(me.learnerId, { summary: "과거 요약 A", keywords: ["인덱스", "sql"] });
    await pastQuestion(me.learnerId, { summary: "과거 요약 B", keywords: ["sql"] });
    await pastQuestion(other.learnerId, { summary: "과거 요약 D", keywords: ["인덱스"] });
    aiClassifies([], ["인덱스"]);

    await events(await ask({ questionId: newQuestionId(), unitId, content: "인덱스는 왜 빨라요?" }, me.headers));

    const sent = sentToAnswerAi();
    expect(sent).toContain("과거 요약 A");
    expect(sent).not.toContain("과거 요약 B");
    expect(sent).not.toContain("과거 요약 D");
  });

  it("TC-242 답변 AI에게 넘기는 과거 질문 요약마다 한국 시간 기준으로 물어본 날짜를 M/D로 붙여요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { id: unitId } = await firstUnit();
    const [x] = await newConcepts(1);
    await pastQuestion(learnerId, {
      summary: "과거 요약 A",
      conceptIds: [x!],
      askedAt: new Date("2026-11-04T16:00:00Z"),
    });
    await pastQuestion(learnerId, {
      summary: "과거 요약 B",
      conceptIds: [x!],
      askedAt: new Date("2026-11-06T03:00:00Z"),
    });
    aiClassifies([x!]);

    await events(await ask({ questionId: newQuestionId(), unitId, content: "개념 X 질문" }, headers));

    const [request] = ai.stream.mock.lastCall as [{ system: { text: string }[] }];
    const pastBlock = request.system.find(({ text }) => text.includes("<past_questions>"))?.text;
    expect(pastBlock).toContain("- 11/5 · 과거 요약 A\n- 11/6 · 과거 요약 B");
    expect(pastBlock).toContain("줄 앞의 날짜는 물어본 날이다.");
  });
});
