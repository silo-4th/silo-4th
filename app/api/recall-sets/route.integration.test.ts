import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCreatedLearners,
  learnerWithEmail,
  loginWithGoogle,
  newProfile,
} from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import {
  learner,
  message,
  type QuizAnswer,
  question,
  questionConcept,
  questionSession,
  quizProblem,
  recallItem,
  recallSet,
  sectionView,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";
import { POST } from "./route";

type CreateParams = { messages: { role: string; content: string }[] };

const ai = vi.hoisted(() => ({
  create: vi.fn<(params: CreateParams) => Promise<unknown>>(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: ai.create };
  },
}));

const APP_VERSION = "test-version";
const UNIT_ID = "s2-05";
const SKIPPED_A = "s2-05-1";
const SKIPPED_B = "s2-05-2";
const ASKED = "s2-05-3";
const OTHER = "s2-05-4";
const DAY_MS = 24 * 60 * 60 * 1000;

const CHOICE_ANSWER: QuizAnswer = {
  choices: [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
  answerIndex: 0,
};

const createdLearnerIds: string[] = [];
const createdQuestionIds: string[] = [];
const createdSessionIds: string[] = [];

type Format = "mcq" | "blank" | "free";

function generatedProblem(format: Format) {
  const common = { hint: `${format} 힌트`, explanation: `${format} 해설` };
  switch (format) {
    case "mcq":
      return {
        ...common,
        stem: "다음 중 맞는 것은 무엇인가요?",
        answer: {
          choices: [{ text: "가" }, { text: "나" }, { text: "다" }, { text: "라" }],
          answerIndex: 0,
        },
      };
    case "blank":
      return { ...common, stem: "값을 바꿀 수 없게 선언하는 키워드는 ____예요.", answer: { accepted: ["const"] } };
    case "free":
      return {
        ...common,
        stem: "const를 쓰는 이유를 설명하세요.",
        answer: { modelAnswer: "다시 할당하지 않기 때문이다.", keyPoints: ["다시 할당하지 않음"] },
      };
  }
}

function jsonReply(value: object) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] };
}

function promptOf(params: CreateParams) {
  return params.messages[0]?.content ?? "";
}

function requestedFormat(prompt: string): Format {
  const found = /<format>(mcq|blank|free)<\/format>/.exec(prompt)?.[1];
  if (found === "mcq" || found === "blank" || found === "free") return found;
  throw new Error("프롬프트에 형식이 없다.");
}

function targetConceptId(prompt: string) {
  const found = /<target_section concept_id="([^"]+)">/.exec(prompt)?.[1];
  if (!found) throw new Error("프롬프트에 출제할 절이 없다.");
  return found;
}

function aiMakesProblems() {
  ai.create.mockImplementation(async (params) => jsonReply(generatedProblem(requestedFormat(promptOf(params)))));
}

function promptsByConcept() {
  return new Map(
    ai.create.mock.calls.map(([params]) => {
      const prompt = promptOf(params);
      return [targetConceptId(prompt), prompt] as const;
    }),
  );
}

async function login({ consented = true } = {}) {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  if (consented) {
    await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  }
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  createdLearnerIds.push(found.id);
  return { headers, learnerId: found.id };
}

async function viewed(learnerId: string, conceptId: string, at: Date) {
  await getDb().insert(sectionView).values({ learnerId, conceptId, studyDay: studyDay(at), firstSeenAt: at });
}

