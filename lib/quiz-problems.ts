import "server-only";
import { captureException } from "@sentry/nextjs";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  gte,
  ne,
  type SQL,
} from "drizzle-orm";
import { safeMessage } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import {
  concept,
  message,
  QUIZ_FORMATS,
  question,
  questionConcept,
  quizAttempt,
  quizProblem,
  sectionView,
  unit,
} from "@/lib/db/schema";
import {
  type GenerationContext,
  type GenerationInput,
  generateQuizProblem,
} from "@/lib/llm/quiz-generation";
import { type QuizProblemContent, parseQuizProblem } from "@/lib/quiz-problem";
import { isUuid } from "@/lib/uuid";

// 퀴즈 탭은 열어 둔 단원으로, 관련 문제 풀어보기는 그 질문으로 부른다.
export type ProblemRequest =
  { kind: "unit"; unitId: string } | { kind: "question"; questionId: string };

// 정답과 해설은 풀이를 저장한 뒤 풀이 저장 응답으로만 내려준다.
export type ProblemView = {
  id: string;
  format: (typeof QUIZ_FORMATS)[number];
  conceptId: string;
  conceptTitle: string;
  stem: string;
  hint: string;
  choices?: string[];
};

export type Creation =
  | { kind: "ok"; problem: ProblemView }
  | { kind: "unknown-unit" }
  | { kind: "unknown-question" }
  | { kind: "generation-failed" };

type Concept = { id: string; title: string };

const SUMMARY_LIMIT = 5;

export function reportQuizProblemError(error: unknown) {
  captureException(new Error(safeMessage(error, "quiz-problems")));
}

// 요청 본문은 화면을 거치지 않고도 보낼 수 있어 아무 값이나 올 수 있다.
export function parseProblemRequest(
  input: unknown,
): ProblemRequest | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { unitId, questionId } = input as Record<string, unknown>;
  if (isUuid(questionId))
    return { kind: "question", questionId };
  if (questionId !== undefined) return undefined;
  if (typeof unitId === "string" && unitId) return { kind: "unit", unitId };
  return undefined;
}

function pickRandom<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

function uniqueById(concepts: Concept[]) {
  return [...new Map(concepts.map((found) => [found.id, found])).values()];
}

async function viewedConcepts(
  learnerId: string,
  unitId: string,
): Promise<Concept[]> {
  const rows = await getDb()
    .selectDistinct({ id: concept.id, title: concept.title })
    .from(sectionView)
    .innerJoin(concept, eq(concept.id, sectionView.conceptId))
    .where(
      and(eq(sectionView.learnerId, learnerId), eq(concept.unitId, unitId)),
    );
  return rows;
}

async function askedConcepts(
  learnerId: string,
  unitId: string,
): Promise<Concept[]> {
  const rows = await getDb()
    .selectDistinct({ id: concept.id, title: concept.title })
    .from(question)
    .innerJoin(questionConcept, eq(questionConcept.questionId, question.id))
    .innerJoin(concept, eq(concept.id, questionConcept.conceptId))
    .where(
      and(
        eq(question.learnerId, learnerId),
        eq(question.unitId, unitId),
        eq(concept.unitId, unitId),
      ),
    );
  return rows;
}

async function questionConcepts(questionId: string) {
  return getDb()
    .select({ id: concept.id, title: concept.title, unitId: concept.unitId })
    .from(questionConcept)
    .innerJoin(concept, eq(concept.id, questionConcept.conceptId))
    .where(eq(questionConcept.questionId, questionId));
}

// 이 학습자에게 아직 문제를 내지 않은 물어본 절을 먼저 내고, 그다음은 후보 절에서 무작위로 낸다.
async function pickTarget(
  learnerId: string,
  candidates: Concept[],
  asked: Concept[],
) {
  if (asked.length > 0) {
    const used = await getDb()
      .selectDistinct({ conceptId: quizProblem.conceptId })
      .from(quizProblem)
      .where(
        and(
          eq(quizProblem.learnerId, learnerId),
          inArray(
            quizProblem.conceptId,
            asked.map((found) => found.id),
          ),
        ),
      );
    const usedIds = new Set(used.map((row) => row.conceptId));
    const fresh = asked.filter((found) => !usedIds.has(found.id));
    if (fresh.length > 0) return pickRandom(fresh);
  }
  return pickRandom(candidates);
}

