import { after } from "next/server";
import { findLearner } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  answerQuestion,
  type Claim,
  claimQuestion,
  parseAskInput,
  reportQuestionError,
  summarizeAnswer,
} from "@/lib/questions";

// Vercel Hobby에서 함수가 쓸 수 있는 최대 시간이다. 연결이 끊긴 뒤에도 이 안에서 답을 끝까지 받아 저장한다.
export const maxDuration = 300;

const KEEP_ALIVE_MS = 15_000;

type Send =(event: "delta" | "done" | "error", data?: object) => void;

const REFUSED: Record<Exclude<Claim["kind"], "answer" | "saved">, number> = {
  pending: 409,
  "unknown-unit": 404,
  "not-yours": 403,
};

// 질문을 받아 AI 답을 SSE로 흘려보낸다. 이벤트는 답 조각 `delta`가 이어지다가 `done`이나 `error` 하나로 끝난다.
export async function POST(request: Request) {
  // 세션 쿠키가 실린 다른 사이트의 요청이 AI를 부르지 못하게 막는다.
  // `next dev`와 `next start`는 Host 헤더가 아니라 띄운 호스트 이름으로 request.url을 만들므로, 로그인과 같은 서비스 주소와 비교한다.
  if (request.headers.get("origin") !== new URL(env.AUTH_URL).origin) return status(403);
  const learner = await findLearner(request.headers);
  if (!learner) return status(401);
  if (!learner.consentedAt) return status(403);
  const input = parseAskInput(await request.json().catch(() => undefined));
  if (!input) return status(400);

  let claim: Claim;
  try {
    claim = await claimQuestion(learner.id, input);
  } catch (error) {
    reportQuestionError(error);
    return status(500);
  }

  switch (claim.kind) {
    case "saved":
      return eventStream(async (send) => {
        send("delta", { text: claim.answer });
        send("done");
      });
    case "answer":
      return eventStream(async (send) => {
        try {
          const result = await answerQuestion(input.questionId, (text) => send("delta", { text }));
          send(result.status === "ok" ? "done" : "error");
          // 요약은 다음 질문에서만 쓰므로 기다리지 않고 응답을 닫는다. 이 작업도 after 안이라 요약은 따로 after에 맡긴다.
          if (result.status === "ok") after(summarizeAnswer(input.questionId, result.question, result.answer));
        } catch (error) {
          reportQuestionError(error);
          send("error");
        }
      });
    default:
      return status(REFUSED[claim.kind]);
  }
}

function status(code: number) {
  return new Response(null, { status: code });
}

function eventStream(run: (send: Send) => Promise<void>) {
  const encoder = new TextEncoder();
  let open = true;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  // 학습자가 연결을 끊으면 보내기만 멈추고, 답은 끝까지 받아 저장한다.
  const write = (chunk: string) => {
    if (open) controller?.enqueue(encoder.encode(chunk));
  };
  const send: Send = (event, data = {}) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // AI가 생각하는 동안 글자가 오지 않아 연결이 조용해지면 중간 장비가 끊을 수 있다. 화면이 이벤트로 읽지 않는 주석 줄을 보낸다.
  const keepAlive = setInterval(() => write(": ping\n\n"), KEEP_ALIVE_MS);
  const work = run(send).finally(() => {
    clearInterval(keepAlive);
    if (open) controller?.close();
    open = false;
  });
  // 응답이 끊겨도 Vercel이 함수를 멈추지 않고 답을 저장할 때까지 기다리게 한다.
  after(work);
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
