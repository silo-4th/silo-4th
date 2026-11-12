import { describe, expect, it } from "vitest";
import { CodedError } from "./errors/codes";
import { serverBeforeSend } from "./sentry-server";

describe("서버에서 Sentry로 보내기 전 처리", () => {
  it("TC-326 예상된 오류는 warning으로 바꿔 기록해요", () => {
    const sent = serverBeforeSend(
      { type: undefined, level: "error" },
      { originalException: new CodedError("LOGIN_CANCELLED", "[better-auth] access_denied") },
    );

    expect(sent?.level).toBe("warning");
    expect(sent?.tags?.error_code).toBe("LOGIN_CANCELLED");
    expect(sent?.fingerprint).toEqual(["LOGIN_CANCELLED"]);
  });
});
