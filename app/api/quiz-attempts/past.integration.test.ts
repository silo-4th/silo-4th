import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import {
  concept,
  learner,
  type QuizAnswer,
  question,
  questionSession,
  quizAttempt,
  quizProblem,
  recallItem,
  recallSet,
  unit,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { PastAttempt } from "@/lib/past-problems";
import { studyDay } from "@/lib/study-day";
import { GET } from "./route";

const APP_VERSION = "test-version";
const CHOICE_ANSWER: QuizAnswer = {
  choices: [{ text: "WHERE" }, { text: "HAVING" }, { text: "ORDER BY" }, { text: "LIMIT" }],
  answerIndex: 1,
};

const createdAttemptIds: string[] = [];
const createdProblemIds: string[] = [];
const createdConceptIds: string[] = [];
const createdQuestionIds: string[] = [];
const createdSessionIds: string[] = [];
const createdSetIds: string[] = [];

async function testUnit() {
  const [found] = await getDb().select({ id: unit.id, title: unit.title }).from(unit).orderBy(asc(unit.id)).limit(1);
  if (!found) throw new Error("테스트 DB에 단원이 없다.");
  return found;
}

async function testConcept(unitId: string) {
  const id = `test-${randomUUID()}`;
  createdConceptIds.push(id);
  await getDb().insert(concept).values({ id, unitId, title: "테스트 개념" });
  return id;
}

async function newProblem(
  conceptId: string,
  stem: string,
  {
    learnerId = null,
    sourceQuestionId = null,
    retiredAt = null,
  }: { learnerId?: string | null; sourceQuestionId?: string | null; retiredAt?: Date | null } = {},
) {
  const [row] = await getDb()
    .insert(quizProblem)
    .values({
      learnerId,
      conceptId,
      sourceQuestionId,
      format: "mcq",
      stem,
      answer: CHOICE_ANSWER,
      hint: "힌트",
      explanation: `${stem} 해설`,
      retiredAt,
    })
    .returning();
  if (!row) throw new Error("문제를 넣지 못했다.");
  createdProblemIds.push(row.id);
  return row;
}

async function answeredQuestion(learnerId: string, unitId: string) {
  const sessionId = randomUUID();
  createdSessionIds.push(sessionId);
  await getDb().insert(questionSession).values({ id: sessionId, learnerId });
  const id = randomUUID();
  createdQuestionIds.push(id);
  const askedAt = new Date();
  await getDb()
    .insert(question)
    .values({ id, learnerId, sessionId, unitId, askedAt, studyDay: studyDay(askedAt), appVersion: APP_VERSION, status: "ok", answeredAt: askedAt });
  return id;
}

async function recallItemFor(learnerId: string, problemId: string) {
  const [set] = await getDb()
    .insert(recallSet)
    .values({ learnerId, sourceStudyDay: studyDay(new Date(Date.now() - 24 * 60 * 60 * 1000)) })
    .returning();
  if (!set) throw new Error("세트를 넣지 못했다.");
  createdSetIds.push(set.id);
  const [item] = await getDb().insert(recallItem).values({ setId: set.id, position: 1, reason: "read_no_question", problemId }).returning();
  if (!item) throw new Error("문항을 넣지 못했다.");
  return item.id;
}

async function solved(
  learnerId: string,
  problemId: string,
  answeredAt: Date,
  { chosenIndex = 1, confidence = "sure", isCorrect = true, recallItemId = null }: {
    chosenIndex?: number;
    confidence?: "sure" | "unsure" | "guess";
    isCorrect?: boolean | null;
    recallItemId?: string | null;
  } = {},
) {
  const id = randomUUID();
  createdAttemptIds.push(id);
  await getDb()
    .insert(quizAttempt)
    .values({
      id,
      learnerId,
      problemId,
      recallItemId,
      studyDay: studyDay(answeredAt),
      chosenIndex,
      answerText: null,
      confidence,
      hintUsed: false,
      isCorrect,
      answeredAt,
      appVersion: APP_VERSION,
    });
  return id;
}

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

function listPast(headers = new Headers()) {
  return GET(new Request(new URL("/api/quiz-attempts", env.AUTH_URL), { headers }));
}

async function pastOf(headers: Headers) {
  const response = await listPast(headers);
  expect(response.status).toBe(200);
  return (await response.json()) as PastAttempt[];
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

afterEach(async () => {
  const db = getDb();
  const attemptIds = createdAttemptIds.splice(0);
  const problemIds = createdProblemIds.splice(0);
  const setIds = createdSetIds.splice(0);
  const questionIds = createdQuestionIds.splice(0);
  const sessionIds = createdSessionIds.splice(0);
  const conceptIds = createdConceptIds.splice(0);
  if (attemptIds.length > 0) await db.delete(quizAttempt).where(inArray(quizAttempt.id, attemptIds));
  if (setIds.length > 0) {
    await db.delete(recallItem).where(inArray(recallItem.setId, setIds));
    await db.delete(recallSet).where(inArray(recallSet.id, setIds));
  }
  if (problemIds.length > 0) await db.delete(quizProblem).where(inArray(quizProblem.id, problemIds));
  if (questionIds.length > 0) await db.delete(question).where(inArray(question.id, questionIds));
  if (sessionIds.length > 0) await db.delete(questionSession).where(inArray(questionSession.id, sessionIds));
  if (conceptIds.length > 0) await db.delete(concept).where(inArray(concept.id, conceptIds));
  await deleteCreatedLearners();
});

describe("지난 문제 조회", () => {
  it("TC-253 지난 문제를 조회하면 내가 퀴즈 탭에서 푼 풀이만 최근 순서로 오고, 꺼내 먹기 풀이는 오지 않아요", async () => {
    const { headers, learnerId } = await loginConsented();
    const found = await testUnit();
    const conceptId = await testConcept(found.id);
    const mine = await newProblem(conceptId, "내 맞춤 문제", { learnerId });
    const shared = await newProblem(conceptId, "기본 문제");
    const related = await newProblem(conceptId, "관련 문제", { learnerId, sourceQuestionId: await answeredQuestion(learnerId, found.id) });
    const retired = await newProblem(conceptId, "내려간 문제", { learnerId });
    const recalled = await newProblem(conceptId, "꺼내 먹기 문제", { learnerId });

    const mineId = await solved(learnerId, mine.id, minutesAgo(50), { confidence: "unsure" });
    const sharedId = await solved(learnerId, shared.id, minutesAgo(40), { chosenIndex: 0, isCorrect: false });
    const relatedId = await solved(learnerId, related.id, minutesAgo(30), { confidence: "guess" });
    const retiredId = await solved(learnerId, retired.id, minutesAgo(20));
    await getDb().update(quizProblem).set({ retiredAt: minutesAgo(15) }).where(eq(quizProblem.id, retired.id));
    await solved(learnerId, recalled.id, minutesAgo(10), { recallItemId: await recallItemFor(learnerId, recalled.id) });

    const attemptsBefore = await getDb().select().from(quizAttempt).where(eq(quizAttempt.learnerId, learnerId)).orderBy(asc(quizAttempt.id));
    const problemsBefore = await getDb().select().from(quizProblem).where(inArray(quizProblem.id, createdProblemIds)).orderBy(asc(quizProblem.id));

    const past = await pastOf(headers);

    expect(past.map((row) => row.attemptId)).toEqual([retiredId, relatedId, sharedId, mineId]);
    expect(past.find((row) => row.attemptId === sharedId)).toEqual({
      attemptId: sharedId,
      answeredAt: expect.any(String),
      unitTitle: found.title,
      format: "mcq",
      stem: "기본 문제",
      chosenIndex: 0,
      answerText: null,
      confidence: "sure",
      isCorrect: false,
      answer: CHOICE_ANSWER,
      explanation: "기본 문제 해설",
    });
    expect(past.find((row) => row.attemptId === mineId)).toMatchObject({ stem: "내 맞춤 문제", confidence: "unsure", isCorrect: true });
    expect(past.find((row) => row.attemptId === relatedId)).toMatchObject({ stem: "관련 문제", confidence: "guess" });
    expect(past.find((row) => row.attemptId === retiredId)).toMatchObject({ stem: "내려간 문제", explanation: "내려간 문제 해설" });

    const attemptsAfter = await getDb().select().from(quizAttempt).where(eq(quizAttempt.learnerId, learnerId)).orderBy(asc(quizAttempt.id));
    const problemsAfter = await getDb().select().from(quizProblem).where(inArray(quizProblem.id, createdProblemIds)).orderBy(asc(quizProblem.id));
    expect(attemptsAfter).toEqual(attemptsBefore);
    expect(problemsAfter).toEqual(problemsBefore);
  });

  it("TC-254 지난 문제를 조회하면 다른 학습자의 풀이는 오지 않고, 로그인하지 않으면 401을 받아요", async () => {
    const a = await loginConsented();
    const b = await loginConsented();
    const found = await testUnit();
    const conceptId = await testConcept(found.id);
    const shared = await newProblem(conceptId, "같이 푼 기본 문제");
    const bOnly = await newProblem(conceptId, "B의 맞춤 문제", { learnerId: b.learnerId });
    const aAttempt = await solved(a.learnerId, shared.id, minutesAgo(30));
    await solved(b.learnerId, shared.id, minutesAgo(20));
    await solved(b.learnerId, bOnly.id, minutesAgo(10));

    const past = await pastOf(a.headers);
    expect(past.map((row) => row.attemptId)).toEqual([aAttempt]);
    expect(past.some((row) => row.stem === "B의 맞춤 문제")).toBe(false);

    const anonymous = await listPast();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toBe("");
  });
});
