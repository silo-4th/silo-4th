import type { QUIZ_FORMATS, QuizAnswer } from "@/lib/db/schema";

export type ChoiceAnswer = Extract<QuizAnswer, { answerIndex: number }>;
export type BlankAnswer = Extract<QuizAnswer, { accepted: string[] }>;
export type FreeAnswer = Extract<QuizAnswer, { modelAnswer: string }>;

// DB는 answer jsonb가 format과 맞는지 검사하지 않아, 읽을 때 한 번 맞춰 본다.
export type GradableProblem =
  | { format: "mcq"; answer: ChoiceAnswer }
  | { format: "blank"; answer: BlankAnswer }
  | { format: "free"; answer: FreeAnswer };

export function toGradable(format: (typeof QUIZ_FORMATS)[number], answer: QuizAnswer): GradableProblem {
  if (format === "mcq" && "answerIndex" in answer) return { format, answer };
  if (format === "blank" && "accepted" in answer) return { format, answer };
  if (format === "free" && "modelAnswer" in answer) return { format, answer };
  throw new Error(`${format} 문제의 정답 구조가 format과 맞지 않는다.`);
}

export function gradeChoice(answer: ChoiceAnswer, chosenIndex: number): boolean {
  return chosenIndex === answer.answerIndex;
}

// 학습자는 키워드의 띄어쓰기를 생략하거나 다르게 쓰기 쉬워, 공백을 모두 지우고 대소문자를 무시해 비교한다.
export function gradeBlank(answer: BlankAnswer, text: string): boolean {
  const written = normalize(text);
  return answer.accepted.some((accepted) => normalize(accepted) === written);
}

function normalize(text: string) {
  return text.replace(/\s/g, "").toLowerCase();
}
