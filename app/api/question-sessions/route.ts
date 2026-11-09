import { findLearner } from "@/lib/auth";
import { listSessions, reportQuestionError } from "@/lib/questions";

export async function GET(request: Request) {
  const learner = await findLearner(request.headers);
  if (!learner) return new Response(null, { status: 401 });
  try {
    return Response.json({ sessions: await listSessions(learner.id) });
  } catch (error) {
    reportQuestionError(error);
    return new Response(null, { status: 500 });
  }
}