async function recentSummaries(
  learnerId: string,
  unitId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ summary: question.summary })
    .from(question)
    .where(
      and(
        eq(question.learnerId, learnerId),
        eq(question.unitId, unitId),
        isNotNull(question.summary),
        ne(question.summary, ""),
      ),
    )
    .orderBy(desc(question.askedAt))
    .limit(SUMMARY_LIMIT);
  return rows.flatMap((row) => (row.summary ? [row.summary] : [])).reverse();
}

export async function conversationOf(questionId: string): Promise<GenerationContext> {
  const rows = await getDb()
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.questionId, questionId))
    .orderBy(asc(message.seq));
  const join = (role: "user" | "assistant") =>
    rows
      .filter((row) => row.role === role)
      .map((row) => row.content)
      .join("\n\n");
  return {
    kind: "conversation",
    question: join("user"),
    answer: join("assistant"),
  };
}

type StoredProblem = Pick<
  typeof quizProblem.$inferSelect,
  "id" | "format" | "conceptId" | "stem" | "hint" | "answer"
> & { conceptTitle: string };

export function toProblemView({
  id,
  format,
  conceptId,
  conceptTitle,
  stem,
  hint,
  answer,
}: StoredProblem): ProblemView {
  const view: ProblemView = { id, format, conceptId, conceptTitle, stem, hint };
  if ("choices" in answer)
    view.choices = answer.choices.map((choice) => choice.text);
  return view;
}

// 정답과 해설을 뺀 문제 화면에 필요한 컬럼이다. concepts와 조인해서 읽는다.
export const problemViewColumns = {
  id: quizProblem.id,
  format: quizProblem.format,
  conceptId: quizProblem.conceptId,
  stem: quizProblem.stem,
  hint: quizProblem.hint,
  answer: quizProblem.answer,
  conceptTitle: concept.title,
};

// 이어 풀 문제다. solved이면 화면은 이 문제 대신 다음 문제를 만든다.
export type ResumedProblem = { problem: ProblemView; solved: boolean };

// 기본 문제는 주인이 없어 누구나 다시 불러온다. 다른 학습자의 문제는 없는 문제와 같이 undefined로 돌려준다.
// 내 문제는 한 번만 내므로 풀이가 있으면 푼 것이다. 기본 문제는 다 풀면 다시 내므로 shownAt 뒤의 풀이만 센다.
export async function resumeProblem(
  learnerId: string,
  problemId: string,
  shownAt: Date | undefined,
): Promise<ResumedProblem | undefined> {
  if (!isUuid(problemId)) return undefined;
  const db = getDb();
  const [found] = await db
    .select({ ...problemViewColumns, learnerId: quizProblem.learnerId })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(eq(quizProblem.id, problemId));
  if (!found || (found.learnerId !== null && found.learnerId !== learnerId))
    return undefined;
  const since =
    found.learnerId === null && shownAt
      ? gte(quizAttempt.answeredAt, shownAt)
      : undefined;
  const [attempt] = await db
    .select({ id: quizAttempt.id })
    .from(quizAttempt)
    .where(
      and(
        eq(quizAttempt.learnerId, learnerId),
        eq(quizAttempt.problemId, problemId),
        since,
      ),
    )
    .limit(1);
  return { problem: toProblemView(found), solved: attempt !== undefined };
}

// 기본 문제는 이 학습자가 아직 풀지 않은 것에서 내고, 다 풀었으면 다시 전체에서 낸다.
async function pickDefaultProblem(
  learnerId: string,
  scope: SQL | undefined,
): Promise<StoredProblem | undefined> {
  const db = getDb();
  const problems = await db
    .select(problemViewColumns)
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(
      and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt), scope),
    );
  if (problems.length === 0) return undefined;
  const solved = await db
    .selectDistinct({ problemId: quizAttempt.problemId })
    .from(quizAttempt)
    .where(
      and(
        eq(quizAttempt.learnerId, learnerId),
        inArray(
          quizAttempt.problemId,
          problems.map((problem) => problem.id),
        ),
      ),
    );
  const solvedIds = new Set(solved.map((row) => row.problemId));
  const unsolved = problems.filter((problem) => !solvedIds.has(problem.id));
  return pickRandom(unsolved.length > 0 ? unsolved : problems);
}

