import "server-only";
import { captureException } from "@sentry/nextjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { safeMessage } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import { CONFIDENCES, concept, type QuizAnswer, quizAttempt, quizProblem, recallItem, recallSet, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { gradeFreeAnswer } from "@/lib/llm/grading";
import {
  type BlankAnswer,
  type ChoiceAnswer,
  type FreeAnswer,
  type GradableProblem,
  gradeBlank,
  gradeChoice,
  toGradable,
} from "@/lib/quiz-grading";
import type { PastAttempt } from "@/lib/past-problems";
import { MAX_ANSWER_LENGTH } from "@/lib/quiz-flow";
import { studyDay } from "@/lib/study-day";
import { isUuid } from "@/lib/uuid";

type Confidence = (typeof CONFIDENCES)[number];

export type AttemptInput = {
  attemptId: string;
  problemId: string;
  // 꺼내 먹기 문항을 풀 때만 보낸다. 퀴즈 탭 풀이에는 없다.
  recallItemId?: string;
  chosenIndex: number | null;
  // 공백만 있으면 비어 있는 것으로 바꿔 둔다.
  answerText: string | null;
  confidence: Confidence | null;
  hintUsed: boolean;
  dontKnow: boolean;
};

// 채점 결과와 함께 정답과 해설을 내려준다. 서술형 AI 채점이 실패하면 채점 결과만 빠진다.
export type AttemptResult =
  | { outcome: "graded"; isCorrect: boolean; answer: QuizAnswer; explanation: string }
  | { outcome: "ungraded"; answer: QuizAnswer; explanation: string };

export type Submission =
  | { kind: "saved"; result: AttemptResult }
  | { kind: "invalid" }
  | { kind: "unknown-problem" }
  | { kind: "unknown-recall-item" }
  | { kind: "already-answered" }
  | { kind: "not-yours" };

// 학습자의 답은 쿼리 값으로 오류 메시지에 담긴다. 값을 지운 메시지만 Sentry로 보낸다.
export function reportQuizError(error: unknown) {
  captureException(new Error(safeMessage(error, "quiz-attempts")));
}

function isConfidence(value: unknown): value is Confidence {
  return CONFIDENCES.some((confidence) => confidence === value);
}

// 요청 본문은 화면을 거치지 않고도 보낼 수 있어 아무 값이나 올 수 있다. 채점 결과처럼 모르는 필드는 버린다.
export function parseAttemptInput(input: unknown): AttemptInput | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { attemptId, problemId, recallItemId, chosenIndex, answerText, confidence, hintUsed, dontKnow } =
    input as Record<string, unknown>;
  if (!isUuid(attemptId) || !isUuid(problemId)) return undefined;
  if (recallItemId != null && !isUuid(recallItemId)) return undefined;
  const isIndex = typeof chosenIndex === "number" && Number.isInteger(chosenIndex) && chosenIndex >= 0;
  // 비어 있는 답 칸은 빼고 보내도, null로 보내도 같게 본다.
  if (chosenIndex != null && !isIndex) return undefined;
  if (answerText != null && (typeof answerText !== "string" || answerText.length > MAX_ANSWER_LENGTH)) {
    return undefined;
  }
  if (confidence != null && !isConfidence(confidence)) return undefined;
  if (typeof hintUsed !== "boolean" || typeof dontKnow !== "boolean") return undefined;
  return {
    attemptId,
    problemId,
    ...(recallItemId != null && { recallItemId }),
    chosenIndex: chosenIndex ?? null,
    answerText: answerText?.trim() ? answerText : null,
    confidence: confidence ?? null,
    hintUsed,
    dontKnow,
  };
}

// 포맷에 맞게 받은 답이다. 채점에 쓸 정답을 함께 들고 다닌다.
// 잘 모르겠어요는 서술형에만 있고, 그때만 확신도가 비어도 받는다.
type Answer =
  | { kind: "choice"; chosenIndex: number; confidence: Confidence; key: ChoiceAnswer }
  | { kind: "blank"; text: string; confidence: Confidence; key: BlankAnswer }
  | { kind: "free"; text: string; confidence: Confidence; key: FreeAnswer }
  | { kind: "dont-know"; text: string | null };

