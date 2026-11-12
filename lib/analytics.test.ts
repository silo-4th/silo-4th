import { expect, test } from "vitest";
import { genErrorType, recallResultProps, studyStatus, userProperties } from "@/lib/analytics";
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
