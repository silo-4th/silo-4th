import { captureMessage } from "@sentry/nextjs";
import type { Logger } from "better-auth";
import { ERROR_CODE_TAG, type ErrorCode } from "@/lib/errors/codes";

const EMAIL = /[^\s@]+@[^\s@]+/g;
// Drizzle 오류 메시지는 `params:` 뒤에 쿼리 값을 붙인다. 토큰, 세션 토큰, IP가 그 자리에 들어간다.
const QUERY_PARAMS = /\nparams:[\s\S]*/;

// 쿼리 값을 지우면 실패 원인도 사라진다. Postgres나 Node의 오류 코드는 값을 담지 않아 원인을 찾는 단서로 남긴다.
function errorCode(value: unknown) {
  for (let error = value; error instanceof Error; error = error.cause) {
    if ("code" in error && typeof error.code === "string") return error.code;
  }
  return undefined;
}

export function safeMessage(value: unknown, label = "better-auth") {
  const message = value instanceof Error ? value.message : String(value);
  const code = errorCode(value);
  const safe = message.replace(QUERY_PARAMS, "").replace(EMAIL, "[email]");
  return `[${label}] ${safe}${code ? ` [code ${code}]` : ""}`;
}

// 학습자가 로그인을 취소했거나, 오래 둔 로그인 창을 다시 열었거나, 밖에서 잘못된 요청이 온 경우는 원래 날 수 있는 오류라 따로 분류한다.
// 로그인 중 DB 장애도 Better Auth는 같은 "Failed to parse state"로 남기므로, 문구가 아니라 함께 넘긴 원인 오류의 코드로 나눈다.
function authErrorCode(message: string, cause: unknown): ErrorCode {
  if (message.startsWith("[start] ")) return "START_SAVE_FAILED";
  if (/\baccess_denied\b/.test(message)) return "LOGIN_CANCELLED";
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  if (typeof code === "string" && code.startsWith("state_") && code !== "state_generation_error") return "LOGIN_EXPIRED";
  if (/\] (Invalid \w+: |State not found|Provider not found|Email and password is not enabled)/.test(message)) {
    return "REQUEST_REJECTED";
  }
  return "AUTH_FAILED";
}

export function reportAuthError(error: unknown, label?: string, cause?: unknown) {
  const safe = safeMessage(error, label);
  console.error(safe);
  captureMessage(safe, { level: "error", tags: { [ERROR_CODE_TAG]: authErrorCode(safe, cause ?? error) } });
}

// Better Auth는 메시지 뒤 인자에 프로필 객체나 이메일이 담긴 DB 오류를 넘긴다.
// 콘솔 출력도 Sentry 브레드크럼으로 이벤트에 실리므로, 어디에도 메시지 문자열만 남긴다.
export const sentryLogger: Logger = {
  level: "warn",
  log(level, message, ...args) {
    if (level === "error") reportAuthError(message, undefined, args[0]);
    else console[level](safeMessage(message));
  },
};
