import { describe, expect, it } from "vitest";
import { toSessionList } from "./question-sessions";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 0, minute));

describe("세션 목록", () => {
  it("TC-82 세션 목록은 마지막으로 질문한 대화부터 놓고, 제목은 첫 질문으로 만들어요", () => {
    const asked = [
      { sessionId: "s2", content: "두 번째 세션 첫 질문", askedAt: at(10) },
      { sessionId: "s1", content: "첫 세션 첫 질문", askedAt: at(0) },
      { sessionId: "s3", content: "세 번째 세션 둘째 질문", askedAt: at(25) },
      { sessionId: "s1", content: "첫 세션 마지막 질문", askedAt: at(30) },
      { sessionId: "s2", content: "두 번째 세션 둘째 질문", askedAt: at(15) },
      { sessionId: "s3", content: "세 번째 세션 첫 질문", askedAt: at(20) },
      { sessionId: "s1", content: "첫 세션 둘째 질문", askedAt: at(5) },
    ];

    expect(toSessionList(asked)).toEqual([
      { id: "s1", title: "첫 세션 첫 질문" },
      { id: "s3", title: "세 번째 세션 첫 질문" },
      { id: "s2", title: "두 번째 세션 첫 질문" },
    ]);
  });
});
