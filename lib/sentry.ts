// 서버, edge, 브라우저가 함께 쓰는 Sentry 설정. 근거: _docs/wiki/adr/0005-sentry-error-monitoring.md
// @sentry/nextjs v11은 dataCollection의 기본값이 대부분 "수집"이라, 학습자의 질문 원문과 이메일이
// 담길 수 있는 경로를 모두 명시적으로 끈다. 세션 리플레이는 어느 런타임에도 넣지 않는다.
import type { ErrorEvent, EventHint, init } from "@sentry/nextjs";
import { CodedError, ERROR_CODE_TAG, type ErrorCode, isErrorCode } from "@/lib/errors/codes";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

const SENT_ENVIRONMENTS = new Set(["production", "preview"]);

// 로컬 개발 서버에는 VERCEL_ENV가 없다. 개발자 PC의 오류가 운영 알림에 섞이지 않게 보내지 않는다.
export function sentryOptions(vercelEnv: string | undefined) {
  return {
    // DSN은 이벤트를 보내는 주소일 뿐 비밀값이 아니다.
    dsn: "https://f2550150b2da09b3599a501ea3958760@o4512343473258496.ingest.us.sentry.io/4512343569793024",
    enabled: vercelEnv !== undefined && SENT_ENVIRONMENTS.has(vercelEnv),
    environment: vercelEnv,
    tracesSampleRate: 1.0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend,
  } satisfies SentryOptions;
}

function errorCodeOf(event: ErrorEvent, hint: EventHint): ErrorCode | undefined {
  for (let error = hint.originalException; error instanceof Error; error = error.cause) {
    if (error instanceof CodedError) return error.code;
  }
  // captureMessage로 보낸 이벤트는 원본 오류가 없어 태그로 코드를 받는다.
  const tagged = event.tags?.[ERROR_CODE_TAG];
  return isErrorCode(tagged) ? tagged : undefined;
}

// 분류한 오류는 코드로 이슈를 묶어, 발생 위치가 달라도 같은 원인은 이슈 하나가 된다.
// 분류하지 못한 오류는 서로 다른 원인이 한 이슈로 합쳐지지 않도록 Sentry의 묶음 기준을 그대로 둔다.
export function beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const code = errorCodeOf(event, hint);
  const classified = code !== undefined && code !== "UNKNOWN";
  const { user, ...rest } = event;
  return {
    ...rest,
    // 겪은 학습자 수만 세면 되므로 학습자 ID 말고는 남기지 않는다.
    ...(user?.id !== undefined && { user: { id: user.id } }),
    tags: { ...event.tags, [ERROR_CODE_TAG]: code ?? "UNKNOWN" },
    ...(classified && { fingerprint: [code] }),
  };
}
