import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_QUIZ_PROBLEMS } from "./default-quiz-problems";
import { defaultQuizProblemsSql } from "./default-quiz-problems-sql";

type JournalEntry = { idx: number; tag: string };

function latestDefaultProblemsMigration() {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: JournalEntry[] };
  const tags = journal.entries
    .filter((entry) => entry.tag.endsWith("_default_quiz_problems"))
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.tag);
  const latest = tags.at(-1);
  expect(latest, "기본 문제 마이그레이션").toBeDefined();
  return readFileSync(`drizzle/${latest}.sql`, "utf8");
}

describe("기본 문제 마이그레이션", () => {
  it("TC-147 가장 최근 기본 문제 마이그레이션 SQL은 기본 문제 모듈에서 다시 만든 SQL과 같아요", () => {
    const regenerated = defaultQuizProblemsSql(DEFAULT_QUIZ_PROBLEMS);

    expect(latestDefaultProblemsMigration()).toBe(regenerated);
    const columns = /INSERT INTO "quiz_problems" \(([^)]*)\)/.exec(regenerated)?.[1];
    expect(columns, "INSERT 컬럼 목록").toBeDefined();
    expect(columns).not.toContain("learner_id");
  });
});
