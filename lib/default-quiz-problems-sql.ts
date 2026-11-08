import { createHash } from "node:crypto";
import type { DefaultQuizProblem } from "@/lib/default-quiz-problems";
import { parseQuizProblem } from "@/lib/quiz-problem";

// 마이그레이션 태그가 이 이름으로 끝나야 생성기와 TC-147이 기본 문제 마이그레이션으로 알아본다.
export const DEFAULT_QUIZ_PROBLEMS_MIGRATION_NAME = "default_quiz_problems";

const BREAKPOINT = "\n--> statement-breakpoint\n";

// 내용이 같으면 늘 같은 ID가 나와, 같은 SQL을 여러 번 적용해도 한 벌만 남는다. 한 글자라도 바뀌면 새 문제가 된다.
export function defaultQuizProblemId(problem: DefaultQuizProblem) {
  const { conceptId, format, stem, answer, hint, explanation } = problem;
  const hex = createHash("sha256")
    .update(JSON.stringify([conceptId, format, stem, answer, hint, explanation]))
    .digest("hex");
  const variant = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function checked(problem: DefaultQuizProblem) {
  const { conceptId, ...content } = problem;
  const parsed = parseQuizProblem(content);
  if (!parsed) throw new Error(`${conceptId}의 기본 문제가 모양 검사를 통과하지 못했다: ${problem.stem}`);
  return { conceptId, ...parsed };
}

// 어느 DB에 몇 번 적용해도 활성 기본 문제가 모듈과 같아진다. 풀이가 가리킬 수 있으므로 빠진 문제는 지우지 않고 내린다.
export function defaultQuizProblemsSql(problems: readonly DefaultQuizProblem[]) {
  if (problems.length === 0) throw new Error("기본 문제가 하나도 없다.");
  const rows = problems.map(checked).map((problem) => ({ id: defaultQuizProblemId(problem), ...problem }));
  const ids = rows.map((row) => row.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`내용이 같은 기본 문제가 두 번 있다: ${duplicate}`);

  const values = rows
    .map(
      (row) =>
        `\t(${[
          literal(row.id),
          literal(row.conceptId),
          literal(row.format),
          literal(row.stem),
          `${literal(JSON.stringify(row.answer))}::jsonb`,
          literal(row.hint),
          literal(row.explanation),
        ].join(", ")})`,
    )
    .join(",\n");
  const idList = ids.map(literal).join(", ");

  return [
    [
      "-- lib/default-quiz-problems.ts에서 만든 파일이다. 손으로 고치지 않고 npm run quiz:defaults:migration으로 새로 만든다.",
      "-- 다시 들어온 문제는 내려가 있어도 다시 활성으로 둔다.",
      `INSERT INTO "quiz_problems" ("id", "concept_id", "format", "stem", "answer", "hint", "explanation") VALUES`,
      values,
      `ON CONFLICT ("id") DO UPDATE SET "retired_at" = NULL;`,
    ].join("\n"),
    [
      "-- 모듈에서 빠진 기본 문제는 내린다. 학습자에게 만든 문제는 건드리지 않는다.",
      `UPDATE "quiz_problems" SET "retired_at" = now()`,
      `WHERE "learner_id" IS NULL AND "retired_at" IS NULL AND "id" NOT IN (${idList});`,
    ].join("\n"),
  ].join(BREAKPOINT) + "\n";
}
