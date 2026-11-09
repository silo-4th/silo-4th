import type { AnswerTone } from "@/lib/answer-tone";

// failed는 AI가 답하지 못했거나 서버가 요청을 거절한 경우, cut은 done이나 error 없이 연결이 끊긴 경우,
// pending은 서버가 아직 같은 질문에 답하는 중인 경우, signed-out은 세션이 없어 로그인이 풀린 경우다.
export type FailReason = "failed" | "cut" | "pending" | "signed-out";
export type AnswerResult = { ok: true; answer: string } | { ok: false; reason: FailReason };

const fail = (reason: FailReason): AnswerResult => ({ ok: false, reason });

// 질문 서버의 SSE 응답을 읽어 답 조각이 올 때마다 지금까지 이은 답을 onText로 넘긴다. done이 와야 성공이다.
// 연결 유지 신호는 이벤트 이름이 없는 주석 줄이라 건너뛴다.
export async function readAnswer(response: Response, onText?: (answer: string) => void): Promise<AnswerResult> {
  if (response.status === 409) return fail("pending");
  if (response.status === 401) return fail("signed-out");
  if (!response.ok || !response.body) return fail("failed");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let answer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return fail("cut");
      buffer += value;
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const { event, data } = parseEvent(block);
        if (event === "done") return { ok: true, answer };
        if (event === "error") return fail("failed");
        if (event !== "delta") continue;
        const text = deltaText(data);
        if (text === undefined) return fail("failed");
        answer += text;
        onText?.(answer);
      }
    }
  } finally {
    // 읽기를 일찍 멈추면 연결을 닫아, 서버가 이 질문을 계속 붙잡고 있지 않게 한다.
    reader.cancel().catch(() => {});
  }
}

function parseEvent(block: string) {
  let event: string | undefined;
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice("event: ".length);
    else if (line.startsWith("data: ")) data = line.slice("data: ".length);
  }
  return { event, data };
}

function deltaText(data: string) {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { text } = parsed as Record<string, unknown>;
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
}

export async function askQuestion(
  input: { questionId: string; sessionId: string; unitId: string; content: string; tone: AnswerTone },
  onText?: (answer: string) => void,
) {
  try {
    const response = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readAnswer(response, onText);
  } catch {
    return fail("cut");
  }
}
