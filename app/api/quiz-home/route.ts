import { findLearner } from "@/lib/auth";
import { hasUnitCandidates, reportQuizProblemError } from "@/lib/quiz-problems";

// 퀴즈 홈은 문제를 만들기 전에 AI 맞춤 문제를 낼 수 있는지 미리 알려 준다.
export async function GET(request: Request) {
  const learner = await findLearner(request.headers);
  if (!learner) return new Response(null, { status: 401 });
  const unitId = new URL(request.url).searchParams.get("unitId");
  if (!unitId) return new Response(null, { status: 400 });
  try {
    return Response.json({ personalized: await hasUnitCandidates(learner.id, unitId) });
  } catch (error) {
    reportQuizProblemError(error);
    return new Response(null, { status: 500 });
  }
}
