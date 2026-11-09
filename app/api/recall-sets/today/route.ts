import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { recallToday, reportRecallError, showTodaySet } from "@/lib/recall-sets";

// 하루 첫 진입에 띄울 꺼내 먹기 세트를 돌려주고 띄운 시각을 남긴다. 띄울 세트가 없으면 set이 null이다.
// advanceDay=1은 운영이 아닌 환경에서만 날짜를 하루 당긴다.
export async function POST(request: Request) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 띄운 기록을 남기지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const advanceDay = new URL(request.url).searchParams.get("advanceDay") === "1";
  try {
    return Response.json({ set: await showTodaySet(learner.id, recallToday(advanceDay)) });
  } catch (error) {
    reportRecallError(error);
    return status(500);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}
