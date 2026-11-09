import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  type Creation,
  createProblem,
  parseProblemRequest,
  reportQuizProblemError,
} from "@/lib/quiz-problems";

const REFUSED: Record<Exclude<Creation["kind"], "ok">, number> = {
  "unknown-unit": 404,
  "unknown-question": 404,
  // 화면은 오류를 보여 주고 다시 시도하게 한다. 기본 문제로 대신 내지 않는다.
  "generation-failed": 502,
};

// 퀴즈 문제 하나를 만들어 저장하고, 정답과 해설을 뺀 문제를 돌려준다.
export async function POST(request: Request) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 AI 호출과 저장을 일으키지 못하게 막는다. 비교 기준은 질문 API와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin)
    return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const input = parseProblemRequest(
    await request.json().catch(() => undefined),
  );
  if (!input) return status(400);

  let creation: Creation;
  try {
    creation = await createProblem(learner.id, input);
  } catch (error) {
    reportQuizProblemError(error);
    return status(500);
  }
  return creation.kind === "ok"
    ? Response.json(creation.problem)
    : status(REFUSED[creation.kind]);
}

function status(code: number) {
  return new Response(null, { status: code });
}