function answerFor(
  problem: GradableProblem,
  { chosenIndex, answerText, confidence, dontKnow }: AttemptInput,
): Answer | undefined {
  if (problem.format === "free" && dontKnow) {
    return confidence === null ? { kind: "dont-know", text: answerText } : undefined;
  }
  if (dontKnow || confidence === null) return undefined;
  switch (problem.format) {
    case "mcq":
      if (chosenIndex === null || chosenIndex >= problem.answer.choices.length) return undefined;
      return { kind: "choice", chosenIndex, confidence, key: problem.answer };
    case "blank":
      return answerText === null ? undefined : { kind: "blank", text: answerText, confidence, key: problem.answer };
    case "free":
      return answerText === null ? undefined : { kind: "free", text: answerText, confidence, key: problem.answer };
  }
}

function answerColumns(answer: Answer) {
  switch (answer.kind) {
    case "choice":
      return { chosenIndex: answer.chosenIndex, answerText: null, confidence: answer.confidence };
    case "blank":
    case "free":
      return { chosenIndex: null, answerText: answer.text, confidence: answer.confidence };
    case "dont-know":
      return { chosenIndex: null, answerText: answer.text, confidence: "guess" as const };
  }
}

type Problem = Pick<typeof quizProblem.$inferSelect, "stem" | "hint" | "explanation">;

// 잘 모르겠어요는 찍어서 틀린 풀이로 남긴다. 서술형 AI 채점이 실패하면 null을 돌려준다.
async function grade(answer: Answer, problem: Problem): Promise<boolean | null> {
  switch (answer.kind) {
    case "choice":
      return gradeChoice(answer.key, answer.chosenIndex);
    case "blank":
      return gradeBlank(answer.key, answer.text);
    case "dont-know":
      return false;
    case "free":
      try {
        return await gradeFreeAnswer({ ...problem, ...answer.key, answer: answer.text });
      } catch (error) {
        reportQuizError(error);
        return null;
      }
  }
}

type SavedAttempt = Pick<typeof quizAttempt.$inferSelect, "learnerId" | "isCorrect"> &
  Pick<typeof quizProblem.$inferSelect, "answer" | "explanation">;

export function toResult({ isCorrect, answer, explanation }: Omit<SavedAttempt, "learnerId">): AttemptResult {
  return isCorrect === null
    ? { outcome: "ungraded", answer, explanation }
    : { outcome: "graded", isCorrect, answer, explanation };
}

async function savedAttempt(attemptId: string): Promise<SavedAttempt | undefined> {
  const [saved] = await getDb()
    .select({
      learnerId: quizAttempt.learnerId,
      isCorrect: quizAttempt.isCorrect,
      answer: quizProblem.answer,
      explanation: quizProblem.explanation,
    })
    .from(quizAttempt)
    .innerJoin(quizProblem, eq(quizProblem.id, quizAttempt.problemId))
    .where(eq(quizAttempt.id, attemptId));
  return saved;
}

// 같은 풀이 ID가 다시 오면 다시 채점하지 않고 처음 저장한 결과를 그대로 돌려준다.
function replay(saved: SavedAttempt, learnerId: string): Submission {
  return saved.learnerId === learnerId ? { kind: "saved", result: toResult(saved) } : { kind: "not-yours" };
}

// 꺼내 먹기 풀이는 내 세트의 문항이어야 하고, 그 문항이 낸 문제여야 하며, 문항마다 한 번만 푼다.
async function refuseRecallItem(learnerId: string, itemId: string, problemId: string): Promise<Submission | undefined> {
  const [item] = await getDb()
    .select({ learnerId: recallSet.learnerId, problemId: recallItem.problemId, answeredId: quizAttempt.id })
    .from(recallItem)
    .innerJoin(recallSet, eq(recallSet.id, recallItem.setId))
    .leftJoin(quizAttempt, eq(quizAttempt.recallItemId, recallItem.id))
    .where(eq(recallItem.id, itemId));
  if (!item) return { kind: "unknown-recall-item" };
  if (item.learnerId !== learnerId) return { kind: "not-yours" };
  if (item.problemId !== problemId) return { kind: "invalid" };
  if (item.answeredId !== null) return { kind: "already-answered" };
  return undefined;
}

