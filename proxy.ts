import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isMobileRequest } from "@/lib/device";
import { HOME_PATH, isStudyPath, MOBILE_NOTICE_PATH, START_PATH, STUDY_PATH } from "@/lib/routes";
import { DIRECT_SOURCE, normalizeSource, SOURCE_COOKIE } from "@/lib/source";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

// 모바일 판별, 화면 접근 확인, 출처 쿠키 순서로 본다.
export function proxy(request: NextRequest) {
  // 모바일 화면은 만들지 않고 어느 주소로 들어와도 안내 화면으로 막는다.
  if (isMobileRequest(request.headers)) {
    return NextResponse.rewrite(new URL(MOBILE_NOTICE_PATH, request.url));
  }
  const target = redirectTarget(request.nextUrl, Boolean(getSessionCookie(request)));
  const response = target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
  // 돌려보낼 때도 주소의 `?from=`이 사라지므로 출처 쿠키를 남긴다.
  keepSource(request, response);
  return response;
}

// 세션 쿠키만 보고 응답 단계에서 빠르게 보낸다. 학습자와 저장 동의는 화면에서 DB로 다시 확인한다.
// 쿠키가 낡았으면 학습 화면의 `requireLearner()`가 로그아웃시키고 첫 화면으로 돌려보낸다.
// 로그인에 실패해 `?error=`를 달고 온 첫 화면은 보내지 않는다. 낡은 쿠키가 남아 있어도 실패 안내를 보여야 한다.
function redirectTarget({ pathname, searchParams }: URL, hasSession: boolean) {
  if (pathname === MOBILE_NOTICE_PATH) return HOME_PATH;
  if (hasSession) return pathname === HOME_PATH && !searchParams.has("error") ? STUDY_PATH : undefined;
  return isStudyPath(pathname) || pathname === START_PATH ? HOME_PATH : undefined;
}

// Google 로그인을 다녀오면 주소의 `?from=`이 사라진다. 학습자를 만들 때 읽도록 처음 값만 쿠키에 남긴다.
function keepSource(request: NextRequest, response: NextResponse) {
  if (request.cookies.has(SOURCE_COOKIE)) return;
  const source = normalizeSource(request.nextUrl.searchParams.get("from"));
  if (source === DIRECT_SOURCE) return;

  response.cookies.set(SOURCE_COOKIE, source, {
    httpOnly: true,
    // Google에서 돌아오는 이동에도 쿠키가 실려야 한다.
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export const config = {
  // `monitoring`은 Sentry 이벤트를 보내는 경로라 모바일 안내 화면으로 바꾸면 안 된다.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|monitoring).*)"],
};
