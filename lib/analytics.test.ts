import { expect, test } from "vitest";
import { genErrorType, quizResultProps, recallResultProps, replacedProblemId, studyStatus, userProperties } from "@/lib/analytics";
import type { ProblemView } from "@/lib/quiz-problems";
import type { QuizTab } from "@/lib/quiz-tab";
import type { ResultChip } from "@/lib/recall-result";

test("TC-314 로그인한 학습자 기록으로 사용자 속성 source, is_test, exam_date, signup_day를 만들고 이메일과 이름은 넣지 않아요", () => {
  const record = {
    name: "학습자",
    email: "learner@example.com",
    source: "insta",
    isTest: false,
    examDate: "2026-12-01",
    createdAt: new Date("2026-11-10T02:00:00+09:00"),
  };

  expect(userProperties(record)).toEqual({
    source: "insta",
    is_test: false,
    exam_date: "2026-12-01",
    signup_day: "2026-11-09",
  });
});

test("TC-316 꺼내 먹기 결과 칩으로 correct_count와 review_count를 세고, 공부하러 가기의 status를 wrong이나 unsure로 정해요", () => {
  const chips: ResultChip[] = ["맞혔어요", "맞았지만 헷갈렸어요", "틀렸어요", "채점하지 못했어요"];

  expect(recallResultProps(chips.map((chip) => ({ chip })))).toEqual({ correct_count: 2, review_count: 2 });
  expect(chips.map(studyStatus)).toEqual([undefined, "unsure", "wrong", undefined]);
});

test("TC-317 문제 생성 실패를 error_type으로 바꿔요. 502는 generation_failed, 500은 server_error, 응답이 없으면 network예요", () => {
  expect(([502, 500, "network", "timeout"] as const).map(genErrorType)).toEqual([
    "generation_failed",
    "server_error",
    "network",
    "network",
  ]);
});

test("TC-340 퀴즈 묶음 결과 칩으로 quiz_result_view의 correct_count와 sure_correct_count를 세요", () => {
  const chips: ResultChip[] = ["맞혔어요", "맞았지만 헷갈렸어요", "틀렸어요", "채점하지 못했어요"];
  const results = [...chips.map((chip) => ({ conceptTitle: "GROUP BY", chip })), null];

  expect(quizResultProps(results)).toEqual({ correct_count: 2, sure_correct_count: 1 });
});

test("TC-341 관련 문제 풀기를 누르면 퀴즈 탭에 떠 있던 문제 ID를 replaced_problem_id로 보내고, 떠 있는 문제가 없으면 비워요", () => {
  const problem: ProblemView = {
    id: "11111111-1111-4111-8111-111111111111",
    format: "mcq",
    conceptId: "group-by",
    conceptTitle: "GROUP BY",
    stem: "GROUP BY는 무엇을 하나요?",
    hint: "묶는 기준을 떠올려 보세요.",
    choices: ["묶기", "정렬", "거르기", "합치기"],
  };
  const tabs: QuizTab[] = [
    { stage: "problem", number: 2, problem },
    { stage: "idle" },
    { stage: "loading", number: 2, unitId: "unit-1" },
    { stage: "result" },
  ];

  expect(tabs.map(replacedProblemId)).toEqual([problem.id, undefined, undefined, undefined]);
});
