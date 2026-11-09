import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { listPastAttempts, parseAttemptInput, reportQuizError, type Submission, submitAttempt } from "@/lib/quiz-attempts";

const REFUSED: Record<Exclude<Submission["kind"], "saved">, number> = {
  invalid: 400,
  "unknown-problem": 404,
  "unknown-recall-item": 404,
  "already-answered": 409,
  "not-yours": 403,
};

// 퀴즈 풀이 하나를 채점해 저장하고, 채점 결과와 정답, 해설을 돌려준다.
export async function POST(request: Request) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 풀이를 남기지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const input = parseAttemptInput(await request.json().catch(() => undefined));
  if (!input) return status(400);

  let submission: Submission;
  try {
    submission = await submitAttempt(learner.id, input);
  } catch (error) {
    reportQuizError(error);
    return status(500);
  }
  return submission.kind === "saved" ? Response.json(submission.result) : status(REFUSED[submission.kind]);
}

// 퀴즈 홈의 지난 문제 보기가 내가 퀴즈 탭에서 푼 풀이를 최근 순서로 받는다.
export async function GET(request: Request) {
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  try {
    return Response.json(await listPastAttempts(learner.id));
  } catch (error) {
    reportQuizError(error);
    return status(500);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}
