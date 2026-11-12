import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions(env.NEXT_PUBLIC_VERCEL_ENV));

// App Router 화면 이동을 트레이싱한다.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
