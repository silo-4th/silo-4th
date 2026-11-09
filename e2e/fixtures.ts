import { createHmac, randomUUID } from "node:crypto";
import { test as base } from "@playwright/test";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  learner,
  message,
  question,
  questionConcept,
  questionSession,
  quizAttempt,
  quizProblem,
  recallItem,
  recallSet,
  sectionView,
  session,
  unit,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { TEST_SOURCE } from "@/lib/source";
import { studyDay } from "@/lib/study-day";
import { sectionConceptId, unitSections } from "@/lib/unit-sections";

export const db = drizzle({ connection: env.DATABASE_URL });

// Google 로그인 화면은 자동화로 통과할 수 없어, Better Auth가 로그인 끝에 남기는 세션 행과 서명 쿠키를 직접 만든다.
function signedSessionCookie(token: string) {
  const signature = createHmac("sha256", env.AUTH_SECRET).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function createLearner(consented = true) {
  const [created] = await db
    .insert(learner)
    .values({
      name: "E2E 학습자",
      email: `${randomUUID()}@e2e.test`,
      source: TEST_SOURCE,
      isTest: true,
      ...(consented && { consentedAt: new Date(), examDate: daysFromNow(30) }),
    })
    .returning({ id: learner.id });
  if (!created) throw new Error("E2E 학습자를 만들지 못했다.");
  return created.id;
}

// 질문, 퀴즈, 꺼내 먹기, 본 절 기록은 학습자를 지워도 함께 지워지지 않으므로 먼저 지운다.
// 화면을 닫을 때 보낸 본 절 기록이 정리 중에 도착할 수 있다. 학습자 줄을 먼저 잠가 그 기록이 끝난 뒤에 함께 지운다.
export async function deleteLearner(learnerId: string) {
  const asked = db.select({ id: question.id }).from(question).where(eq(question.learnerId, learnerId));
  const recallSets = db.select({ id: recallSet.id }).from(recallSet).where(eq(recallSet.learnerId, learnerId));
  await db.batch([
    db.select({ id: learner.id }).from(learner).where(eq(learner.id, learnerId)).for("update"),
    db.delete(sectionView).where(eq(sectionView.learnerId, learnerId)),
    db.delete(quizAttempt).where(eq(quizAttempt.learnerId, learnerId)),
    db.delete(recallItem).where(inArray(recallItem.setId, recallSets)),
    db.delete(recallSet).where(eq(recallSet.learnerId, learnerId)),
    db.delete(quizProblem).where(eq(quizProblem.learnerId, learnerId)),
    db.delete(questionConcept).where(inArray(questionConcept.questionId, asked)),
    db.delete(message).where(inArray(message.questionId, asked)),
    db.delete(question).where(eq(question.learnerId, learnerId)),
    db.delete(questionSession).where(eq(questionSession.learnerId, learnerId)),
    db.delete(learner).where(eq(learner.id, learnerId)),
  ]);
}

// 질문 서버가 답을 끝까지 받아 저장한 결과를 DB에 직접 남긴다.
export async function saveAnswered(
  learnerId: string,
  { questionId, sessionId, unitId, content }: { questionId: string; sessionId: string; unitId: string; content: string },
  answer: string,
) {
  const askedAt = new Date();
  await db.insert(questionSession).values({ id: sessionId, learnerId }).onConflictDoNothing();
  await db.insert(question).values({
    id: questionId,
    learnerId,
    sessionId,
    unitId,
    askedAt,
    studyDay: studyDay(askedAt),
    answeredAt: askedAt,
    status: "ok",
    appVersion: "e2e",
  });
  await db.insert(message).values([
    { questionId, seq: 1, role: "user", content },
    { questionId, seq: 2, role: "assistant", content: answer },
  ]);
}

// 시험 날짜와 저장 동의는 한 폼에서 함께 저장하므로, 테스트 학습자도 둘 다 있거나 둘 다 없다.
export const test = base.extend<{ consented: boolean; learnerId: string }>({
  consented: [true, { option: true }],
  learnerId: async ({ consented }, provide) => {
    const learnerId = await createLearner(consented);
    try {
      await provide(learnerId);
    } finally {
      await deleteLearner(learnerId);
    }
  },
  context: async ({ context, baseURL, learnerId }, provide) => {
    if (!baseURL) throw new Error("baseURL이 없다.");
    const token = randomUUID();
    await db.insert(session).values({
      token,
      userId: learnerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await context.addCookies([{ name: "better-auth.session_token", value: signedSessionCookie(token), url: baseURL }]);
    // 실제 질문 서버는 AI를 부른다. 기본으로는 응답하지 않아 답을 기다리는 상태로 두고, 답을 다루는 테스트가 page.route로 응답을 정한다.
    await context.route("**/api/questions", () => {});
    await provide(context);
  },
});

export function firstUnits(count: number) {
  return db.select({ id: unit.id, title: unit.title }).from(unit).orderBy(asc(unit.id)).limit(count);
}

export async function unitsWithSections() {
  const units = await db.select().from(unit).orderBy(asc(unit.id));
  return units.map(({ id, title, content }) => ({
    id,
    title,
    sections: unitSections(content).map((section) => ({ ...section, conceptId: sectionConceptId(id, section) })),
  }));
}

export function sectionViewsOf(learnerId: string) {
  return db
    .select({ conceptId: sectionView.conceptId, studyDay: sectionView.studyDay, dwellSec: sectionView.dwellSec })
    .from(sectionView)
    .where(eq(sectionView.learnerId, learnerId))
    .orderBy(asc(sectionView.conceptId));
}
