import "server-only";
import { anthropic } from "./client";

// JSON 스키마로 답을 받는다. 제한 시간이 지나면 요청을 끊고 시간 초과 오류를 던진다.
export async function askJson({
  model,
  system,
  content,
  properties,
  timeoutMs,
}: {
  model: string;
  system: string;
  content: string;
  properties: Record<string, object>;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new Error(`AI가 ${timeoutMs / 1000}초 안에 답하지 않았다.`)),
    timeoutMs,
  );
  try {
    const response = await anthropic().messages.create(
      {
        model,
        max_tokens: 4000,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
          },
        },
        system,
        messages: [{ role: "user", content }],
      },
      { signal: abort.signal },
    );
    if (response.stop_reason !== "end_turn") throw new Error(`AI 응답이 ${response.stop_reason}로 끝났다.`);
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return parseObject(text);
  } catch (error) {
    throw abort.signal.aborted ? abort.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}

// JSON.parse 오류 메시지는 입력 일부를 담아, 질문 원문이나 퀴즈 답이 Sentry로 가지 않게 메시지를 바꾼다.
function parseObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 응답이 JSON이 아니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI 응답이 JSON 객체가 아니다.");
  }
  return parsed as Record<string, unknown>;
}