async function defaultProblem(
  learnerId: string,
  unitId: string,
): Promise<ProblemView> {
  const picked = await pickDefaultProblem(learnerId, eq(concept.unitId, unitId));
  if (!picked) throw new Error(`단원 ${unitId}에 기본 문제가 없다.`);
  return toProblemView(picked);
}

export async function conceptDefaultProblemId(
  learnerId: string,
  conceptId: string,
) {
  return (
    await pickDefaultProblem(learnerId, eq(quizProblem.conceptId, conceptId))
  )?.id;
}

// AI 출력은 모양 검사를 통과해야만 저장할 수 있는 문제가 된다.
export async function generateProblemContent(
  input: GenerationInput,
): Promise<QuizProblemContent> {
  const output = await generateQuizProblem(input);
  const content = parseQuizProblem({ ...output, format: input.format });
  if (!content)
    throw new Error(
      `AI가 만든 ${input.format} 문제가 모양 검사를 통과하지 못했다.`,
    );
  return content;
}

type Plan = {
  unitId: string;
  candidates: Concept[];
  asked: Concept[];
  context: GenerationContext;
  sourceQuestionId: string | null;
};

async function unitPlan(learnerId: string, unitId: string): Promise<Plan> {
  const [viewed, asked, summaries] = await Promise.all([
    viewedConcepts(learnerId, unitId),
    askedConcepts(learnerId, unitId),
    recentSummaries(learnerId, unitId),
  ]);
  return {
    unitId,
    candidates: uniqueById([...viewed, ...asked]),
    asked,
    context: { kind: "summaries", summaries },
    sourceQuestionId: null,
  };
}

// 질문은 모든 단원의 개념으로 분류되므로 그 질문을 한 단원의 개념만 쓴다. 없으면 그 단원의 후보 절로 만든다.
async function questionPlan(
  learnerId: string,
  questionId: string,
): Promise<Plan | undefined> {
  const [found] = await getDb()
    .select({ unitId: question.unitId })
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.learnerId, learnerId)));
  if (!found) return undefined;
  const [concepts, context] = await Promise.all([
    questionConcepts(questionId),
    conversationOf(questionId),
  ]);
  const unitId = found.unitId ?? concepts[0]?.unitId;
  if (!unitId) return undefined;
  const inUnit = concepts.filter((tagged) => tagged.unitId === unitId);
  const candidates =
    inUnit.length > 0
      ? inUnit
      : uniqueById([
          ...(await viewedConcepts(learnerId, unitId)),
          ...(await askedConcepts(learnerId, unitId)),
        ]);
  return {
    unitId,
    candidates,
    asked: [],
    context,
    sourceQuestionId: questionId,
  };
}

async function generate(
  learnerId: string,
  plan: Plan,
  unitContent: string,
): Promise<Creation> {
  const target = await pickTarget(learnerId, plan.candidates, plan.asked);
  if (!target)
    return {
      kind: "ok",
      problem: await defaultProblem(learnerId, plan.unitId),
    };
  const format = pickRandom(QUIZ_FORMATS) ?? "mcq";
  let content;
  try {
    content = await generateProblemContent({
      unitContent,
      target: { conceptId: target.id, title: target.title },
      format,
      context: plan.context,
    });
  } catch (error) {
    reportQuizProblemError(error);
    return { kind: "generation-failed" };
  }
  const [inserted] = await getDb()
    .insert(quizProblem)
    .values({
      ...content,
      learnerId,
      conceptId: target.id,
      sourceQuestionId: plan.sourceQuestionId,
    })
    .returning();
  if (!inserted) throw new Error("만든 문제를 저장하지 못했다.");
  return {
    kind: "ok",
    problem: toProblemView({ ...inserted, conceptTitle: target.title }),
  };
}

async function unitContent(unitId: string) {
  const [found] = await getDb()
    .select({ content: unit.content })
    .from(unit)
    .where(eq(unit.id, unitId));
  return found?.content;
}

export async function createProblem(
  learnerId: string,
  request: ProblemRequest,
): Promise<Creation> {
  if (request.kind === "unit") {
    const content = await unitContent(request.unitId);
    if (content === undefined) return { kind: "unknown-unit" };
    return generate(
      learnerId,
      await unitPlan(learnerId, request.unitId),
      content,
    );
  }
  const plan = await questionPlan(learnerId, request.questionId);
  const content = plan && (await unitContent(plan.unitId));
  if (!plan || content === undefined) return { kind: "unknown-question" };
  return generate(learnerId, plan, content);
}
