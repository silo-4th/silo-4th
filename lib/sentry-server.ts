import "server-only";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { alertEntry } from "@/lib/errors/alert-catalog";
import { ERROR_CODE_TAG } from "@/lib/errors/codes";
import { beforeSend } from "@/lib/sentry";

// 예상된 오류 여부는 서버 전용 카탈로그에만 있어 서버에서만 레벨을 낮춘다.
// warning은 건별 알림에서 빠지고, 알림 스크립트가 코드별 급증으로만 알린다.
export function serverBeforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const sent = beforeSend(event, hint);
  const code = sent.tags?.[ERROR_CODE_TAG];
  return typeof code === "string" && alertEntry(code).expected ? { ...sent, level: "warning" } : sent;
}
