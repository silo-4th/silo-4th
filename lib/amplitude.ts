import * as amplitude from "@amplitude/analytics-browser";
import { type AnalyticsEvent, type AnalyticsEvents, type UserProps, commonProps } from "@/lib/analytics";
import { env } from "@/lib/env";

// 브라우저에서만 부른다. 운영 배포에서만 보낸다.
// 로컬 개발 서버와 E2E도 `.env.local`의 키를 읽으므로, 키가 있는지만 보면 테스트 학습자가 운영 데이터에 섞인다.
let enabled: boolean | undefined;

function ready(): boolean {
  if (enabled !== undefined) return enabled;
  if (typeof window === "undefined") return false;
  const apiKey = env.NEXT_PUBLIC_VERCEL_ENV === "production" ? env.NEXT_PUBLIC_AMPLITUDE_API_KEY : undefined;
  enabled = Boolean(apiKey);
  if (!apiKey) return false;
  const appVersion = env.NEXT_PUBLIC_APP_VERSION;
  amplitude.add({
    name: "common-props",
    type: "enrichment",
    execute: async (event) => ({
      ...event,
      event_properties: { ...event.event_properties, ...commonProps(appVersion, new Date(event.time ?? Date.now())) },
    }),
  });
  // 문서에 있는 이벤트만 남긴다. 원격 설정은 앰플리튜드 화면에서 자동 수집을 다시 켤 수 있어 받지 않는다.
  amplitude.init(apiKey, {
    appVersion,
    autocapture: false,
    remoteConfig: { fetchRemoteConfig: false },
    enableDiagnostics: false,
  });
  return true;
}

export function track<E extends AnalyticsEvent>(event: E, properties: AnalyticsEvents[E]) {
  if (ready()) amplitude.track(event, properties);
}

// 로그인 전 이벤트는 기기 ID로 묶여 있어, 학습자 ID를 넣으면 앞의 이벤트도 같은 학습자로 이어진다.
export function identifyLearner(learnerId: string, properties: UserProps) {
  if (!ready()) return;
  amplitude.setUserId(learnerId);
  const identify = new amplitude.Identify();
  for (const [key, value] of Object.entries(properties)) {
    if (value === null) identify.unset(key);
    else identify.set(key, value);
  }
  amplitude.identify(identify);
}

// 한 브라우저를 다른 학습자가 이어 쓸 수 있어, 로그아웃하면 학습자와 기기 ID를 새로 시작한다.
export function resetLearner() {
  if (ready()) amplitude.reset();
}
