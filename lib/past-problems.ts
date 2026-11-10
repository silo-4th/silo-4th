import type { QuizAnswer, QuizFormat } from "@/lib/db/schema";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { resultView, shownStem } from "@/lib/quiz-card";
import { type ResultChip, chipOf } from "@/lib/recall-result";

// 퀴즈 탭에서 푼 풀이 하나와 그 문제다. 조회 API가 이 모양 그대로 돌려준다.
export type PastAttempt = {
  attemptId: string;
  answeredAt: string;
  unitTitle: string;
  format: QuizFormat;
  stem: string;
  chosenIndex: number | null;
  answerText: string | null;
  confidence: NonNullable<AttemptInput["confidence"]>;
  isCorrect: boolean | null;
  answer: QuizAnswer;
  explanation: string;
};

export type PastCard = {
  attemptId: string;
  unitTitle: string;
  formatLabel: string;
  chip: ResultChip;
  stem: string;
  myAnswer: string;
  correctAnswer: string;
  explanation: string;
};

export const PAST_FILTERS = ["전체", "틀림", "헷갈림", "맞힘"] as const;

export type PastFilter = (typeof PAST_FILTERS)[number];

const FILTER_CHIP: Record<Exclude<PastFilter, "전체">, ResultChip> = {
  틀림: "틀렸어요",
  헷갈림: "맞았지만 헷갈렸어요",
  맞힘: "맞혔어요",
};

const FORMAT_LABEL: Record<QuizFormat, string> = { mcq: "객관식", blank: "빈칸", free: "서술형" };
const DONT_KNOW_ANSWER = "잘 모르겠어요";

// 잘 모르겠어요는 찍어서 틀린 풀이로 저장된다. 고른 선택지도 쓴 글도 없으면 잘 모르겠어요밖에 없고,
// 쓰다 만 글이 남아 있으면 틀린 답과 구분할 수 없어 그 글을 보여 준다.
// 퀴즈 탭 결과와 같은 칩이 나오도록 저장된 풀이를 화면이 채점받던 모양으로 되돌린다.
export function pastCard(past: PastAttempt): PastCard {
  const dontKnow = past.chosenIndex === null && past.answerText === null;
  const submitted: AttemptInput = {
    attemptId: past.attemptId,
    problemId: "",
    chosenIndex: past.chosenIndex,
    answerText: past.answerText,
    confidence: past.confidence,
    hintUsed: false,
    dontKnow,
  };
  const { answer, explanation } = past;
  const result: AttemptResult =
    past.isCorrect === null ? { outcome: "ungraded", answer, explanation } : { outcome: "graded", isCorrect: past.isCorrect, answer, explanation };
  const view = resultView(submitted, result);
  return {
    attemptId: past.attemptId,
    unitTitle: past.unitTitle,
    formatLabel: FORMAT_LABEL[past.format],
    chip: chipOf(submitted, result),
    // 빈칸 자리는 퀴즈 카드와 같은 모양으로 바꿔 둔다. 화면은 문제를 마크다운으로 그린다.
    stem: past.format === "blank" ? shownStem(past.stem) : past.stem,
    myAnswer: dontKnow ? DONT_KNOW_ANSWER : view.myAnswer,
    correctAnswer: view.correctAnswers.join(", "),
    explanation,
  };
}

export function pastList(attempts: PastAttempt[], filter: PastFilter): PastCard[] {
  const cards = attempts
    .toSorted((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt))
    .map(pastCard);
  return filter === "전체" ? cards : cards.filter((card) => card.chip === FILTER_CHIP[filter]);
}

export async function fetchPastAttempts(): Promise<PastAttempt[] | undefined> {
  try {
    const response = await fetch("/api/quiz-attempts");
    return response.ok ? ((await response.json()) as PastAttempt[]) : undefined;
  } catch {
    return undefined;
  }
}
