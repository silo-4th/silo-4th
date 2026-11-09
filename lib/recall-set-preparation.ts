import "server-only";
import { randomUUID } from "node:crypto";
import { captureException } from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { safeMessage } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import { concept, quizProblem, recallItem, recallSet, unit } from "@/lib/db/schema";
import type { GenerationContext } from "@/lib/llm/quiz-generation";
import type { QuizProblemContent } from "@/lib/quiz-problem";
import { conceptDefaultProblemId, conversationOf, generateProblemContent } from "@/lib/quiz-problems";
import { planRecall } from "@/lib/recall-records";
import type { RecallItem } from "@/lib/recall-targets";
import { studyDay } from "@/lib/study-day";

type PreparedItem = { item: RecallItem; problemId: string; generated?: QuizProblemContent };

const NO_CONVERSATION: GenerationContext = { kind: "summaries", summaries: [] };

export function reportRecallSetError(error: unknown) {
  captureException(new Error(safeMessage(error, "recall-sets")));
}

async function generateFor(item: RecallItem) {
  const [target] = await getDb()
    .select({ title: concept.title, unitContent: unit.content })
    .from(concept)
    .innerJoin(unit, eq(unit.id, concept.unitId))
    .where(eq(concept.id, item.conceptId));
  if (!target) throw new Error(`절 ${item.conceptId}을 찾지 못했다.`);
  return generateProblemContent({
    unitContent: target.unitContent,
    target: { conceptId: item.conceptId, title: target.title },
    format: item.format,
    context: item.reason === "asked" ? await conversationOf(item.sourceQuestionId) : NO_CONVERSATION,
  });
}

// AI가 실패하면 그 절의 기본 문제로 대신한다. 기본 문제도 없으면 그 문항만 빼서 나머지 세트는 만든다.
async function prepareItem(learnerId: string, item: RecallItem): Promise<PreparedItem | undefined> {
  try {
    return { item, problemId: randomUUID(), generated: await generateFor(item) };
  } catch (error) {
    reportRecallSetError(error);
  }
  const problemId = await conceptDefaultProblemId(learnerId, item.conceptId);
  if (problemId) return { item, problemId };
  reportRecallSetError(new Error(`절 ${item.conceptId}에 기본 문제가 없어 문항에서 뺐다.`));
  return undefined;
}

// 다음 날 첫 진입에 끝난 학습일 기록으로 세트를 만든다. 그 기준일 세트가 이미 있으면 아무것도 하지 않는다.
export async function prepareRecallSet(learnerId: string, now = new Date()) {
  const plan = await planRecall(learnerId, studyDay(now));
  if (!plan) return;
  const db = getDb();
  const [existing] = await db
    .select({ id: recallSet.id })
    .from(recallSet)
    .where(and(eq(recallSet.learnerId, learnerId), eq(recallSet.sourceStudyDay, plan.sourceStudyDay)));
  if (existing) return;

  const prepared = (await Promise.all(plan.items.map((item) => prepareItem(learnerId, item)))).filter(
    (found) => found !== undefined,
  );
  if (prepared.length === 0) return;
  // AI가 만든 문제는 세트와 같은 트랜잭션에서 저장해, 동시 요청에서 진 쪽의 문제가 남지 않게 한다.
  await db.transaction(async (tx) => {
    const [set] = await tx
      .insert(recallSet)
      .values({ learnerId, sourceStudyDay: plan.sourceStudyDay })
      .onConflictDoNothing()
      .returning({ id: recallSet.id });
    if (!set) return;
    const generated = prepared.flatMap(({ item, problemId, generated: content }) =>
      content
        ? [
            {
              ...content,
              id: problemId,
              learnerId,
              conceptId: item.conceptId,
              sourceQuestionId: item.reason === "asked" ? item.sourceQuestionId : null,
            },
          ]
        : [],
    );
    if (generated.length > 0) await tx.insert(quizProblem).values(generated);
    await tx.insert(recallItem).values(
      prepared.map(({ item, problemId }, index) => ({
        setId: set.id,
        position: index + 1,
        reason: item.reason,
        sourceQuestionId: item.reason === "asked" ? item.sourceQuestionId : null,
        problemId,
      })),
    );
  });
}
