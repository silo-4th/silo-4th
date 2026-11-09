import { findLearner } from "@/lib/auth";
import { reportQuizProblemError, resumeProblem } from "@/lib/quiz-problems";

// 새로고침 뒤 풀던 문제를 정답과 해설 없이 다시 내려준다. 다른 학습자의 문제도 없는 문제와 같이 404로 답한다.
export async function GET(request: Request, ctx: RouteContext<"/api/quiz-problems/[problemId]">) {
  const learner = await findLearner(request.headers);
  if (!learner) return new Response(null, { status: 401 });
  try {
    const shownAt = new Date(new URL(request.url).searchParams.get("shownAt") ?? "");
    const resumed = await resumeProblem(
      learner.id,
      (await ctx.params).problemId,
      Number.isNaN(shownAt.getTime()) ? undefined : shownAt,
    );
    return resumed ? Response.json(resumed) : new Response(null, { status: 404 });
  } catch (error) {
    reportQuizProblemError(error);
    return new Response(null, { status: 500 });
  }
}
