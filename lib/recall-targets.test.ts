import { describe, expect, it } from "vitest";
import {
  type RecallRecord,
  type RecallTarget,
  assignFormats,
  pickRecallTargets,
  recallRange,
} from "./recall-targets";

const UNIT = "s1-01";
const DAY1 = "2026-11-03";
const DAY2 = "2026-11-04";

function viewed(conceptId: string, studyDay: string): RecallRecord {
  return { kind: "viewed", conceptId, unitId: UNIT, studyDay };
}

function asked(conceptId: string, studyDay: string, questionId: string): RecallRecord {
  return { kind: "asked", conceptId, unitId: UNIT, studyDay, questionId };
}

function quizzed(conceptId: string, studyDay: string): RecallRecord {
  return { kind: "quiz", conceptId, unitId: UNIT, studyDay };
}

// 같은 입력으로 랜덤 순서를 바꿔 여러 번 돌린다.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const SEEDS = Array.from({ length: 50 }, (_, index) => index + 1);

describe("꺼내 먹기 출제 대상 고르기", () => {
  it("TC-153 출제 범위 기록에서 넘어간 절 2개와 질문한 절 1개를 고르고 출제 이유를 붙여요", () => {
    const records = [
      viewed("skip-a", DAY1),
      viewed("skip-b", DAY1),
      viewed("skip-b", DAY2),
      viewed("skip-c", DAY2),
      viewed("ask-a", DAY1),
      asked("ask-a", DAY1, "question-a"),
      viewed("ask-b", DAY1),
      asked("ask-b", DAY2, "question-b"),
    ];
    const questionOf: Record<string, string> = { "ask-a": "question-a", "ask-b": "question-b" };

    for (const seed of SEEDS) {
      const targets = pickRecallTargets(records, seeded(seed));
      const skipped = targets.filter((target) => target.reason === "read_no_question");
      const askedTargets = targets.filter((target) => target.reason === "asked");

      expect(targets).toHaveLength(3);
      expect(skipped).toHaveLength(2);
      for (const target of skipped) expect(["skip-a", "skip-b", "skip-c"]).toContain(target.conceptId);
      expect(askedTargets).toHaveLength(1);
      const [askedTarget] = askedTargets;
      expect(["ask-a", "ask-b"]).toContain(askedTarget?.conceptId);
      expect(askedTarget).toMatchObject({ sourceQuestionId: questionOf[askedTarget?.conceptId ?? ""] });
      expect(new Set(targets.map((target) => target.conceptId)).size).toBe(3);
    }
  });

  it("TC-154 퀴즈를 푼 절은 넘어간 절에서 빠지고, 질문한 절로 골라지면 출제 이유가 quiz예요", () => {
    const records = [
      viewed("quiz-a", DAY1),
      quizzed("quiz-a", DAY2),
      viewed("skip-a", DAY1),
      viewed("skip-b", DAY2),
    ];

    for (const seed of SEEDS) {
      const targets = pickRecallTargets(records, seeded(seed));

      expect(targets).toHaveLength(3);
      expect(targets.filter((target) => target.reason === "read_no_question").map((target) => target.conceptId).sort())
        .toEqual(["skip-a", "skip-b"]);
      const quizTargets = targets.filter((target) => target.reason === "quiz");
      expect(quizTargets).toHaveLength(1);
      expect(quizTargets[0]?.conceptId).toBe("quiz-a");
      expect(quizTargets[0]).not.toHaveProperty("sourceQuestionId");
    }
  });

  it("TC-155 후보가 출제 수보다 모자라면 다른 절로 채우지 않고 있는 만큼만 골라요", () => {
    const recentDays = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    const records = [viewed("other-day", "2026-11-01"), ...recentDays.map((day) => viewed("skip-a", day))];

    for (const seed of SEEDS) {
      const targets = pickRecallTargets(records, seeded(seed));

      expect(targets).toEqual([{ conceptId: "skip-a", unitId: UNIT, reason: "read_no_question" }]);
    }
  });

  it("TC-156 가장 최근에 학습한 7일의 기록을 출제 범위로 쓰고, 그보다 오래된 학습일은 빼요", () => {
    const days = [
      "2026-10-20",
      "2026-10-22",
      "2026-10-25",
      "2026-10-28",
      "2026-11-01",
      "2026-11-03",
      "2026-11-05",
      "2026-11-07",
    ];

    expect(recallRange(days)).toEqual([
      "2026-10-22",
      "2026-10-25",
      "2026-10-28",
      "2026-11-01",
      "2026-11-03",
      "2026-11-05",
      "2026-11-07",
    ]);
    expect(recallRange(["2026-11-02"])).toEqual(["2026-11-02"]);
    expect(recallRange([])).toEqual([]);
  });

  it("TC-157 3문제를 내면 객관식, 빈칸, 서술 포맷이 한 번씩 붙어요", () => {
    const targets: RecallTarget[] = [
      { conceptId: "skip-a", unitId: UNIT, reason: "read_no_question" },
      { conceptId: "skip-b", unitId: UNIT, reason: "read_no_question" },
      { conceptId: "ask-a", unitId: UNIT, reason: "asked", sourceQuestionId: "question-a" },
    ];

    for (const seed of SEEDS) {
      const items = assignFormats(targets, seeded(seed), {});

      expect(items.map((item) => item.format).sort()).toEqual(["blank", "free", "mcq"]);
      expect(items).toEqual(targets.map((target, index) => ({ ...target, format: items[index]?.format })));

      const pair = assignFormats(targets.slice(0, 2), seeded(seed), {});
      expect(new Set(pair.map((item) => item.format)).size).toBe(2);
    }
  });

  it("TC-158 단원에 맞지 않는 포맷은 그 문제에 붙이지 않아요", () => {
    const targets: RecallTarget[] = [
      { conceptId: "join-a", unitId: "s2-07", reason: "read_no_question" },
      { conceptId: "skip-b", unitId: UNIT, reason: "read_no_question" },
      { conceptId: "ask-a", unitId: UNIT, reason: "asked", sourceQuestionId: "question-a" },
    ];

    for (const seed of SEEDS) {
      const items = assignFormats(targets, seeded(seed), { "s2-07": ["blank"] });

      expect(items[0]?.format).not.toBe("blank");
      expect(items.map((item) => item.format).sort()).toEqual(["blank", "free", "mcq"]);
    }
  });
});
