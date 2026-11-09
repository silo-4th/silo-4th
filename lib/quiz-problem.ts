import type { GradableProblem } from "@/lib/quiz-grading";

// 퀴즈 생성 AI의 출력과 기본 문제 데이터가 저장 전에 거치는 문제 모양이다. 예제 코드는 stem 안에 마크다운 코드 블록으로 넣는다.
export type QuizProblemContent = GradableProblem & { stem: string; hint: string; explanation: string };

const MIN_CHOICES = 2;
const MAX_CHOICES = 4;
const BLANK_MARK = "____";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 공백만 있는 값은 화면에 아무것도 보이지 않으므로 빈 값으로 본다.
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function filledList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(isFilled) ? value : undefined;
}

// 모르는 필드는 버리고, 포맷에 맞지 않으면 undefined를 돌려준다.
export function parseQuizProblem(input: unknown): QuizProblemContent | undefined {
  if (!isRecord(input)) return undefined;
  const { format, stem, answer, hint, explanation } = input;
  if (!isFilled(stem) || !isFilled(hint) || !isFilled(explanation) || !isRecord(answer)) return undefined;
  const common = { stem, hint, explanation };
  switch (format) {
    case "mcq": {
      const { choices, answerIndex } = answer;
      if (!Array.isArray(choices) || choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) return undefined;
      const texts: unknown[] = choices.map((choice) => (isRecord(choice) ? choice.text : undefined));
      if (!texts.every(isFilled)) return undefined;
      if (typeof answerIndex !== "number" || !Number.isInteger(answerIndex)) return undefined;
      if (answerIndex < 0 || answerIndex >= texts.length) return undefined;
      return { ...common, format, answer: { choices: texts.map((text) => ({ text })), answerIndex } };
    }
    case "blank": {
      const accepted = filledList(answer.accepted);
      // 밑줄이 4개를 넘으면 화면이 빈칸으로 바꾼 뒤 밑줄이 남으므로, 정확히 4개인 자리 하나만 받는다.
      const marks = stem.match(/_{4,}/g);
      if (marks?.length !== 1 || marks[0] !== BLANK_MARK || !accepted) return undefined;
      return { ...common, format, answer: { accepted } };
    }
    case "free": {
      const { modelAnswer } = answer;
      const keyPoints = filledList(answer.keyPoints);
      if (!isFilled(modelAnswer) || !keyPoints) return undefined;
      return { ...common, format, answer: { modelAnswer, keyPoints } };
    }
    default:
      return undefined;
  }
}

// AI는 정답을 앞쪽 보기에 몰아 두므로, 저장하기 전에 보기 순서를 섞고 정답 번호를 따라 옮긴다.
export function shuffleChoices(problem: QuizProblemContent): QuizProblemContent {
  if (problem.format !== "mcq") return problem;
  const { choices, answerIndex } = problem.answer;
  const shuffled = choices
    .map((choice, index) => ({ choice, index, key: Math.random() }))
    .sort((a, b) => a.key - b.key);
  return {
    ...problem,
    answer: {
      choices: shuffled.map(({ choice }) => choice),
      answerIndex: shuffled.findIndex(({ index }) => index === answerIndex),
    },
  };
}
