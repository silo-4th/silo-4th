import "server-only";
import { env } from "@/lib/env";
import { askJson } from "./ask-json";
import { CONCEPT_NOTES } from "./concept-notes";

// 분류는 모든 질문의 첫 글자를 늦추므로 짧게 끊고, 실패하면 과거 요약 없이 답한다.
const CLASSIFY_TIMEOUT_MS = 10_000;
// 요약은 답을 보낸 뒤에 돈다. 분류 10초, 답 240초와 더하면 280초라 DB 왕복을 빼면 Vercel의 300초까지 여유가 적다.
// 넘겨서 함수가 끊겨도 답은 이미 저장돼 있고 요약만 비어 남는다.
const SUMMARY_TIMEOUT_MS = 30_000;

const STRINGS = { type: "array", items: { type: "string" } };

export type Classification = { conceptIds: string[]; keywords: string[] };
export type Summary = { summary: string; keywords: string[] };

// 질문이 가장 직접 묻는 개념 하나를 고르고 핵심 용어를 뽑는다. 지시해도 가끔 두 개를 고르고, 돌려준 ID가 목록에 있는지도 확인하지 않는다.
// 응답을 conceptId 하나로 받으면 실행마다 결과가 흔들려서 배열로 받는다. 근거는 평가 저장소의 classify/records/2026-11-06-single-concept.md다.
export async function classifyQuestion(
  question: string,
  concepts: readonly { id: string; title: string }[],
): Promise<Classification> {
  const reply = await askJson({
    model: env.ANTHROPIC_UTILITY_MODEL,
    system:
      "학습자의 질문이 아래 개념 목록의 어느 개념에 대한 질문인지 고른다. 개념마다 이름 뒤에 한 줄 정리가 붙어 있다. 이름만 보지 말고 한 줄 정리까지 읽고, 질문이 실제로 묻는 내용과 가장 직접 맞는 개념을 고른다. 개념은 최대 하나만 고른다. 질문이 여러 개념에 걸치면 질문이 가장 직접 묻는 개념 하나를 고른다. 해당하는 개념이 없으면 conceptIds를 비운다. keywords에는 질문의 핵심 용어를 1~5개 넣는다.",
    content: `<concepts>\n${concepts.map(conceptLine).join("\n")}\n</concepts>\n\n<question>\n${question}\n</question>`,
    properties: { conceptIds: STRINGS, keywords: STRINGS },
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  });
  return { conceptIds: strings(reply.conceptIds), keywords: strings(reply.keywords) };
}

// 다음 질문의 답변 프롬프트에 원문 대신 넣을 요약을 만든다.
export async function summarizeQuestion(question: string, answer: string): Promise<Summary> {
  const reply = await askJson({
    model: env.ANTHROPIC_UTILITY_MODEL,
    system:
      "학습자의 질문과 AI의 답을 읽고, 학습자가 무엇을 물었고 어떤 답을 받았는지 한국어 2~3문장, 300자 이내로 요약한다. keywords에는 핵심 용어를 1~5개 넣는다.",
    content: `<question>\n${question}\n</question>\n\n<answer>\n${answer}\n</answer>`,
    properties: { summary: { type: "string" }, keywords: STRINGS },
    timeoutMs: SUMMARY_TIMEOUT_MS,
  });
  if (typeof reply.summary !== "string" || !reply.summary.trim()) throw new Error("AI 요약이 비어 있다.");
  return { summary: reply.summary.trim(), keywords: strings(reply.keywords) };
}

function conceptLine({ id, title }: { id: string; title: string }) {
  const note = CONCEPT_NOTES[id];
  return note ? `${id}: ${title} - ${note}` : `${id}: ${title}`;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("AI 응답의 목록이 문자열 배열이 아니다.");
  }
  return value;
}
