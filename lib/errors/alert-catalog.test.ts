import { describe, expect, it } from "vitest";
import { alertEntry } from "./alert-catalog";

describe("오류 코드 카탈로그", () => {
  it("TC-323 오류 코드로 카탈로그를 조회하면 PO 요약, 발생 위치, 예상된 오류 여부, 급증 기준을 돌려주고 모르는 코드는 UNKNOWN 항목을 돌려줘요", () => {
    expect(alertEntry("RECORD_SAVE_FAILED")).toEqual({
      summary: "학습 기록을 저장하지 못했어요",
      feature: "학습셋",
      expected: false,
    });
    expect(alertEntry("LOGIN_CANCELLED")).toMatchObject({
      feature: "로그인",
      expected: true,
      spikePerHour: 20,
    });
    expect(alertEntry("NOT_IN_CATALOG")).toEqual({
      summary: "예상하지 못한 오류가 발생했어요",
      feature: "알 수 없음",
      expected: false,
    });
  });
});
