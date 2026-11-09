import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCreatedLearners,
  learnerWithEmail,
  loginWithGoogle,
  newProfile,
} from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import {
  concept,
  learner,
  message,
  type QuizAnswer,
  quizAttempt,
  quizProblem,
  question,
  questionConcept,
  questionSession,
  sectionView,
  unit,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { QUIZ_GENERATION_TIMEOUT_MS } from "@/lib/llm/quiz-generation";
import { studyDay } from "@/lib/study-day";
import { POST } from "./route";

type CreateParams = { messages: { role: string; content: string }[] };
type CreateOptions = { signal: AbortSignal };

const ai = vi.hoisted(() => ({
  create:
    vi.fn<(params: CreateParams, options: CreateOptions) => Promise<unknown>>(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: ai.create };
  },
}));

const APP_VERSION = "test-version";
const UNIT_ID = "s2-05";
const OTHER_UNIT_ID = "s2-07";
const DAY_MS = 24 * 60 * 60 * 1000;

const createdLearnerIds: string[] = [];
const createdProblemIds: string[] = [];
const createdQuestionIds: string[] = [];
const createdSessionIds: string[] = [];
const createdAttemptIds: string[] = [];

const CHOICE_ANSWER: QuizAnswer = {
  choices: [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
  answerIndex: 0,
};

const CODE_BLOCK = "```js\nconst count = 1;\nconsole.log(count);\n```";

type Format = "mcq" | "blank" | "free";

// 서버가 정한 형식에 맞는 AI 출력이다. 응답에 새면 안 되는 필드를 일부러 함께 담는다.
function generatedProblem(format: Format) {
  const common = {
    hint: `${format} 생성 힌트`,
    explanation: `${format} 생성 해설`,
    code: "console.log(count);",
  };
  switch (format) {
    case "mcq":
      return {
        ...common,
        stem: `다음 코드가 출력하는 값은 무엇인가요?\n\n${CODE_BLOCK}`,
        answer: {
          choices: [
            { text: "1", misconception: "없음" },
            { text: "0", misconception: "초기값과 헷갈림" },
            { text: "undefined", misconception: "선언 전 접근으로 착각" },
            { text: "오류", misconception: "const 재할당으로 착각" },
          ],
          answerIndex: 0,
        },
      };
    case "blank":
      return {
        ...common,
        stem: `다음 코드에서 값을 바꿀 수 없게 선언하는 키워드는 ____예요.\n\n${CODE_BLOCK}`,
        answer: { accepted: ["const"] },
      };
    case "free":
      return {
        ...common,
        stem: `다음 코드에서 const를 쓴 이유를 설명하세요.\n\n${CODE_BLOCK}`,
        answer: {
          modelAnswer: "값을 다시 할당하지 않으므로 const로 선언한다.",
          keyPoints: ["다시 할당하지 않음"],
        },
      };
  }
}

function jsonReply(value: object) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function requestedFormat(prompt: string): Format {
  const found = /<format>(mcq|blank|free)<\/format>/.exec(prompt)?.[1];
  if (found === "mcq" || found === "blank" || found === "free") return found;
  throw new Error("프롬프트에 형식이 없다.");
}

// 부를 때마다 프롬프트가 요청한 형식에 맞는 문제 하나를 돌려준다.
function aiMakesProblems() {
  ai.create.mockImplementation(async (params) =>
    jsonReply(
      generatedProblem(requestedFormat(params.messages[0]?.content ?? "")),
    ),
  );
}

function aiReturns(value: object) {
  ai.create.mockResolvedValueOnce(jsonReply(value));
}

function useFakeTimers() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
}

function promptOf(callIndex: number) {
  const params = ai.create.mock.calls[callIndex]?.[0];
  if (!params) throw new Error(`AI 호출 ${callIndex}번이 없다.`);
  const content = params.messages[0]?.content;
  expect(typeof content).toBe("string");
  return content ?? "";
}

function targetConceptId(prompt: string) {
  const found = /<target_section concept_id="([^"]+)">/.exec(prompt)?.[1];
  expect(found, "출제할 절").toBeDefined();
  return found;
}

function unitContentIn(prompt: string) {
  const found = /<unit_content>\n([\s\S]*?)\n<\/unit_content>/.exec(
    prompt,
  )?.[1];
  expect(found, "단원 원문").toBeDefined();
  return found;
}

