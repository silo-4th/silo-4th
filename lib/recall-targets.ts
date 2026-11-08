import { QUIZ_FORMATS, type QuizFormat } from "@/lib/db/schema";

// 학습 기록 한 줄이다. 본 절은 section_views, 질문한 절은 questions와 question_concepts, 퀴즈를 푼 절은 퀴즈 탭 풀이에서 온다.
export type RecallRecord = { conceptId: string; unitId: string; studyDay: string } & (
  | { kind: "viewed" }
  | { kind: "asked"; questionId: string }
  | { kind: "quiz" }
);

// recall_items의 reason과 source_question_id 규칙을 그대로 따른다.
export type RecallTarget = { conceptId: string; unitId: string } & (
  | { reason: "read_no_question" }
  | { reason: "asked"; sourceQuestionId: string }
  | { reason: "quiz" }
);

export type RecallItem = RecallTarget & { format: QuizFormat };

export type ExcludedFormats = Readonly<Record<string, readonly QuizFormat[]>>;

const RANGE_DAYS = 7;
const SKIPPED_COUNT = 2;
const ASKED_COUNT = 1;

// 4-80에서 단원과 맞지 않는 포맷이 정해지면 단원 ID를 키로 채운다.
export const UNIT_EXCLUDED_FORMATS: ExcludedFormats = {};

export function recallRange(studyDays: readonly string[]): string[] {
  return [...new Set(studyDays)].sort().slice(-RANGE_DAYS);
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap] as T, result[index] as T];
  }
  return result;
}

// 후보가 출제 수보다 많을 때 무엇을 고를지 정하기 전까지는 랜덤으로 고른다.
export function pickRecallTargets(records: readonly RecallRecord[], random: () => number = Math.random): RecallTarget[] {
  const range = new Set(recallRange(records.map((record) => record.studyDay)));
  const inRange = records.filter((record) => range.has(record.studyDay));

  const sections = new Map<string, { unitId: string; viewed: boolean; quizzed: boolean; questionIds: string[] }>();
  for (const record of inRange) {
    const section = sections.get(record.conceptId) ?? { unitId: record.unitId, viewed: false, quizzed: false, questionIds: [] };
    if (record.kind === "viewed") section.viewed = true;
    if (record.kind === "quiz") section.quizzed = true;
    if (record.kind === "asked") section.questionIds.push(record.questionId);
    sections.set(record.conceptId, section);
  }

  const skipped: RecallTarget[] = [];
  const asked: RecallTarget[] = [];
  for (const [conceptId, { unitId, viewed, quizzed, questionIds }] of sections) {
    const questionId = shuffle(questionIds, random)[0];
    // 질문과 퀴즈 풀이가 모두 있으면 근거 질문을 남길 수 있는 asked로 본다. 가설 C에서는 asked와 quiz를 같이 센다.
    if (questionId) asked.push({ conceptId, unitId, reason: "asked", sourceQuestionId: questionId });
    else if (quizzed) asked.push({ conceptId, unitId, reason: "quiz" });
    else if (viewed) skipped.push({ conceptId, unitId, reason: "read_no_question" });
  }

  return [...shuffle(skipped, random).slice(0, SKIPPED_COUNT), ...shuffle(asked, random).slice(0, ASKED_COUNT)];
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

// 세 포맷이 한 번씩 나오도록 섞되, 단원과 맞지 않는 포맷은 그 문제에 붙이지 않는다.
// 그렇게 섞을 수 없으면 문제마다 맞는 포맷 안에서 랜덤으로 고른다.
export function assignFormats(
  targets: readonly RecallTarget[],
  random: () => number = Math.random,
  excluded: ExcludedFormats = UNIT_EXCLUDED_FORMATS,
): RecallItem[] {
  const allowed = targets.map((target) => QUIZ_FORMATS.filter((format) => !excluded[target.unitId]?.includes(format)));
  const fits = (order: QuizFormat[]) =>
    allowed.every((formats, index) => {
      const format = order[index];
      return format !== undefined && formats.includes(format);
    });
  const order = shuffle(permutations(QUIZ_FORMATS), random).find(fits);
  return targets.map((target, index) => ({
    ...target,
    format: order?.[index] ?? shuffle(allowed[index] ?? [], random)[0] ?? "mcq",
  }));
}
