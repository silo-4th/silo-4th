import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { reportAuthError } from "@/lib/auth/sentry-logger";

// Better Auth가 던진 예외를 그대로 두면 라우터가 쿼리 값이 담긴 원본을 서버 로그에 찍는다.
export const { GET, POST } = toNextJsHandler(async (request) => {
  // Google 로그인 창에서 취소하면 콜백에 error=access_denied가 오고, Better Auth는 로그 없이 오류 화면으로 보낸다.
  // 취소가 갑자기 늘면 로그인 흐름이 고장 났다는 신호라 Sentry에 남긴다. 예상된 오류라 건별로는 알리지 않는다.
  if (new URL(request.url).searchParams.get("error") === "access_denied") reportAuthError("access_denied");
  try {
    return await getAuth().handler(request);
  } catch (error) {
    reportAuthError(error);
    // 로그인 콜백처럼 브라우저가 화면을 옮기는 요청만 안내 화면으로 보낸다. fetch 요청이 HTML을 받으면 성공으로 착각한다.
    // Safari 16.4 이전은 이 헤더를 보내지 않아, 헤더 없는 GET은 화면 이동으로 본다.
    const mode = request.headers.get("sec-fetch-mode");
    if (mode === "navigate" || (mode === null && request.method === "GET")) {
      return Response.redirect(new URL("/?error=internal_server_error", request.url));
    }
    return Response.json({ code: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
});
