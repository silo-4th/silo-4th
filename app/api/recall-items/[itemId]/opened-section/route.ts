import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { markSectionOpened, type Recorded, reportRecallError } from "@/lib/recall-sets";
import { isUuid } from "@/lib/uuid";

const STATUS: Record<Recorded, number> = { recorded: 204, unknown: 404, "not-yours": 403 };

// 꺼내 먹기 결과에서 문항의 절로 이동한 시각을 남긴다.
export async function POST(request: Request, ctx: RouteContext<"/api/recall-items/[itemId]/opened-section">) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 기록을 남기지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const { itemId } = await ctx.params;
  if (!isUuid(itemId)) return status(404);
  try {
    return status(STATUS[await markSectionOpened(learner.id, itemId)]);
  } catch (error) {
    reportRecallError(error);
    return status(500);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}
