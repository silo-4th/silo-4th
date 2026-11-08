import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { concept, question, questionConcept, quizAttempt, quizProblem, sectionView } from "@/lib/db/schema";
import { type RecallItem, type RecallRecord, assignFormats, pickRecallTargets, recallRange } from "@/lib/recall-targets";

export type RecallPlan = { sourceStudyDay: string; items: RecallItem[] };

// 퀴즈를 푼 절은 풀이가 있는 절만 센다. 풀지 않고 교체된 문제는 풀이가 없어 빠지고, 꺼내 먹기 풀이는 학습 기록이 아니라 뺀다.
export async function loadRecallRecords(learnerId: string): Promise<RecallRecord[]> {
  const db = getDb();
  const [viewed, asked, quizzed] = await Promise.all([
    db
      .select({ conceptId: sectionView.conceptId, unitId: concept.unitId, studyDay: sectionView.studyDay })
      .from(sectionView)
      .innerJoin(concept, eq(concept.id, sectionView.conceptId))
      .where(eq(sectionView.learnerId, learnerId)),
    db
      .select({
        conceptId: questionConcept.conceptId,
        unitId: concept.unitId,
        studyDay: question.studyDay,
        questionId: question.id,
      })
      .from(question)
      .innerJoin(questionConcept, eq(questionConcept.questionId, question.id))
      .innerJoin(concept, eq(concept.id, questionConcept.conceptId))
      .where(eq(question.learnerId, learnerId)),
    db
      .select({ conceptId: quizProblem.conceptId, unitId: concept.unitId, studyDay: quizAttempt.studyDay })
      .from(quizAttempt)
      .innerJoin(quizProblem, eq(quizProblem.id, quizAttempt.problemId))
      .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
      .where(and(eq(quizAttempt.learnerId, learnerId), isNull(quizAttempt.recallItemId))),
  ]);
  return [
    ...viewed.map((row) => ({ ...row, kind: "viewed" as const })),
    ...asked.map((row) => ({ ...row, kind: "asked" as const })),
    ...quizzed.map((row) => ({ ...row, kind: "quiz" as const })),
  ];
}

export async function planRecall(learnerId: string): Promise<RecallPlan | undefined> {
  const records = await loadRecallRecords(learnerId);
  const sourceStudyDay = recallRange(records.map((record) => record.studyDay)).at(-1);
  const items = assignFormats(pickRecallTargets(records));
  if (!sourceStudyDay || items.length === 0) return undefined;
  return { sourceStudyDay, items };
}
