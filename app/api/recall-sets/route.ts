import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { prepareRecallSet, reportRecallSetError } from "@/lib/recall-set-preparation";

// 다음 날 첫 진입에 꺼내 먹기 세트를 만든다. 띄운 시각은 남기지 않으므로, 만드는 중에 떠나도 세트는 띄우지 않은 채로 남는다.
export async function POST(request: Request) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 AI 호출과 저장을 일으키지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  try {
    await prepareRecallSet(learner.id);
  } catch (error) {
    reportRecallSetError(error);
    return status(500);
  }
  return status(204);
}

function status(code: number) {
  return new Response(null, { status: code });
}
