import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { resultView } from "@/lib/quiz-card";
import type { RecallAnswer } from "@/lib/recall-flow";
import type { RecallSetView } from "@/lib/recall-sets";
import type { SectionAddress, StudyTarget } from "@/lib/unit-sections";

export const RESULT_CHIPS = ["맞혔어요", "맞았지만 헷갈렸어요", "틀렸어요", "채점하지 못했어요"] as const;

export type ResultChip = (typeof RESULT_CHIPS)[number];

export type ResultCard = {
  itemId: string;
  conceptTitle: string;
  section?: SectionAddress;
  chip: ResultChip;
  studyLink: boolean;
  myAnswer: string | undefined;
  correctAnswer: string | undefined;
  explanation: string | undefined;
  stacked: boolean;
};

type CardBody = Pick<ResultCard, "chip" | "myAnswer" | "correctAnswer" | "explanation">;
type RecallItemView = RecallSetView["items"][number];

const NOTHING_SHOWN = { myAnswer: undefined, correctAnswer: undefined, explanation: undefined };
const SKIPPED_ANSWER = "건너뛰었어요";
const SIDE_BY_SIDE_MAX = 30;

// 채점을 받지 못하면 정답 선택지 글이 없으므로, 문제의 선택지에서 고른 글을 찾는다.
function submittedText(item: RecallItemView, submitted: AttemptInput) {
  if (submitted.chosenIndex !== null) return item.problem.choices?.[submitted.chosenIndex] ?? "";
  return submitted.answerText ?? "";
}

// 꺼내 먹기와 퀴즈 탭이 함께 쓰는 칩 규칙이다. 모르겠어요는 채점을 받지 못해도 틀린 것으로 본다.
export function chipOf(submitted: AttemptInput, result?: AttemptResult): ResultChip {
  if (!result) return submitted.dontKnow ? "틀렸어요" : "채점하지 못했어요";
  if (result.outcome === "ungraded") return "채점하지 못했어요";
  if (!result.isCorrect || submitted.dontKnow) return "틀렸어요";
  return submitted.confidence === "sure" ? "맞혔어요" : "맞았지만 헷갈렸어요";
}

function bodyOf(item: RecallItemView, answer: RecallAnswer): CardBody {
  if (answer.kind === "skipped") return { ...NOTHING_SHOWN, chip: "틀렸어요", myAnswer: SKIPPED_ANSWER };
  const { submitted, result } = answer;
  const chip = chipOf(submitted, result);
  if (!result) return { ...NOTHING_SHOWN, chip, myAnswer: submitted.dontKnow ? SKIPPED_ANSWER : submittedText(item, submitted) };
  if (chip === "맞혔어요" || chip === "맞았지만 헷갈렸어요") return { ...NOTHING_SHOWN, chip, explanation: result.explanation };
  const view = resultView(submitted, result);
  return {
    chip,
    myAnswer: submitted.dontKnow ? SKIPPED_ANSWER : view.myAnswer,
    correctAnswer: view.correctAnswers.join(", "),
    explanation: result.explanation,
  };
}

export function resultCards(set: RecallSetView, answers: RecallAnswer[]): ResultCard[] {
  return answers.flatMap((answer) => {
    const item = set.items.find((candidate) => candidate.id === answer.itemId);
    if (!item) return [];
    const body = bodyOf(item, answer);
    const longest = Math.max(body.myAnswer?.length ?? 0, body.correctAnswer?.length ?? 0);
    return {
      itemId: item.id,
      conceptTitle: item.problem.conceptTitle,
      ...(item.section && { section: item.section }),
      ...body,
      studyLink: body.chip !== "맞혔어요",
      stacked: body.correctAnswer !== undefined && longest > SIDE_BY_SIDE_MAX,
    };
  });
}

type Chipped = Pick<ResultCard, "chip">;

function countOf(cards: readonly Chipped[], chip: ResultChip) {
  return cards.filter((card) => card.chip === chip).length;
}

// 채점하지 못한 문항은 맞힘도 틀림도 아니라서 문항 수 N에서 뺀다.
export function resultTitle(cards: readonly Chipped[], finished = "꺼내 먹기를 마쳤어요"): string {
  const total = cards.length - countOf(cards, "채점하지 못했어요");
  const wrong = countOf(cards, "틀렸어요");
  const unsure = countOf(cards, "맞았지만 헷갈렸어요");
  if (total === 0) return finished;
  if (wrong === total) return `${total}개 모두 틀렸어요`;
  if (wrong > 0) return `${total}개 중 ${wrong}개를 틀렸어요`;
  if (unsure > 0) return `${total}개 다 맞혔지만 ${unsure}개는 헷갈렸어요`;
  return `${total}개 모두 맞혔어요`;
}

export function needsReview(cards: readonly Chipped[]): boolean {
  return countOf(cards, "틀렸어요") + countOf(cards, "맞았지만 헷갈렸어요") > 0;
}

export function resultSubtitle(cards: readonly Chipped[]): string {
  return needsReview(cards)
    ? "잘 기억한 건 넘어가고, 다른 건 다시 볼 곳을 알려줄게요."
    : "오늘은 새로운 내용으로 넘어가도 좋아요.";
}

export function studyHref({ unitId, key }: StudyTarget): string {
  return key === undefined ? `/study/${unitId}` : `/study/${unitId}#${key}`;
}
