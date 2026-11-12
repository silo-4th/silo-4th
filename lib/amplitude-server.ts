import "server-only";
import { after } from "next/server";
import { type AnalyticsEvent, type AnalyticsEvents, commonProps } from "@/lib/analytics";
import { env } from "@/lib/env";

const HTTP_API = "https://api2.amplitude.com/2/httpapi";

// 서버에서만 알 수 있는 순간의 이벤트를 보낸다. 브라우저가 로그인 때 같은 학습자 ID를 넣어 두어 기기 이벤트와 이어진다.
// 응답을 늦추지 않게 응답 뒤에 보내고, 실패해도 학습 흐름에는 영향을 주지 않는다.
export function trackFromServer<E extends AnalyticsEvent>(learnerId: string, event: E, properties: AnalyticsEvents[E]) {
  // 브라우저 쪽 lib/amplitude.ts와 같이 운영 배포에서만 보낸다.
  const apiKey = env.VERCEL_ENV === "production" ? env.NEXT_PUBLIC_AMPLITUDE_API_KEY : undefined;
  if (!apiKey) return;
  const at = new Date();
  const appVersion = env.APP_VERSION;
  after(async () => {
    try {
      await fetch(HTTP_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          events: [
            {
              user_id: learnerId,
              event_type: event,
              time: at.getTime(),
              app_version: appVersion,
              event_properties: { ...properties, ...commonProps(appVersion, at) },
            },
          ],
        }),
      });
    } catch {}
  });
}