async function answeredQuestion(learnerId: string, conceptId: string, askedAt: Date) {
  const sessionId = randomUUID();
  createdSessionIds.push(sessionId);
  await getDb().insert(questionSession).values({ id: sessionId, learnerId });
  const id = randomUUID();
  createdQuestionIds.push(id);
  const turn = { question: `질문 원문 ${id}`, answer: `답 원문 ${id}` };
  await getDb().insert(question).values({
    id,
    learnerId,
    sessionId,
    unitId: UNIT_ID,
    askedAt,
    studyDay: studyDay(askedAt),
    appVersion: APP_VERSION,
    status: "ok",
    answeredAt: askedAt,
  });
  await getDb().insert(questionConcept).values({ questionId: id, conceptId });
  await getDb()
    .insert(message)
    .values([
      { questionId: id, seq: 1, role: "user", content: turn.question },
      { questionId: id, seq: 2, role: "assistant", content: turn.answer },
    ]);
  return { id, ...turn };
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

// 어제 절 3개를 읽고 그중 한 절에 질문한 학습 기록이다.
async function studiedYesterday(learnerId: string) {
  const at = daysAgo(1);
  await viewed(learnerId, SKIPPED_A, at);
  await viewed(learnerId, SKIPPED_B, at);
  await viewed(learnerId, ASKED, at);
  return answeredQuestion(learnerId, ASKED, at);
}

function prepare({ headers = new Headers(), origin = new URL(env.AUTH_URL).origin } = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  return POST(new Request(new URL("/api/recall-sets", env.AUTH_URL), { method: "POST", headers: requestHeaders }));
}

function setsOf(learnerId: string) {
  return getDb().select().from(recallSet).where(eq(recallSet.learnerId, learnerId)).orderBy(asc(recallSet.sourceStudyDay));
}

function itemsOf(setId: string) {
  return getDb()
    .select({
      id: recallItem.id,
      position: recallItem.position,
      reason: recallItem.reason,
      sourceQuestionId: recallItem.sourceQuestionId,
      problemId: recallItem.problemId,
      problemLearnerId: quizProblem.learnerId,
      problemRetiredAt: quizProblem.retiredAt,
      conceptId: quizProblem.conceptId,
      format: quizProblem.format,
    })
    .from(recallItem)
    .innerJoin(quizProblem, eq(quizProblem.id, recallItem.problemId))
    .where(eq(recallItem.setId, setId))
    .orderBy(asc(recallItem.position));
}

async function onlySet(learnerId: string) {
  const sets = await setsOf(learnerId);
  expect(sets).toHaveLength(1);
  return sets[0]!;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_VERSION);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  ai.create.mockReset();
  const db = getDb();
  const learnerIds = createdLearnerIds.splice(0);
  const questionIds = createdQuestionIds.splice(0);
  const sessionIds = createdSessionIds.splice(0);
  if (learnerIds.length > 0) {
    const sets = await db.select({ id: recallSet.id }).from(recallSet).where(inArray(recallSet.learnerId, learnerIds));
    if (sets.length > 0) {
      await db.delete(recallItem).where(inArray(recallItem.setId, sets.map(({ id }) => id)));
      await db.delete(recallSet).where(inArray(recallSet.learnerId, learnerIds));
    }
    await db.delete(quizProblem).where(inArray(quizProblem.learnerId, learnerIds));
  }
  if (questionIds.length > 0) {
    await db.delete(questionConcept).where(inArray(questionConcept.questionId, questionIds));
    await db.delete(message).where(inArray(message.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  if (sessionIds.length > 0) await db.delete(questionSession).where(inArray(questionSession.id, sessionIds));
  if (learnerIds.length > 0) await db.delete(sectionView).where(inArray(sectionView.learnerId, learnerIds));
  await deleteCreatedLearners();
});

describe("꺼내 먹기 세트 준비", () => {
  it("TC-181 다음 날 첫 진입에 세트를 준비하면 끝난 학습일을 기준일로 세트 하나와 문항 3개가 저장돼요", async () => {
    const { headers, learnerId } = await login();
    const asked = await studiedYesterday(learnerId);
    const other = await login();
    await viewed(other.learnerId, OTHER, daysAgo(1));
    aiMakesProblems();

    const response = await prepare({ headers });

    expect(response.ok).toBe(true);
    const set = await onlySet(learnerId);
    expect(set.sourceStudyDay).toBe(studyDay(daysAgo(1)));
    const items = await itemsOf(set.id);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(items.map((item) => item.reason).sort()).toEqual(["asked", "read_no_question", "read_no_question"]);
    for (const item of items) {
      expect(item.problemLearnerId).toBe(learnerId);
      expect(item.sourceQuestionId).toBe(item.reason === "asked" ? asked.id : null);
    }
    expect(items.find((item) => item.reason === "asked")?.conceptId).toBe(ASKED);
    expect(items.map((item) => item.conceptId).sort()).toEqual([SKIPPED_A, SKIPPED_B, ASKED]);
    expect(items.map((item) => item.format).sort()).toEqual(["blank", "free", "mcq"]);
    const prompts = promptsByConcept();
    for (const item of items) expect(requestedFormat(prompts.get(item.conceptId) ?? "")).toBe(item.format);
    expect(await setsOf(other.learnerId)).toHaveLength(0);
  });

  it("TC-182 질문한 절의 문제를 만들 때는 그 질문과 AI 답을 AI 입력에 넣어요", async () => {
    const { headers, learnerId } = await login();
    const asked = await studiedYesterday(learnerId);
    aiMakesProblems();

    expect((await prepare({ headers })).ok).toBe(true);

    const prompts = promptsByConcept();
    const askedPrompt = prompts.get(ASKED) ?? "";
    expect(askedPrompt).toContain(asked.question);
    expect(askedPrompt).toContain(asked.answer);
    for (const conceptId of [SKIPPED_A, SKIPPED_B]) {
      const prompt = prompts.get(conceptId);
      expect(prompt, `${conceptId} 문제 요청`).toBeDefined();
      expect(prompt).not.toContain(asked.question);
      expect(prompt).not.toContain(asked.answer);
    }
  });

  it("TC-183 AI가 문제를 만들지 못하거나 형식에 맞지 않는 출력을 내면 그 절의 기본 문제로 저장해요", async () => {
    const { headers, learnerId } = await login();
    await studiedYesterday(learnerId);
    ai.create.mockImplementation(async (params) => {
      const prompt = promptOf(params);
      const conceptId = targetConceptId(prompt);
      if (conceptId === SKIPPED_A) throw new Error("AI 호출 실패");
      if (conceptId === SKIPPED_B) return jsonReply({ stem: "", hint: "", explanation: "", answer: {} });
      return jsonReply(generatedProblem(requestedFormat(prompt)));
    });

    const response = await prepare({ headers });

    expect(response.ok).toBe(true);
    const items = await itemsOf((await onlySet(learnerId)).id);
    expect(items).toHaveLength(3);
    for (const conceptId of [SKIPPED_A, SKIPPED_B]) {
      const item = items.find((found) => found.conceptId === conceptId);
      expect(item, `${conceptId} 문항`).toBeDefined();
      expect(item?.problemLearnerId).toBeNull();
      expect(item?.problemRetiredAt).toBeNull();
    }
    expect(items.find((found) => found.conceptId === ASKED)?.problemLearnerId).toBe(learnerId);
  });

  it("TC-184 같은 날 다시 준비 요청을 보내도 세트가 하나만 남고 문항이 바뀌지 않아요", async () => {
    const { headers, learnerId } = await login();
    await studiedYesterday(learnerId);
    aiMakesProblems();
    expect((await prepare({ headers })).ok).toBe(true);
    const first = await itemsOf((await onlySet(learnerId)).id);
    const callsAfterFirst = ai.create.mock.calls.length;

    const response = await prepare({ headers });

    expect(response.ok).toBe(true);
    const again = await itemsOf((await onlySet(learnerId)).id);
    expect(again.map((item) => item.problemId)).toEqual(first.map((item) => item.problemId));
    expect(ai.create.mock.calls.length).toBe(callsAfterFirst);
  });

  it("TC-185 새벽 4시가 지난 뒤 생긴 오늘 학습일 기록은 세트에 넣지 않아요", async () => {
    const { headers, learnerId } = await login();
    await studiedYesterday(learnerId);
    await viewed(learnerId, OTHER, new Date());
    aiMakesProblems();

    expect((await prepare({ headers })).ok).toBe(true);

    const set = await onlySet(learnerId);
    expect(set.sourceStudyDay).toBe(studyDay(daysAgo(1)));
    const items = await itemsOf(set.id);
    expect(items.map((item) => item.conceptId)).not.toContain(OTHER);
    const todaySets = await getDb()
      .select()
      .from(recallSet)
      .where(and(eq(recallSet.learnerId, learnerId), eq(recallSet.sourceStudyDay, studyDay(new Date()))));
    expect(todaySets).toHaveLength(0);
  });

  it("TC-186 미룬 세트가 있어도 그 뒤 학습일 기록이 생기면 새 기준일 세트를 만들어요", async () => {
    const { headers, learnerId } = await login();
    const postponedAt = daysAgo(1);
    const [postponed] = await getDb()
      .insert(recallSet)
      .values({ learnerId, sourceStudyDay: studyDay(daysAgo(2)), shownAt: postponedAt, postponedAt })
      .returning();
    const [problem] = await getDb()
      .insert(quizProblem)
      .values({
        learnerId,
        conceptId: OTHER,
        format: "mcq",
        stem: "미룬 문제",
        answer: CHOICE_ANSWER,
        hint: "힌트",
        explanation: "해설",
      })
      .returning();
    const [postponedItem] = await getDb()
      .insert(recallItem)
      .values({ setId: postponed!.id, position: 1, reason: "read_no_question", problemId: problem!.id })
      .returning();
    await studiedYesterday(learnerId);
    aiMakesProblems();

    expect((await prepare({ headers })).ok).toBe(true);

    const sets = await setsOf(learnerId);
    expect(sets.map((set) => set.sourceStudyDay)).toEqual([studyDay(daysAgo(2)), studyDay(daysAgo(1))]);
    expect(await itemsOf(sets[1]!.id)).toHaveLength(3);
    expect(sets[0]?.postponedAt?.getTime()).toBe(postponed!.postponedAt?.getTime());
    const kept = await itemsOf(postponed!.id);
    expect(kept.map((item) => [item.id, item.problemId])).toEqual([[postponedItem!.id, problem!.id]]);
  });

  it("TC-187 로그인하지 않았거나 저장에 동의하지 않았거나 다른 사이트에서 보낸 세트 준비 요청은 거부하고 아무것도 만들지 않아요", async () => {
    const consented = await login();
    await studiedYesterday(consented.learnerId);
    const unconsented = await login({ consented: false });
    await studiedYesterday(unconsented.learnerId);
    aiMakesProblems();

    const responses = [
      await prepare(),
      await prepare({ headers: unconsented.headers }),
      await prepare({ headers: consented.headers, origin: "https://evil.example" }),
    ];

    expect(responses.map((response) => response.status)).toEqual([401, 403, 403]);
    expect(await setsOf(consented.learnerId)).toHaveLength(0);
    expect(await setsOf(unconsented.learnerId)).toHaveLength(0);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("TC-188 같은 학습자가 세트 준비 요청을 동시에 두 번 보내도 세트는 하나만 남아요", async () => {
    const { headers, learnerId } = await login();
    await studiedYesterday(learnerId);
    aiMakesProblems();

    const responses = await Promise.all([prepare({ headers }), prepare({ headers })]);

    expect(responses.map((response) => response.ok)).toEqual([true, true]);
    const set = await onlySet(learnerId);
    expect(set.sourceStudyDay).toBe(studyDay(daysAgo(1)));
    expect(await itemsOf(set.id)).toHaveLength(3);
    const problems = await getDb()
      .select({ id: quizProblem.id })
      .from(quizProblem)
      .where(eq(quizProblem.learnerId, learnerId));
    expect(problems).toHaveLength(3);
  });
});