function summaries(prompt: string) {
  const block =
    /<conversation_summaries>([\s\S]*?)<\/conversation_summaries>/.exec(
      prompt,
    )?.[1];
  expect(block, "대화 요약 목록").toBeDefined();
  return [...(block ?? "").matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(
    ([, text]) => (text ?? "").trim(),
  );
}

function conversation(prompt: string) {
  const block = /<conversation>([\s\S]*?)<\/conversation>/.exec(prompt)?.[1];
  expect(block, "대화").toBeDefined();
  const questions = [
    ...(block ?? "").matchAll(/<question>([\s\S]*?)<\/question>/g),
  ].map(([, text]) => (text ?? "").trim());
  const answers = [
    ...(block ?? "").matchAll(/<answer>([\s\S]*?)<\/answer>/g),
  ].map(([, text]) => (text ?? "").trim());
  return { questions, answers };
}

function sentToAi() {
  return JSON.stringify(ai.create.mock.calls.map(([params]) => params));
}

async function login({ consented = true } = {}) {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  if (consented) {
    await getDb()
      .update(learner)
      .set({ consentedAt: new Date() })
      .where(eq(learner.email, profile.email));
  }
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  createdLearnerIds.push(found.id);
  return { headers, learnerId: found.id };
}

async function viewed(learnerId: string, conceptId: string, at = new Date()) {
  await getDb()
    .insert(sectionView)
    .values({ learnerId, conceptId, studyDay: studyDay(at), firstSeenAt: at });
}

async function newSession(learnerId: string) {
  const id = randomUUID();
  createdSessionIds.push(id);
  await getDb().insert(questionSession).values({ id, learnerId });
  return id;
}

// 답을 받은 질문 하나와 그 질문의 질문 메시지, 답 메시지를 넣는다.
async function answeredQuestion(
  learnerId: string,
  {
    unitId = UNIT_ID,
    summary = null,
    conceptIds = [],
    askedAt = new Date(),
    sessionId,
  }: {
    unitId?: string;
    summary?: string | null;
    conceptIds?: string[];
    askedAt?: Date;
    sessionId?: string;
  } = {},
) {
  const id = randomUUID();
  createdQuestionIds.push(id);
  const turn = { question: `질문 원문 ${id}`, answer: `답 원문 ${id}` };
  await getDb()
    .insert(question)
    .values({
      id,
      learnerId,
      sessionId: sessionId ?? (await newSession(learnerId)),
      unitId,
      askedAt,
      studyDay: studyDay(askedAt),
      appVersion: APP_VERSION,
      status: "ok",
      answeredAt: askedAt,
      summary,
      summarizedAt: summary === null ? null : askedAt,
    });
  if (conceptIds.length > 0) {
    await getDb()
      .insert(questionConcept)
      .values(conceptIds.map((conceptId) => ({ questionId: id, conceptId })));
  }
  await getDb()
    .insert(message)
    .values([
      { questionId: id, seq: 1, role: "user", content: turn.question },
      { questionId: id, seq: 2, role: "assistant", content: turn.answer },
    ]);
  return { id, ...turn };
}

async function newProblem(
  conceptId: string,
  {
    learnerId = null,
    retiredAt = null,
  }: { learnerId?: string | null; retiredAt?: Date | null } = {},
) {
  const tag = randomUUID();
  const [row] = await getDb()
    .insert(quizProblem)
    .values({
      learnerId,
      conceptId,
      format: "mcq",
      stem: `기본 문제 ${tag}`,
      answer: CHOICE_ANSWER,
      hint: `기본 힌트 ${tag}`,
      explanation: `기본 해설 ${tag}`,
      retiredAt,
    })
    .returning();
  if (!row) throw new Error("문제를 넣지 못했다.");
  createdProblemIds.push(row.id);
  return row;
}

async function defaultProblems(
  count: number,
  conceptIds = ["s2-05-1", "s2-05-2", "s2-05-3"],
) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(await newProblem(conceptIds[index % conceptIds.length]!));
  }
  return rows;
}

async function solved(learnerId: string, problemId: string) {
  const id = randomUUID();
  createdAttemptIds.push(id);
  await getDb()
    .insert(quizAttempt)
    .values({
      id,
      learnerId,
      problemId,
      studyDay: studyDay(new Date()),
      chosenIndex: 0,
      confidence: "sure",
      isCorrect: true,
      appVersion: APP_VERSION,
    });
}

