import { describe, expect, it } from "vitest";
import { answerAsk } from "./answer-quote";

describe("마지막 답 인용 질문", () => {
  it("TC-310 마지막 답으로 만드는 질문은 정해진 문구에 답을 인용으로 붙이고, 마크다운 기호를 빼고 1500자까지 자르며, 절 개념 없이 보내요", () => {
    const fromDrag = {
      answer: "**GROUP BY**는 `category`별로 행을 묶어요.\n\n- 같은 값끼리 모아요\n- 한 줄로 줄여요\n\n```sql\nSELECT category FROM sales GROUP BY category;\n```",
      selectedText: "GROUP BY는 같은 값끼리 묶어요.",
      sectionConceptId: "unit-1-1",
    };

    const easier = answerAsk(fromDrag, "easier");
    expect(easier).toEqual({
      content: "이 부분을 쉽게 설명해줘",
      selectedText: "GROUP BY는 category별로 행을 묶어요.\n같은 값끼리 모아요\n한 줄로 줄여요\nSELECT category FROM sales GROUP BY category;",
    });
    expect(easier.selectedText).not.toMatch(/[*`]|^- /m);

    expect(answerAsk(fromDrag, "example")).toEqual({ ...easier, content: "이 부분을 예시로 보여줘" });

    const long = { answer: "가".repeat(1600) };
    expect(answerAsk(long, "easier").selectedText).toBe("가".repeat(1500));
  });
});
