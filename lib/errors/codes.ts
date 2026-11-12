// 오류 코드 목록은 여기 하나만 둔다. Sentry 알림과 학습자 화면이 같은 코드를 쓴다.
// 브라우저도 import하므로 PO 알림 문구는 alert-catalog.ts에 둔다. 근거: _docs/wiki/adr/0005-sentry-error-monitoring.md
export const ERROR_CODES = [
  "RECORD_SAVE_FAILED",
  "QUESTION_FAILED",
  "QUIZ_PROBLEM_FAILED",
  "QUIZ_ATTEMPT_FAILED",
  "RECALL_SET_FAILED",
  "AUTH_FAILED",
  "START_SAVE_FAILED",
  "LOGIN_CANCELLED",
  "LOGIN_EXPIRED",
  "REQUEST_REJECTED",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_CODE_TAG = "error_code";

export function isErrorCode(value: unknown): value is ErrorCode {
  return (ERROR_CODES as readonly unknown[]).includes(value);
}

export class CodedError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodedError";
  }
}
