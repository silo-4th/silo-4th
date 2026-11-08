import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { type EventOutcome, isRecallEvent, recordSetEvent, reportRecallError } from "@/lib/recall-sets";
import { isUuid } from "@/lib/uuid";

const STATUS: Record<EventOutcome, number> = {
  recorded: 204,
  unknown: 404,
  "not-yours": 403,
  "out-of-order": 409,
};

// 꺼내 먹기 세트에 나중에 할게요, 시작, 완료 시각을 남긴다. 본문은 { event: "postpone" | "start" | "complete" }다.
export async function POST(request: Request, ctx: RouteContext<"/api/recall-sets/[setId]/events">) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 기록을 남기지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const { setId } = await ctx.params;
  if (!isUuid(setId)) return status(404);
  const body: unknown = await request.json().catch(() => undefined);
  const event = typeof body === "object" && body !== null ? (body as Record<string, unknown>).event : undefined;
  if (!isRecallEvent(event)) return status(400);
  try {
    return status(STATUS[await recordSetEvent(learner.id, setId, event)]);
  } catch (error) {
    reportRecallError(error);
    return status(500);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}
