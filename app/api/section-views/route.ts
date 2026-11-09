import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import { addDwell, parseDwellInput, parseSeenInput, recordSeen, reportSectionViewError } from "@/lib/section-views";

// 학습 화면에서 절 소제목이 본문 맨 위에 닿으면 본 절로 남긴다. 응답의 학습일은 그 절의 머문 시간을 보낼 때 함께 보낸다.
export async function POST(request: Request) {
  return handle(request, parseSeenInput, async (learnerId, input) => {
    const day = await recordSeen(learnerId, input);
    return day === undefined ? status(400) : Response.json({ studyDay: day });
  });
}

// 읽던 절을 떠나면 그 절에 머문 시간을 처음 본 학습일 줄에 더한다.
export async function PATCH(request: Request) {
  return handle(request, parseDwellInput, async (learnerId, input) =>
    status((await addDwell(learnerId, input)) ? 204 : 400),
  );
}

async function handle<T>(
  request: Request,
  parse: (body: unknown) => T | undefined,
  run: (learnerId: string, input: T) => Promise<Response>,
) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 본 절을 남기지 못하게 막는다. 비교 기준은 질문 라우트와 같다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const input = parse(await request.json().catch(() => undefined));
  if (input === undefined) return status(400);
  try {
    return await run(learner.id, input);
  } catch (error) {
    reportSectionViewError(error);
    return status(500);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}
