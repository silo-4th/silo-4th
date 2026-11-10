import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { concept, learner, message, question, questionConcept, questionSession, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
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

const EASIER = "이 부분을 쉽게 설명해줘";
const createdQuestionIds: string[] = [];
const createdConceptIds: string[] = [];
const createdSessionIds: string[] = [];

type AskBody = {
  questionId: string;
  unitId: string;
  content: string;
  sessionId?: string;
  selectedText?: string;
  sectionConceptId?: string;
};
type SentMessage = { role: string; content: string };

function fakeStream({ chunks, error }: { chunks: string[]; error?: Error }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
      if (error) throw error;
    },
    finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: chunks.join("") }] }),
  };
}

function jsonReply(value: object) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] };
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

async function twoUnits() {
  const [first, second] = await getDb().select().from(unit).orderBy(asc(unit.id)).limit(2);
  if (!first || !second) throw new Error("테스트 DB에 단원이 두 개 이상 있어야 한다.");
  return [first, second] as const;
}

async function newConcepts(unitId: string, count: number) {
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
  return { headers };
}

function ask(body: AskBody, headers: Headers) {
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

function userMessage(questionId: string) {
  return getDb()
    .select({ content: message.content, selectedText: message.selectedText })
    .from(message)
    .where(and(eq(message.questionId, questionId), eq(message.seq, 1)))
    .then(([row]) => row);
}

function linkedConcepts(questionId: string) {
  return getDb()
    .select({ conceptId: questionConcept.conceptId })
    .from(questionConcept)
    .where(eq(questionConcept.questionId, questionId))
    .then((rows) => rows.map(({ conceptId }) => conceptId));
}

function sentMessages(call: unknown) {
  const [request] = call as [{ messages: SentMessage[] }];
  return request.messages;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "test-version");
  ai.stream.mockImplementation(() => fakeStream({ chunks: ["기본 답"] }));
  ai.create.mockRejectedValue(new Error("정하지 않은 AI 호출"));
});

afterEach(async () => {
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

describe("드래그한 문장으로 질문", () => {
  it("TC-266 선택한 문장과 절을 함께 보낸 질문은 문장을 저장하고 그 절의 개념 하나를 질문에 연결해요", async () => {
    const { headers } = await loginConsented();
    const [{ id: unitId }] = await twoUnits();
    const [section, other] = await newConcepts(unitId, 2);
    ai.create.mockResolvedValue(jsonReply({ conceptIds: [other], keywords: [] }));
    const selectedText = "GROUP BY는 같은 값을 가진 행을 한 그룹으로 묶어요.";
    const questionId = newQuestionId();

    const received = await events(
      await ask({ questionId, unitId, content: EASIER, selectedText, sectionConceptId: section }, headers),
    );
    await afterResponse();

    expect(received.at(-1)).toBe("done");
    expect(await userMessage(questionId)).toEqual({ content: EASIER, selectedText });
    expect(await linkedConcepts(questionId)).toEqual([section]);

    const typedId = newQuestionId();
    await events(await ask({ questionId: typedId, unitId, content: "HAVING은 어디에 써요?" }, headers));
    await afterResponse();

    expect(await userMessage(typedId)).toEqual({ content: "HAVING은 어디에 써요?", selectedText: null });
  });

  it("TC-267 답변 AI에 선택한 문장을 질문과 함께 넘기고, 다시 시도할 때도 저장한 문장으로 물어요", async () => {
    const { headers } = await loginConsented();
    const [{ id: unitId }] = await twoUnits();
    const [section] = await newConcepts(unitId, 1);
    const selectedText = "HAVING은 묶은 그룹에 조건을 걸어요.";
    const sessionId = newSessionId();
    const questionId = newQuestionId();
    const body = { questionId, sessionId, unitId, content: EASIER, selectedText, sectionConceptId: section! };
    ai.stream.mockImplementationOnce(() => fakeStream({ chunks: [], error: new Error("AI 오류") }));

    expect((await events(await ask(body, headers))).at(-1)).toBe("error");
    await afterResponse();
    expect((await events(await ask(body, headers))).at(-1)).toBe("done");
    await afterResponse();

    const [failed, retried] = ai.stream.mock.calls;
    for (const call of [failed, retried]) {
      const asked = sentMessages(call).at(-1);
      expect(asked?.role).toBe("user");
      expect(asked?.content).toContain(selectedText);
      expect(asked?.content).toContain(EASIER);
    }

    await events(await ask({ questionId: newQuestionId(), sessionId, unitId, content: "더 쉽게 알려줘" }, headers));
    await afterResponse();

    const history = sentMessages(ai.stream.mock.lastCall).slice(0, -1);
    const earlier = history.find(({ role, content }) => role === "user" && content.includes(EASIER));
    expect(earlier?.content).toContain(selectedText);
  });

  it("TC-268 그 단원에 없는 절 개념이나 1500자를 넘는 문장을 보내면 질문을 저장하지 않고 거절해요", async () => {
    const { headers } = await loginConsented();
    const [opened, other] = await twoUnits();
    const [openedConcept] = await newConcepts(opened.id, 1);
    const [otherConcept] = await newConcepts(other.id, 1);
    const wrongSectionId = newQuestionId();
    const tooLongId = newQuestionId();

    const wrongSection = await ask(
      {
        questionId: wrongSectionId,
        unitId: opened.id,
        content: EASIER,
        selectedText: "다른 단원의 절 개념을 붙인 문장",
        sectionConceptId: otherConcept,
      },
      headers,
    );
    const tooLong = await ask(
      {
        questionId: tooLongId,
        unitId: opened.id,
        content: EASIER,
        selectedText: "가".repeat(1501),
        sectionConceptId: openedConcept,
      },
      headers,
    );

    expect(wrongSection.status).toBe(400);
    expect(tooLong.status).toBe(400);
    const ids = [wrongSectionId, tooLongId];
    const db = getDb();
    expect(await db.select().from(question).where(inArray(question.id, ids))).toEqual([]);
    expect(await db.select().from(message).where(inArray(message.questionId, ids))).toEqual([]);
    expect(await db.select().from(questionConcept).where(inArray(questionConcept.questionId, ids))).toEqual([]);
  });
});
