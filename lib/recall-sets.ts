import "server-only";
import { captureException } from "@sentry/nextjs";
import { CodedError } from "@/lib/errors/codes";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { safeMessage } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import { concept, quizAttempt, quizProblem, type RECALL_REASONS, recallItem, recallSet, sectionView, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { type AttemptInput, type AttemptResult, toResult } from "@/lib/quiz-attempts";
import { type ProblemView, problemViewColumns, toProblemView } from "@/lib/quiz-problems";
import { studyDay } from "@/lib/study-day";
import { conceptSection, type SectionAddress, type StudyTarget } from "@/lib/unit-sections";

export const RECALL_EVENTS = ["postpone", "start", "complete"] as const;
export type RecallEvent = (typeof RECALL_EVENTS)[number];

export type RecallSetView = {
  id: string;
  items: {
    id: string;
    position: number;
    reason: (typeof RECALL_REASONS)[number];
    problem: ProblemView;
    // 입구 줄 오른쪽에 개념이 나온 단원 이름을 보여 준다.
    unitTitle?: string;
    section?: SectionAddress;
    // 이미 푼 문항에만 있다. 이어 풀 때 결과에 처음 풀이를 그대로 보여 준다.
    answered?: { submitted: AttemptInput; result: AttemptResult };
  }[];
  started?: true;
  // 결과 화면에서 오늘 공부를 이어 갈 곳이다. 가장 최근에 처음 본 절이고, 그 소제목이 본문에 없으면 그 단원, 본 절이 없으면 첫 단원이다.
  studyFrom?: StudyTarget;
};

export type Recorded = "recorded" | "unknown" | "not-yours";
export type EventOutcome = Recorded | "out-of-order";

type SetTimes = Pick<typeof recallSet.$inferSelect, "shownAt" | "postponedAt" | "startedAt" | "completedAt">;

// 세트 상태는 채워진 마지막 시각이다. 기록마다 채울 컬럼과 그 기록을 받을 수 있는 상태를 둔다.
// 마친 세트는 시작 시각도 있으므로, 시작을 다시 보내면 같은 기록으로 본다.
const EVENT_RULES: Record<RecallEvent, { column: keyof SetTimes; accepts: (set: SetTimes) => boolean }> = {
  postpone: { column: "postponedAt", accepts: (set) => set.shownAt !== null && set.startedAt === null },
  start: { column: "startedAt", accepts: (set) => set.shownAt !== null },
  complete: { column: "completedAt", accepts: (set) => set.startedAt !== null },
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRecallEvent(value: unknown): value is RecallEvent {
  return RECALL_EVENTS.some((event) => event === value);
}

// 운영이 아닌 환경에서는 하루를 당겨, 오늘 기록으로 만든 세트를 다음 날까지 기다리지 않고 확인할 수 있게 한다.
export function recallToday(advanceDay: boolean, now = new Date()) {
  const advance = advanceDay && env.VERCEL_ENV !== "production";
  return studyDay(advance ? new Date(now.getTime() + DAY_MS) : now);
}

// 기준일이 오늘보다 앞선 세트 가운데 가장 최근 것 하나만 띄운다. 그 세트를 마쳤거나 미뤘으면 더 오래된 세트로 넘어가지 않는다.
// 마치거나 미루기 전에는 같은 세트를 다시 돌려줘, 응답을 받지 못했거나 새로고침한 학습자가 세트를 잃지 않게 한다.
// 띄운 시각은 처음 띄운 때만 채운다. 문항을 읽다 실패하면 처음 채운 띄운 시각도 되돌린다.
export async function showTodaySet(learnerId: string, today: string): Promise<RecallSetView | null> {
  return getDb().transaction(async (tx) => {
    const latest = tx
      .select({ id: recallSet.id })
      .from(recallSet)
      .where(and(eq(recallSet.learnerId, learnerId), lt(recallSet.sourceStudyDay, today)))
      .orderBy(desc(recallSet.sourceStudyDay))
      .limit(1);
    const [shown] = await tx
      .update(recallSet)
      .set({ shownAt: sql`coalesce(${recallSet.shownAt}, now())` })
      .where(and(inArray(recallSet.id, latest), isNull(recallSet.completedAt), isNull(recallSet.postponedAt)))
      .returning({ id: recallSet.id, startedAt: recallSet.startedAt });
    if (!shown) return null;

    const items = await tx
      .select({
        id: recallItem.id,
        position: recallItem.position,
        reason: recallItem.reason,
        problem: problemViewColumns,
        unitId: concept.unitId,
        unitTitle: unit.title,
        content: unit.content,
        attempt: {
          id: quizAttempt.id,
          chosenIndex: quizAttempt.chosenIndex,
          answerText: quizAttempt.answerText,
          confidence: quizAttempt.confidence,
          hintUsed: quizAttempt.hintUsed,
          isCorrect: quizAttempt.isCorrect,
        },
        explanation: quizProblem.explanation,
      })
      .from(recallItem)
      .innerJoin(quizProblem, eq(quizProblem.id, recallItem.problemId))
      .leftJoin(quizAttempt, eq(quizAttempt.recallItemId, recallItem.id))
      .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
      .innerJoin(unit, eq(unit.id, concept.unitId))
      .where(eq(recallItem.setId, shown.id))
      .orderBy(asc(recallItem.position));
    const [lastSeen] = await tx
      .select({ conceptId: sectionView.conceptId, unitId: concept.unitId, content: unit.content })
      .from(sectionView)
      .innerJoin(concept, eq(concept.id, sectionView.conceptId))
      .innerJoin(unit, eq(unit.id, concept.unitId))
      .where(eq(sectionView.learnerId, learnerId))
      .orderBy(desc(sectionView.firstSeenAt))
      .limit(1);
    const [firstUnit] = await tx.select({ id: unit.id }).from(unit).orderBy(asc(unit.id)).limit(1);
    const studyFrom: StudyTarget | undefined =
      (lastSeen && conceptSection(lastSeen.unitId, lastSeen.content, lastSeen.conceptId)) ??
      (lastSeen && { unitId: lastSeen.unitId }) ??
      (firstUnit && { unitId: firstUnit.id });
    return {
      id: shown.id,
      items: items.map(({ unitId, content, attempt, explanation, ...item }) => {
        const section = conceptSection(unitId, content, item.problem.conceptId);
        return {
          ...item,
          problem: toProblemView(item.problem),
          ...(section && { section }),
          ...(attempt && {
            answered: {
              submitted: {
                attemptId: attempt.id,
                problemId: item.problem.id,
                recallItemId: item.id,
                chosenIndex: attempt.chosenIndex,
                answerText: attempt.answerText,
                confidence: attempt.confidence,
                hintUsed: attempt.hintUsed,
                // 잘 모르겠어요는 따로 저장하지 않는다. 고른 답도 적은 글도 없는 풀이는 잘 모르겠어요로만 생긴다.
                dontKnow: attempt.chosenIndex === null && attempt.answerText === null,
              },
              result: toResult({ isCorrect: attempt.isCorrect, answer: item.problem.answer, explanation }),
            },
          }),
        };
      }),
      ...(shown.startedAt && { started: true as const }),
      ...(studyFrom && { studyFrom }),
    };
  });
}

// 같은 기록이 다시 오면 처음 시각을 그대로 둔다. 세트를 잠그고 상태를 읽어, 동시에 온 기록이 순서를 건너뛰지 못하게 한다.
export async function recordSetEvent(learnerId: string, setId: string, event: RecallEvent): Promise<EventOutcome> {
  return getDb().transaction(async (tx) => {
    const [set] = await tx.select().from(recallSet).where(eq(recallSet.id, setId)).for("update");
    if (!set) return "unknown";
    if (set.learnerId !== learnerId) return "not-yours";
    const { column, accepts } = EVENT_RULES[event];
    if (set[column] !== null) return "recorded";
    if (!accepts(set)) return "out-of-order";
    await tx
      .update(recallSet)
      .set({ [column]: new Date() })
      .where(eq(recallSet.id, setId));
    return "recorded";
  });
}

// 결과에서 문항의 절로 처음 이동한 시각만 남긴다.
export async function markSectionOpened(learnerId: string, itemId: string): Promise<Recorded> {
  const db = getDb();
  const [item] = await db
    .select({ learnerId: recallSet.learnerId })
    .from(recallItem)
    .innerJoin(recallSet, eq(recallSet.id, recallItem.setId))
    .where(eq(recallItem.id, itemId));
  if (!item) return "unknown";
  if (item.learnerId !== learnerId) return "not-yours";
  await db
    .update(recallItem)
    .set({ openedSectionAt: new Date() })
    .where(and(eq(recallItem.id, itemId), isNull(recallItem.openedSectionAt)));
  return "recorded";
}

export function reportRecallError(error: unknown) {
  captureException(new CodedError("RECALL_SET_FAILED", safeMessage(error, "recall-sets")));
}
