import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { CodedError } from "./errors/codes";
import { beforeSend, sentryOptions } from "./sentry";

function errorEvent(fields: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, level: "error", ...fields };
}

describe("Sentry 설정", () => {
  it("TC-327 로컬 개발 서버에서는 Sentry로 보내지 않고, Vercel 배포에서는 VERCEL_ENV를 환경으로 기록해요", () => {
    expect(sentryOptions(undefined).enabled).toBe(false);
    expect(sentryOptions("preview")).toMatchObject({ enabled: true, environment: "preview" });
    expect(sentryOptions("production")).toMatchObject({ enabled: true, environment: "production" });
  });
});

describe("Sentry로 보내기 전 처리", () => {
  it("TC-324 분류한 오류는 오류 코드를 Sentry 태그와 묶음 기준으로 붙여요", () => {
    const sent = beforeSend(errorEvent(), {
      originalException: new CodedError("RECORD_SAVE_FAILED", "[section-views] insert failed"),
    });

    expect(sent?.tags?.error_code).toBe("RECORD_SAVE_FAILED");
    expect(sent?.fingerprint).toEqual(["RECORD_SAVE_FAILED"]);
    expect(sent?.level).toBe("error");
  });

  it("TC-325 분류하지 못한 오류는 UNKNOWN 태그를 붙이고 Sentry의 기본 묶음 기준을 그대로 둬요", () => {
    const sent = beforeSend(errorEvent(), { originalException: new TypeError("x is undefined") });

    expect(sent?.tags?.error_code).toBe("UNKNOWN");
    expect(sent?.fingerprint).toBeUndefined();
    expect(sent?.level).toBe("error");
  });

  it("TC-332 Sentry 이벤트에는 학습자 ID만 사용자로 싣고 이메일과 이름, IP는 싣지 않아요", () => {
    const sent = beforeSend(
      errorEvent({
        user: {
          id: "learner-1",
          email: "leak@example.com",
          username: "유출금지이름",
          ip_address: "203.0.113.7",
        },
      }),
      {},
    );

    expect(sent?.user).toEqual({ id: "learner-1" });
    const recorded = JSON.stringify(sent);
    expect(recorded).not.toContain("leak@example.com");
    expect(recorded).not.toContain("유출금지이름");
    expect(recorded).not.toContain("203.0.113.7");
  });
});
