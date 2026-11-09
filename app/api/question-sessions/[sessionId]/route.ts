import { findLearner } from "@/lib/auth";
import { reportQuestionError, sessionTurns } from "@/lib/questions";

// 다른 학습자의 세션도 없는 세션과 같이 404로 답해, 세션이 있는지조차 알리지 않는다.
export async function GET(request: Request, ctx: RouteContext<"/api/question-sessions/[sessionId]">) {
  const learner = await findLearner(request.headers);
  if (!learner) return new Response(null, { status: 401 });
  try {
    const turns = await sessionTurns(learner.id, (await ctx.params).sessionId);
    return turns ? Response.json({ turns }) : new Response(null, { status: 404 });
  } catch (error) {
    reportQuestionError(error);
    return new Response(null, { status: 500 });
  }
}
