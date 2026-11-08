import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { concept, unit } from "@/lib/db/schema";
import { DEFAULT_QUIZ_PROBLEMS, type DefaultQuizProblem } from "@/lib/default-quiz-problems";
import { DEFAULT_QUIZ_PROBLEMS_MIGRATION_NAME, defaultQuizProblemsSql } from "@/lib/default-quiz-problems-sql";
import { generateQuizProblem } from "@/lib/llm/quiz-generation";
import { parseQuizProblem } from "@/lib/quiz-problem";

const MODULE_PATH = "lib/default-quiz-problems.ts";
const MIN_PER_UNIT = 5;
const ATTEMPTS = 3;
// 기본 문제는 학습 화면 없이 퀴즈 탭에서 바로 뜨므로, 화면의 본문이나 표를 가리키는 문제는 버린다.
// 지문 안에 직접 넣은 작은 데이터 표는 문제만 보고 풀 수 있으므로 받는다.
const SCREEN_REFERENCES = /본문|위 표/;

type Target = { unitId: string; conceptId: string; title: string; unitContent: string };

// 절마다 하나씩 돌아가며 골라, 절이 적은 단원도 문제가 MIN_PER_UNIT개가 되게 한다.
async function targets(): Promise<Target[]> {
  const db = getDb();
  const units = await db.select({ id: unit.id, content: unit.content }).from(unit).orderBy(asc(unit.id));
  const concepts = await db.select().from(concept).orderBy(asc(concept.id));
  return units.flatMap(({ id, content }) => {
    const inUnit = concepts.filter((found) => found.unitId === id);
    if (inUnit.length === 0) return [];
    const count = Math.max(MIN_PER_UNIT, inUnit.length);
    return Array.from({ length: count }, (_, index) => {
      const target = inUnit[index % inUnit.length]!;
      return { unitId: id, conceptId: target.id, title: target.title, unitContent: content };
    });
  });
}

function rejection(problem: DefaultQuizProblem, taken: Set<string>) {
  if (SCREEN_REFERENCES.test(problem.stem)) return "학습 화면을 가리킨다";
  if (taken.has(problem.stem)) return "같은 절에 같은 지문이 있다";
  return undefined;
}

async function generateFor(target: Target, taken: Set<string>): Promise<DefaultQuizProblem> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const output = await generateQuizProblem({
      unitContent: target.unitContent,
      target: { conceptId: target.conceptId, title: target.title },
      format: "mcq",
      context: { kind: "summaries", summaries: [] },
    });
    const content = parseQuizProblem({ ...output, format: "mcq" });
    const problem = content && { conceptId: target.conceptId, ...content };
    const reason = problem ? rejection(problem, taken) : "모양 검사를 통과하지 못했다";
    if (problem && !reason) {
      taken.add(problem.stem);
      return problem;
    }
    console.warn(`${target.conceptId} ${attempt}번째 문제를 버렸다: ${reason}`);
  }
  throw new Error(`${target.conceptId} 문제를 ${ATTEMPTS}번 안에 만들지 못했다.`);
}

// AI는 정답을 앞쪽 보기에 두는 경향이 있어, 정답 자리를 문제마다 돌려 위치만으로 답을 짐작할 수 없게 한다.
function balanceAnswers(problems: DefaultQuizProblem[]): DefaultQuizProblem[] {
  return problems.map((problem, index) => {
    if (problem.format !== "mcq") return problem;
    const { choices, answerIndex } = problem.answer;
    const target = index % choices.length;
    const reordered = [...choices];
    [reordered[answerIndex], reordered[target]] = [reordered[target]!, reordered[answerIndex]!];
    return { ...problem, answer: { choices: reordered, answerIndex: target } };
  });
}

function moduleSource(problems: DefaultQuizProblem[]) {
  return `import type { QuizProblemContent } from "@/lib/quiz-problem";

// 학습자가 없는 기본 문제의 원본이다. 고친 뒤 npm run quiz:defaults:migration으로 새 마이그레이션을 만든다.
export type DefaultQuizProblem = QuizProblemContent & { conceptId: string };

export const DEFAULT_QUIZ_PROBLEMS: readonly DefaultQuizProblem[] = ${JSON.stringify(problems, null, 2)};
`;
}

async function generate() {
  const all = await targets();
  const problems: DefaultQuizProblem[] = [];
  // 한 단원씩 보내 동시 요청 수를 단원 하나의 문제 수 안으로 묶는다.
  for (const unitId of new Set(all.map((target) => target.unitId))) {
    const inUnit = all.filter((target) => target.unitId === unitId);
    const taken = new Map(inUnit.map((target) => [target.conceptId, new Set<string>()]));
    problems.push(...(await Promise.all(inUnit.map((target) => generateFor(target, taken.get(target.conceptId)!)))));
    console.log(`${unitId} 기본 문제 ${inUnit.length}개를 만들었다.`);
  }
  writeFileSync(MODULE_PATH, moduleSource(balanceAnswers(problems)));
  console.log(`${MODULE_PATH}에 기본 문제 ${problems.length}개를 썼다. 검토한 뒤 npm run quiz:defaults:migration을 실행한다.`);
}

function migration() {
  const sql = defaultQuizProblemsSql(DEFAULT_QUIZ_PROBLEMS);
  execFileSync("npx", ["drizzle-kit", "generate", "--custom", `--name=${DEFAULT_QUIZ_PROBLEMS_MIGRATION_NAME}`], {
    stdio: "inherit",
  });
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const tag = journal.entries.at(-1)?.tag;
  if (!tag?.endsWith(`_${DEFAULT_QUIZ_PROBLEMS_MIGRATION_NAME}`)) throw new Error("drizzle-kit이 기본 문제 마이그레이션을 만들지 않았다.");
  writeFileSync(`drizzle/${tag}.sql`, sql);
  console.log(`drizzle/${tag}.sql에 기본 문제 ${DEFAULT_QUIZ_PROBLEMS.length}개를 썼다.`);
}

const command = process.argv[2];
if (command === "generate") {
  await generate();
  await getDb().$client.end();
} else if (command === "migration") {
  migration();
} else {
  throw new Error("명령은 generate나 migration이다.");
}
