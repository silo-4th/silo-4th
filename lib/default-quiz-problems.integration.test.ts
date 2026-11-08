import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { concept, learner, quizAttempt, quizProblem } from "@/lib/db/schema";
import type { DefaultQuizProblem } from "@/lib/default-quiz-problems";
import { defaultQuizProblemsSql } from "@/lib/default-quiz-problems-sql";
import { parseQuizProblem } from "@/lib/quiz-problem";
import { studyDay } from "@/lib/study-day";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const SCREEN_REFERENCES = /본문|위 표/;

function activeDefaults(db: Db | Tx) {
  return db
    .select()
    .from(quizProblem)
    .where(and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt)));
}

function choiceProblem(conceptId: string, stem: string): DefaultQuizProblem {
  return {
    conceptId,
    format: "mcq",
    stem,
    hint: `${stem} 힌트`,
    explanation: `${stem} 해설`,
    answer: { choices: [{ text: "맞음" }, { text: "틀림" }], answerIndex: 0 },
  };
}

// drizzle 마이그레이터처럼 문장 구분자로 나눠 하나씩 실행한다.
async function apply(tx: Tx, migration: string) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await tx.execute(sql.raw(statement));
  }
}

async function rolledBack(work: (tx: Tx) => Promise<void>) {
  try {
    await getDb().transaction(async (tx) => {
      await work(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

describe("기본 문제 데이터", () => {
  it("TC-146 마이그레이션 뒤 모든 절에 기본 문제가 하나 이상, 단원마다 5개 이상 있고, 모두 문제 모양 검사를 통과해요", async () => {
    const db = getDb();
    const concepts = await db.select({ id: concept.id, unitId: concept.unitId }).from(concept);
    const problems = await activeDefaults(db);

    expect(concepts.length).toBeGreaterThan(0);
    const unitIds = new Set(concepts.map((found) => found.unitId));
    for (const { id } of concepts) {
      const count = problems.filter((problem) => problem.conceptId === id).length;
      expect(count, `${id} 절의 기본 문제 수`).toBeGreaterThanOrEqual(1);
    }
    for (const unitId of unitIds) {
      const inUnit = new Set(concepts.filter((found) => found.unitId === unitId).map((found) => found.id));
      const count = problems.filter((problem) => inUnit.has(problem.conceptId)).length;
      expect(count, `${unitId} 단원의 기본 문제 수`).toBeGreaterThanOrEqual(5);
    }
    for (const { id, format, stem, answer, hint, explanation } of problems) {
      expect(parseQuizProblem({ format, stem, answer, hint, explanation }), `${id} 문제 모양`).toBeDefined();
      expect(stem, `${id} 문제 지문`).not.toMatch(SCREEN_REFERENCES);
    }
  });

  it("TC-149 이전 기본 문제 위에 새 기본 문제 마이그레이션을 적용하면 모듈의 문제만 활성으로 남고, 빠진 문제는 지워지지 않고 내려가요", async () => {
    const tag = randomUUID();
    const a = choiceProblem("s2-05-1", `문제 A ${tag}`);
    const b = choiceProblem("s2-05-2", `문제 B ${tag}`);
    const c = choiceProblem("s2-05-3", `문제 C ${tag}`);
    const fixedB = { ...b, stem: `고친 문제 B ${tag}` };

    await rolledBack(async (tx) => {
      const [person] = await tx
        .insert(learner)
        .values({ name: "테스트 학습자", email: `${tag}@tc.test` })
        .returning();
      if (!person) throw new Error("학습자를 넣지 못했다.");
      const [own] = await tx
        .insert(quizProblem)
        .values({ ...choiceProblem("s2-05-1", `학습자 문제 ${tag}`), learnerId: person.id })
        .returning();
      if (!own) throw new Error("학습자 문제를 넣지 못했다.");

      await apply(tx, defaultQuizProblemsSql([a, b, c]));
      const afterV1 = await activeDefaults(tx);
      const rowA = afterV1.find((row) => row.stem === a.stem);
      const oldB = afterV1.find((row) => row.stem === b.stem);
      const rowC = afterV1.find((row) => row.stem === c.stem);
      if (!rowA || !oldB || !rowC) throw new Error("v1 기본 문제가 들어가지 않았다.");
      const attemptId = randomUUID();
      await tx.insert(quizAttempt).values({
        id: attemptId,
        learnerId: person.id,
        problemId: oldB.id,
        studyDay: studyDay(new Date()),
        chosenIndex: 0,
        confidence: "sure",
        isCorrect: true,
        appVersion: "test-version",
      });

      const v2 = defaultQuizProblemsSql([a, fixedB]);
      await apply(tx, v2);
      await apply(tx, v2);

      const active = await activeDefaults(tx);
      expect(active.map((row) => row.stem).sort()).toEqual([a.stem, fixedB.stem].sort());
      expect(active.find((row) => row.stem === a.stem)).toEqual(rowA);
      for (const gone of [oldB, rowC]) {
        const [row] = await tx.select().from(quizProblem).where(eq(quizProblem.id, gone.id));
        expect(row, `${gone.stem} 줄`).toBeDefined();
        expect(row?.retiredAt).not.toBeNull();
      }
      const newB = active.find((row) => row.stem === fixedB.stem);
      expect(newB?.id).not.toBe(oldB.id);
      const [attempt] = await tx.select().from(quizAttempt).where(eq(quizAttempt.id, attemptId));
      expect(attempt?.problemId).toBe(oldB.id);
      const [ownAfter] = await tx.select().from(quizProblem).where(eq(quizProblem.id, own.id));
      expect(ownAfter).toEqual(own);
    });
  });
});