function generate(
  body: unknown,
  {
    headers = new Headers(),
    origin = new URL(env.AUTH_URL).origin,
  }: { headers?: Headers; origin?: string } = {},
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  requestHeaders.set("content-type", "application/json");
  return POST(
    new Request(new URL("/api/quiz-problems", env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

type ProblemBody = {
  id: string;
  format: Format;
  conceptId: string;
  conceptTitle: string;
  stem: string;
  hint: string;
  choices?: string[];
};

async function problemIn(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as ProblemBody;
}

function problemsOf(learnerId: string) {
  return getDb()
    .select()
    .from(quizProblem)
    .where(eq(quizProblem.learnerId, learnerId));
}

async function problemRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(quizProblem)
    .where(eq(quizProblem.id, id));
  expect(row).toBeDefined();
  return row!;
}

async function unitContent(unitId: string) {
  const [row] = await getDb()
    .select({ content: unit.content })
    .from(unit)
    .where(eq(unit.id, unitId));
  if (!row) throw new Error(`테스트 DB에 ${unitId} 단원이 없다.`);
  return row.content;
}

async function conceptTitle(conceptId: string) {
  const [row] = await getDb()
    .select({ title: concept.title })
    .from(concept)
    .where(eq(concept.id, conceptId));
  if (!row) throw new Error(`테스트 DB에 ${conceptId} 개념이 없다.`);
  return row.title;
}

// 단원 절에 걸린 기본 문제 ID다. 서버가 기본 문제를 새로 넣지 않았는지 비교한다.
async function defaultProblemIds(unitId: string) {
  const rows = await getDb()
    .select({ id: quizProblem.id })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(and(eq(concept.unitId, unitId), isNull(quizProblem.learnerId)));
  return rows.map(({ id }) => id).sort();
}

// 마이그레이션이 넣은 기본 문제를 그대로 쓰므로, 부르기 전에 그 단원에서 낼 수 있는 문제를 읽어 둔다.
async function activeDefaultProblemIds(unitId: string) {
  const rows = await getDb()
    .select({ id: quizProblem.id })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(
      and(
        eq(concept.unitId, unitId),
        isNull(quizProblem.learnerId),
        isNull(quizProblem.retiredAt),
      ),
    );
  return rows.map(({ id }) => id).sort();
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...allKeys(child),
  ]);
}

const HIDDEN_KEYS = [
  "answer",
  "answerIndex",
  "misconception",
  "accepted",
  "modelAnswer",
  "explanation",
  "code",
  "keyPoints",
];

async function expectOnlyVisibleFields(body: ProblemBody) {
  const expected = [
    "id",
    "format",
    "conceptId",
    "conceptTitle",
    "stem",
    "hint",
    ...(body.format === "mcq" ? ["choices"] : []),
  ];
  expect(Object.keys(body).sort()).toEqual(expected.sort());
  for (const key of HIDDEN_KEYS) expect(allKeys(body)).not.toContain(key);
  expect(body.conceptTitle).toBe(await conceptTitle(body.conceptId));
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_VERSION);
});

afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  ai.create.mockReset();
  const db = getDb();
  const learnerIds = createdLearnerIds.splice(0);
  const problemIds = createdProblemIds.splice(0);
  const questionIds = createdQuestionIds.splice(0);
  const sessionIds = createdSessionIds.splice(0);
  const attemptIds = createdAttemptIds.splice(0);
  if (attemptIds.length > 0)
    await db.delete(quizAttempt).where(inArray(quizAttempt.id, attemptIds));
  if (learnerIds.length > 0) {
    await db
      .delete(quizAttempt)
      .where(inArray(quizAttempt.learnerId, learnerIds));
    await db
      .delete(quizProblem)
      .where(inArray(quizProblem.learnerId, learnerIds));
  }
  if (problemIds.length > 0) {
    await db
      .delete(quizAttempt)
      .where(inArray(quizAttempt.problemId, problemIds));
    await db.delete(quizProblem).where(inArray(quizProblem.id, problemIds));
  }
  if (questionIds.length > 0) {
    await db
      .delete(quizProblem)
      .where(inArray(quizProblem.sourceQuestionId, questionIds));
    await db
      .delete(questionConcept)
      .where(inArray(questionConcept.questionId, questionIds));
    await db.delete(message).where(inArray(message.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  if (sessionIds.length > 0)
    await db
      .delete(questionSession)
      .where(inArray(questionSession.id, sessionIds));
  if (learnerIds.length > 0)
    await db
      .delete(sectionView)
      .where(inArray(sectionView.learnerId, learnerIds));
  await deleteCreatedLearners();
});

describe("퀴즈 문제 만들기", () => {
  it("TC-115 본 절과 대화가 있는 단원으로 요청하면 AI가 만든 한 문제를 저장하고 돌려줘요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    await answeredQuestion(learnerId, {
      summary: "본 절에 대한 요약",
      conceptIds: ["s2-05-1"],
    });
    aiMakesProblems();

    const body = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers }),
    );

    const rows = await problemsOf(learnerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      learnerId,
      conceptId: "s2-05-1",
      sourceQuestionId: null,
    });
    expect(body.id).toBe(rows[0]!.id);
  });

  it("TC-116 이 단원에서 본 절도 대화도 없으면 AI를 부르지 않고 그 단원의 기본 문제 하나를 무작위로 돌려줘요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-07-1");
    await answeredQuestion(learnerId, {
      unitId: OTHER_UNIT_ID,
      summary: "다른 단원 요약",
      conceptIds: ["s2-07-1"],
    });
    const active = await activeDefaultProblemIds(UNIT_ID);
    const retired = await newProblem("s2-05-1", { retiredAt: new Date() });
    const before = await defaultProblemIds(UNIT_ID);
    aiMakesProblems();

    const body = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers }),
    );

    expect(ai.create).not.toHaveBeenCalled();
    expect(active).toContain(body.id);
    expect(body.id).not.toBe(retired.id);
    expect(await problemsOf(learnerId)).toEqual([]);
    expect(await defaultProblemIds(UNIT_ID)).toEqual(before);
  });

  it("TC-117 출제할 절은 내가 이 단원에서 본 절 중에서 고르고, 단원 원문 전체를 함께 넘겨요", async () => {
    const { headers, learnerId } = await login();
    const other = await login();
    await viewed(learnerId, "s2-05-1", new Date(Date.now() - 3 * DAY_MS));
    await viewed(learnerId, "s2-07-1");
    await viewed(other.learnerId, "s2-05-2");
    aiMakesProblems();

    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));

    expect(ai.create).toHaveBeenCalledTimes(1);
    const prompt = promptOf(0);
    expect(targetConceptId(prompt)).toBe("s2-05-1");
    expect(unitContentIn(prompt)).toBe(await unitContent(UNIT_ID));
    const rows = await problemsOf(learnerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conceptId).toBe("s2-05-1");
  });

  it("TC-118 퀴즈 탭은 이 단원에서 한 내 질문의 요약만 넘겨요", async () => {
    const { headers, learnerId } = await login();
    const other = await login();
    await viewed(learnerId, "s2-05-1");
    const tag = randomUUID();
    const a = await answeredQuestion(learnerId, {
      summary: `A 요약 ${tag}`,
      conceptIds: ["s2-05-1"],
    });
    const b = await answeredQuestion(learnerId, {
      summary: null,
      conceptIds: ["s2-05-1"],
    });
    const c = await answeredQuestion(learnerId, {
      unitId: OTHER_UNIT_ID,
      summary: `C 요약 ${tag}`,
      conceptIds: ["s2-07-1"],
    });
    const d = await answeredQuestion(other.learnerId, {
      summary: `D 요약 ${tag}`,
      conceptIds: ["s2-05-1"],
    });
    aiMakesProblems();

    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));

    expect(ai.create).toHaveBeenCalledTimes(1);
    expect(summaries(promptOf(0))).toEqual([`A 요약 ${tag}`]);
    const sent = sentToAi();
    for (const text of [
      a.question,
      a.answer,
      b.question,
      b.answer,
      c.question,
      c.answer,
      `C 요약 ${tag}`,
      d.question,
      d.answer,
      `D 요약 ${tag}`,
    ]) {
      expect(sent).not.toContain(text);
    }
  });

  it("TC-119 이 단원 질문이 많으면 최근 5개의 요약을 오래된 것부터 넘겨요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    const tag = randomUUID();
    const now = Date.now();
    for (let n = 1; n <= 6; n += 1) {
      await answeredQuestion(learnerId, {
        summary: `요약 ${n} ${tag}`,
        conceptIds: ["s2-05-1"],
        askedAt: new Date(now - (7 - n) * 60 * 60 * 1000),
      });
    }
    aiMakesProblems();

    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));

    expect(ai.create).toHaveBeenCalledTimes(1);
    expect(summaries(promptOf(0))).toEqual(
      [2, 3, 4, 5, 6].map((n) => `요약 ${n} ${tag}`),
    );
    expect(sentToAi()).not.toContain(`요약 1 ${tag}`);
  });

  it("TC-120 이 단원에서 본 절이 없어도 대화가 있으면 물어본 절로 AI가 한 문제를 만들어요", async () => {
    const { headers, learnerId } = await login();
    const summary = `물어본 절 요약 ${randomUUID()}`;
    await answeredQuestion(learnerId, { summary, conceptIds: ["s2-05-3"] });
    aiMakesProblems();

    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));

    expect(ai.create).toHaveBeenCalledTimes(1);
    const prompt = promptOf(0);
    expect(targetConceptId(prompt)).toBe("s2-05-3");
    expect(summaries(prompt)).toContain(summary);
    const rows = await problemsOf(learnerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conceptId).toBe("s2-05-3");
  });

  it("TC-229 퀴즈 탭과 관련 문제 풀어보기로 문제를 여러 번 만들어도 객관식과 빈칸 문제만 AI에 요청하고 저장해요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    const asked = await answeredQuestion(learnerId, {
      summary: "본 절에 대한 요약",
      conceptIds: ["s2-05-1"],
    });
    aiMakesProblems();
    const times = 10;

    for (let index = 0; index < times; index += 1) {
      await problemIn(await generate({ unitId: UNIT_ID }, { headers }));
      await problemIn(await generate({ questionId: asked.id }, { headers }));
    }

    expect(ai.create).toHaveBeenCalledTimes(times * 2);
    const requested = ai.create.mock.calls.map(([params]) =>
      requestedFormat(params.messages[0]?.content ?? ""),
    );
    expect(requested).not.toContain("free");
    expect(new Set(requested)).toEqual(new Set(["mcq", "blank"]));
    const stored = (await problemsOf(learnerId)).map((row) => row.format);
    expect(stored).toHaveLength(times * 2);
    expect(stored).not.toContain("free");
  }, 120_000);

  it("TC-122 AI가 만든 문제가 모양 검사를 통과하지 못하면 502를 돌려주고 아무것도 저장하지 않아요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    const defaults = await defaultProblems(5);
    aiReturns({
      stem: "보기 중 맞는 것은?",
      hint: "힌트",
      explanation: "해설",
      answer: {
        choices: [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
        answerIndex: 4,
      },
    });

    const response = await generate({ unitId: UNIT_ID }, { headers });

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("stem");
    for (const problem of defaults) {
      expect(text).not.toContain(problem.id);
      expect(text).not.toContain(problem.stem);
    }
    expect(await problemsOf(learnerId)).toEqual([]);
  });

  it("TC-123 로그인하지 않았거나 저장에 동의하지 않았으면 퀴즈 문제를 만들지 않아요", async () => {
    const notConsented = await login({ consented: false });
    await viewed(notConsented.learnerId, "s2-05-1");
    const before = await defaultProblemIds(UNIT_ID);
    aiMakesProblems();

    const anonymous = await generate({ unitId: UNIT_ID });
    const refused = await generate(
      { unitId: UNIT_ID },
      { headers: notConsented.headers },
    );

    expect(anonymous.status).toBe(401);
    expect(refused.status).toBe(403);
    expect(ai.create).not.toHaveBeenCalled();
    expect(await problemsOf(notConsented.learnerId)).toEqual([]);
    expect(await defaultProblemIds(UNIT_ID)).toEqual(before);
  });

  it("TC-124 요청에 단원 ID가 없으면 400, 존재하지 않는 단원이면 404로 거절하고 아무것도 저장하지 않아요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    aiMakesProblems();

    const missing = await generate({}, { headers });
    const unknown = await generate(
      { unitId: `no-unit-${randomUUID()}` },
      { headers },
    );

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(ai.create).not.toHaveBeenCalled();
    expect(await problemsOf(learnerId)).toEqual([]);
  });

  it("TC-125 다른 사이트에서 보낸 퀴즈 생성 요청은 403으로 거부해요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    aiMakesProblems();

    const response = await generate(
      { unitId: UNIT_ID },
      { headers, origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect(ai.create).not.toHaveBeenCalled();
    expect(await problemsOf(learnerId)).toEqual([]);
  });

  it("TC-126 퀴즈 생성 응답에는 문제, 개념, 보기, 힌트만 있고 정답과 해설은 없어요", async () => {
    const generated = await login();
    await viewed(generated.learnerId, "s2-05-1");
    aiMakesProblems();

    const made = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers: generated.headers }),
    );

    await expectOnlyVisibleFields(made);
    const output = generatedProblem(made.format);
    const {
      choices,
      ...restOfAnswer
    }: { choices?: { text: string }[] } & Record<string, unknown> =
      output.answer;
    if (made.format === "mcq")
      expect(made.choices).toEqual(choices?.map(({ text }) => text));
    const row = await problemRow(made.id);
    expect(made.stem).toBe(row.stem);
    expect(made.stem).toContain(CODE_BLOCK);
    expect(row.explanation).toBe(output.explanation);
    expect(row.answer).toMatchObject(
      choices
        ? { ...restOfAnswer, choices: choices.map(({ text }) => ({ text })) }
        : restOfAnswer,
    );

    const fallback = await login();
    const inserted = await newProblem("s2-05-1");
    ai.create.mockClear();

    const given = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers: fallback.headers }),
    );

    expect(ai.create).not.toHaveBeenCalled();
    await expectOnlyVisibleFields(given);
    if (given.id === inserted.id) {
      expect(given.choices).toEqual(["1", "2", "3", "4"]);
    }
  });

  it("TC-127 AI 생성이 실패하거나 제한 시간 안에 끝나지 않으면 502를 돌려주고 아무것도 저장하지 않아요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    const defaults = await defaultProblems(5);

    ai.create.mockRejectedValueOnce(new Error("생성 오류"));
    const failed = await generate({ unitId: UNIT_ID }, { headers });

    useFakeTimers();
    ai.create.mockImplementationOnce(
      (_params, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("요청이 중단됐다.")),
            { once: true },
          );
        }),
    );
    const slowResponse = generate({ unitId: UNIT_ID }, { headers });
    // 생성을 부르기 전에 원격 DB를 여러 번 오가므로 기본 1초보다 넉넉히 기다린다.
    await vi.waitFor(() => expect(ai.create).toHaveBeenCalledTimes(2), {
      timeout: 10_000,
    });
    await vi.advanceTimersByTimeAsync(QUIZ_GENERATION_TIMEOUT_MS);
    const slow = await slowResponse;
    vi.useRealTimers();

    for (const response of [failed, slow]) {
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).not.toContain("stem");
      for (const problem of defaults) {
        expect(text).not.toContain(problem.id);
        expect(text).not.toContain(problem.stem);
      }
    }
    expect(await problemsOf(learnerId)).toEqual([]);
  });

  it("TC-131 관련 문제 풀어보기로 부르면 그 질문의 개념 중 하나로 한 문제를 만들고, 그 질문의 대화만 넘겨요", async () => {
    const { headers, learnerId } = await login();
    const sessionId = await newSession(learnerId);
    const now = Date.now();
    const q2 = await answeredQuestion(learnerId, {
      summary: `Q2 요약 ${randomUUID()}`,
      conceptIds: ["s2-05-2"],
      askedAt: new Date(now - 10 * 60 * 1000),
      sessionId,
    });
    const q1 = await answeredQuestion(learnerId, {
      summary: `Q1 요약 ${randomUUID()}`,
      conceptIds: ["s2-05-1", "s2-05-3"],
      askedAt: new Date(now - 5 * 60 * 1000),
      sessionId,
    });
    const existing = await newProblem("s2-05-1", { learnerId });
    aiMakesProblems();

    const body = await problemIn(
      await generate({ questionId: q1.id }, { headers }),
    );

    expect(ai.create).toHaveBeenCalledTimes(1);
    const prompt = promptOf(0);
    const target = targetConceptId(prompt);
    expect(["s2-05-1", "s2-05-3"]).toContain(target);
    expect(conversation(prompt)).toEqual({
      questions: [q1.question],
      answers: [q1.answer],
    });
    const sent = sentToAi();
    expect(sent).not.toContain(q2.question);
    expect(sent).not.toContain(q2.answer);
    const rows = await problemsOf(learnerId);
    expect(rows).toHaveLength(2);
    expect(rows.find(({ id }) => id === existing.id)).toEqual(existing);
    const created = rows.find(({ id }) => id !== existing.id);
    expect(created).toMatchObject({
      learnerId,
      conceptId: target,
      sourceQuestionId: q1.id,
    });
    expect(body.id).toBe(created?.id);
  });

  it("TC-132 다른 학습자의 질문이나 없는 질문으로 관련 문제를 부르면 404로 거절하고 아무것도 저장하지 않아요", async () => {
    const { headers, learnerId } = await login();
    const other = await login();
    const othersQuestion = await answeredQuestion(other.learnerId, {
      summary: "다른 학습자 요약",
      conceptIds: ["s2-05-1"],
    });
    aiMakesProblems();

    const foreign = await generate(
      { questionId: othersQuestion.id },
      { headers },
    );
    const missing = await generate({ questionId: randomUUID() }, { headers });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(ai.create).not.toHaveBeenCalled();
    expect(await problemsOf(learnerId)).toEqual([]);
    expect(await problemsOf(other.learnerId)).toEqual([]);
  });

  it("TC-136 기본 문제는 이 학습자가 이미 푼 문제를 빼고 내고, 다 풀었으면 다시 전체에서 내요", async () => {
    const ids = await activeDefaultProblemIds(UNIT_ID);
    const [kept, ...rest] = ids;
    if (!kept || rest.length === 0)
      throw new Error("s2-05에 기본 문제가 두 개 이상 있어야 한다.");
    const one = await login();
    const all = await login();
    for (const id of rest) await solved(one.learnerId, id);
    for (const id of ids) await solved(all.learnerId, id);
    aiMakesProblems();

    const afterOne = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers: one.headers }),
    );
    const afterAll = await problemIn(
      await generate({ unitId: UNIT_ID }, { headers: all.headers }),
    );

    expect(afterOne.id).toBe(kept);
    expect(ids).toContain(afterAll.id);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("TC-137 퀴즈 탭은 물어본 절을 먼저 내고, 그다음은 후보 절에서 무작위로 내요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-1");
    await viewed(learnerId, "s2-05-2");
    await answeredQuestion(learnerId, {
      summary: `물어본 절 요약 ${randomUUID()}`,
      conceptIds: ["s2-05-3"],
    });
    aiMakesProblems();

    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));
    await problemIn(await generate({ unitId: UNIT_ID }, { headers }));

    expect(ai.create).toHaveBeenCalledTimes(2);
    expect(targetConceptId(promptOf(0))).toBe("s2-05-3");
    expect(["s2-05-1", "s2-05-2", "s2-05-3"]).toContain(
      targetConceptId(promptOf(1)),
    );
  });

  it("TC-138 개념이 없는 질문으로 관련 문제를 부르면 그 단원 후보 절로 만들고, 후보가 없으면 기본 문제를 돌려줘요", async () => {
    const { headers, learnerId } = await login();
    await viewed(learnerId, "s2-05-2");
    const q1 = await answeredQuestion(learnerId, {
      summary: `Q1 요약 ${randomUUID()}`,
    });
    const q2 = await answeredQuestion(learnerId, {
      unitId: OTHER_UNIT_ID,
      summary: `Q2 요약 ${randomUUID()}`,
    });
    const fallbacks = await activeDefaultProblemIds(OTHER_UNIT_ID);
    aiMakesProblems();

    const made = await problemIn(
      await generate({ questionId: q1.id }, { headers }),
    );

    expect(ai.create).toHaveBeenCalledTimes(1);
    const prompt = promptOf(0);
    expect(targetConceptId(prompt)).toBe("s2-05-2");
    expect(conversation(prompt)).toEqual({
      questions: [q1.question],
      answers: [q1.answer],
    });
    const rowsAfterQ1 = await problemsOf(learnerId);
    expect(rowsAfterQ1).toHaveLength(1);
    expect(rowsAfterQ1[0]).toMatchObject({
      id: made.id,
      conceptId: "s2-05-2",
      sourceQuestionId: q1.id,
    });

    ai.create.mockClear();
    const given = await problemIn(
      await generate({ questionId: q2.id }, { headers }),
    );

    expect(ai.create).not.toHaveBeenCalled();
    expect(fallbacks).toContain(given.id);
    expect(await problemsOf(learnerId)).toEqual(rowsAfterQ1);
  });
});
