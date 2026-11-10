import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSessionCookie } from "better-auth/cookies";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";
import { CLEAR_SESSION_PATH, HOME_PATH, START_PATH } from "@/lib/routes";
import { DIRECT_SOURCE, normalizeSource, SOURCE_COOKIE, TEST_SOURCE } from "@/lib/source";
import { enabledProviders, type ProviderId } from "./providers";
import { safeMessage, sentryLogger } from "./sentry-logger";

const credentials: Record<ProviderId, () => { clientId: string; clientSecret: string }> = {
  google: () => ({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }),
};

function createAuth() {
  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.AUTH_URL,
    // 학습자와 계정을 함께 저장한다. 따로 저장하다 계정만 실패하면 연결 없는 학습자가 남아 다시 로그인할 수 없다.
    database: drizzleAdapter(getDb(), { provider: "pg", schema, transaction: true }),
    user: {
      modelName: "learner",
      // 로그인 요청으로는 바꿀 수 없게 막고, 현재 학습자 조회 결과에는 함께 담는다.
      additionalFields: {
        consentedAt: { type: "date", required: false, input: false },
        // 하루를 뜻하는 값이라 Date로 바꾸지 않고 `YYYY-MM-DD` 문자열로 둔다.
        examDate: { type: "string", required: false, input: false },
        source: { type: "string", defaultValue: DIRECT_SOURCE, input: false },
        isTest: { type: "boolean", defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // 출처는 학습자를 만들 때 한 번만 정하고 바꾸지 않는다.
          before: async (user, context) => {
            const source = normalizeSource(context?.getCookie(SOURCE_COOKIE));
            return { data: { ...user, source, isTest: source === TEST_SOURCE } };
          },
        },
      },
    },
    socialProviders: Object.fromEntries(enabledProviders.map((id) => [id, credentials[id]()])),
    account: { accountLinking: { enabled: false } },
    // API 오류가 아닌 예외를 라우트 핸들러로 던져, 원본 대신 정리한 메시지만 남긴다.
    onAPIError: { errorURL: "/", throw: true },
    logger: sentryLogger,
    // Better Auth 추적 구간은 실패한 DB 호출의 원본 메시지를 담아 Sentry로 보낸다.
    experimental: { instrumentation: { enabled: false } },
    advanced: { database: { generateId: "uuid" } },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

// 첫 호출에서 만든다. 모듈 로드 시점에 만들면 환경 변수 없는 빌드가 실패한다.
export function getAuth() {
  auth ??= createAuth();
  return auth;
}

export async function findLearner(requestHeaders: Headers) {
  try {
    // 서버 컴포넌트는 쿠키를 쓸 수 없다. 여기서 DB 만료일만 늘리면 브라우저의 세션 확인이 쿠키를 새로 쓰지 않는다.
    const result = await getAuth().api.getSession({
      headers: requestHeaders,
      query: { disableRefresh: true },
    });
    return result?.user ?? null;
  } catch (error) {
    // 세션 조회 오류는 cause에 세션 토큰이 담긴 DB 오류를 달고 온다. 그대로 던지면 Sentry가 cause까지 보낸다.
    throw new Error(safeMessage(error));
  }
}

// 시작 화면처럼 헤더와 본문이 함께 불러도 한 요청 안에서는 DB를 한 번만 조회한다.
export const getCurrentLearner = cache(async () => findLearner(await headers()));

type CookieWriter = {
  set(
    name: string,
    value: string,
    options: { path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: "lax" | "strict" | "none"; maxAge: number },
  ): unknown;
};

// 세션 쿠키를 만료시켜 로그아웃한다. Better Auth는 서명이 틀린 쿠키를 지우지 않으므로 세션 조회 결과와 관계없이 직접 지운다.
// `__Secure-` 쿠키는 처음과 같은 속성으로 덮어써야 브라우저가 받아들인다.
export async function expireSessionCookies(writer: CookieWriter) {
  const { authCookies } = await getAuth().$context;
  for (const { name, attributes } of [authCookies.sessionToken, authCookies.sessionData, authCookies.dontRememberToken]) {
    writer.set(name, "", {
      path: attributes.path,
      domain: attributes.domain,
      secure: attributes.secure,
      httpOnly: attributes.httpOnly,
      // Better Auth 타입은 대문자 값도 받지만 Next.js는 소문자만 받는다.
      sameSite: attributes.sameSite?.toLowerCase() as Lowercase<NonNullable<typeof attributes.sameSite>> | undefined,
      maxAge: 0,
    });
  }
}

// 학습 화면의 레이아웃, 페이지, 서버 액션은 이 함수로 학습자를 꺼낸다. 학습자가 없거나 저장에 동의하지 않았으면 돌려보낸다.
// 화면 이동 대신 상태 코드로 답해야 하는 API는 findLearner로 직접 확인한다.
// 한 요청 안에서 레이아웃과 페이지가 함께 불러도 DB는 한 번만 조회한다.
export const requireLearner = cache(async () => {
  const requestHeaders = await headers();
  const learner = await findLearner(requestHeaders);
  if (!learner) {
    if (getSessionCookie(requestHeaders)) await logOutStaleSession();
    redirect(HOME_PATH);
  }
  // 시험 날짜는 저장 동의와 같은 폼에서 함께 저장하므로 따로 확인하지 않는다.
  if (!learner.consentedAt) redirect(START_PATH);
  return learner;
});

// 쿠키는 있지만 학습자가 없으면 로그아웃한다. 서버 액션과 라우트 핸들러는 그 자리에서 쿠키를 지운다.
// 서버 컴포넌트는 쿠키를 쓰면 예외가 나므로, 쿠키를 지울 수 있는 라우트 핸들러로 보낸다.
async function logOutStaleSession() {
  const cookieStore = await cookies();
  // 설정 오류가 아래 catch에 묻히지 않게 먼저 불러 둔다.
  await getAuth().$context;
  try {
    await expireSessionCookies(cookieStore);
  } catch {
    redirect(CLEAR_SESSION_PATH);
  }
}