export async function submitAttempt(learnerId: string, input: AttemptInput): Promise<Submission> {
  const existing = await savedAttempt(input.attemptId);
  if (existing) return replay(existing, learnerId);

  const db = getDb();
  // 내려간 문제도 받는다. 학습자가 풀던 중에 내려갔을 수 있다.
  const [problem] = await db
    .select({
      id: quizProblem.id,
      learnerId: quizProblem.learnerId,
      format: quizProblem.format,
      stem: quizProblem.stem,
      answer: quizProblem.answer,
      hint: quizProblem.hint,
      explanation: quizProblem.explanation,
    })
    .from(quizProblem)
    .where(eq(quizProblem.id, input.problemId));
  if (!problem) return { kind: "unknown-problem" };
  // 기본 문제는 누구나 풀고, 학습자에게 만든 문제는 그 학습자만 푼다.
  if (problem.learnerId !== null && problem.learnerId !== learnerId) return { kind: "not-yours" };
  if (input.recallItemId) {
    const refused = await refuseRecallItem(learnerId, input.recallItemId, problem.id);
    // 처음 확인 뒤에 같은 풀이 ID의 다른 요청이 먼저 저장했으면, 이 요청은 재전송이므로 저장된 결과를 돌려준다.
    if (refused?.kind === "already-answered") {
      const saved = await savedAttempt(input.attemptId);
      if (saved) return replay(saved, learnerId);
    }
    if (refused) return refused;
  }
  const gradable = toGradable(problem.format, problem.answer);
  const answer = answerFor(gradable, input);
  if (!answer) return { kind: "invalid" };

  // 학습자가 답을 낸 시각이다. 서술형 채점을 기다리는 시간은 넣지 않는다.
  const answeredAt = new Date();
  const isCorrect = await grade(answer, problem);
  const [inserted] = await db
    .insert(quizAttempt)
    .values({
      id: input.attemptId,
      learnerId,
      problemId: problem.id,
      recallItemId: input.recallItemId ?? null,
      studyDay: studyDay(answeredAt),
      ...answerColumns(answer),
      hintUsed: input.hintUsed,
      isCorrect,
      answeredAt,
      appVersion: env.APP_VERSION,
    })
    .onConflictDoNothing()
    .returning({ id: quizAttempt.id });
  if (inserted) {
    return { kind: "saved", result: toResult({ isCorrect, answer: problem.answer, explanation: problem.explanation }) };
  }
  // 같은 풀이 ID가 동시에 왔으면 먼저 저장한 요청의 결과를 따른다.
  // 그 풀이 ID가 없으면 다른 풀이 ID로 같은 꺼내 먹기 문항을 동시에 푼 것이다.
  const saved = await savedAttempt(input.attemptId);
  if (!saved) {
    if (input.recallItemId) return { kind: "already-answered" };
    throw new Error("겹친 풀이 ID의 풀이를 읽지 못했다.");
  }
  return replay(saved, learnerId);
}

// 퀴즈 탭에서 푼 풀이만 돌려준다. 관련 문제 풀어보기도 퀴즈 탭에서 풀어서 함께 오고, 꺼내 먹기 풀이는 결과 화면이 따로 있어 뺀다.
// 풀고 난 뒤 내려간 문제도 지난 기록이라 그대로 보여 준다.
export async function listPastAttempts(learnerId: string): Promise<PastAttempt[]> {
  const rows = await getDb()
    .select({
      attemptId: quizAttempt.id,
      answeredAt: quizAttempt.answeredAt,
      unitTitle: unit.title,
      format: quizProblem.format,
      stem: quizProblem.stem,
      chosenIndex: quizAttempt.chosenIndex,
      answerText: quizAttempt.answerText,
      confidence: quizAttempt.confidence,
      isCorrect: quizAttempt.isCorrect,
      answer: quizProblem.answer,
      explanation: quizProblem.explanation,
    })
    .from(quizAttempt)
    .innerJoin(quizProblem, eq(quizProblem.id, quizAttempt.problemId))
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .innerJoin(unit, eq(unit.id, concept.unitId))
    .where(and(eq(quizAttempt.learnerId, learnerId), isNull(quizAttempt.recallItemId)))
    .orderBy(desc(quizAttempt.answeredAt));
  return rows.map((row) => ({ ...row, answeredAt: row.answeredAt.toISOString() }));
}
