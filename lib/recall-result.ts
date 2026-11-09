import type { AttemptInput } from "@/lib/quiz-attempts";
import { resultView } from "@/lib/quiz-card";
import type { RecallAnswer } from "@/lib/recall-flow";
import type { RecallSetView } from "@/lib/recall-sets";
import type { SectionAddress, StudyTarget } from "@/lib/unit-sections";

export type ResultChip = "맞혔어요" | "맞았지만 헷갈렸어요" | "틀렸어요" | "채점하지 못했어요";

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

function bodyOf(item: RecallItemView, answer: RecallAnswer): CardBody {
  // 모르겠어요는 채점을 받지 못해도 건너뛴 것과 같다.
  if (answer.kind === "skipped" || (!answer.result && answer.submitted.dontKnow))
    return { ...NOTHING_SHOWN, chip: "틀렸어요", myAnswer: SKIPPED_ANSWER };
  const { submitted, result } = answer;
  if (!result) return { ...NOTHING_SHOWN, chip: "채점하지 못했어요", myAnswer: submittedText(item, submitted) };
  const view = resultView(submitted, result);
  const shown = {
    myAnswer: submitted.dontKnow ? SKIPPED_ANSWER : view.myAnswer,
    correctAnswer: view.correctAnswers.join(", "),
    explanation: result.explanation,
  };
  if (result.outcome === "ungraded") return { chip: "채점하지 못했어요", ...shown };
  if (!result.isCorrect || submitted.dontKnow) return { chip: "틀렸어요", ...shown };
  const chip = submitted.confidence === "sure" ? "맞혔어요" : "맞았지만 헷갈렸어요";
  return { ...NOTHING_SHOWN, chip, explanation: result.explanation };
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

function countOf(cards: ResultCard[], chip: ResultChip) {
  return cards.filter((card) => card.chip === chip).length;
}

// 채점하지 못한 문항은 맞힘도 틀림도 아니라서 문항 수 N에서 뺀다.
export function resultTitle(cards: ResultCard[]): string {
  const total = cards.length - countOf(cards, "채점하지 못했어요");
  const wrong = countOf(cards, "틀렸어요");
  const unsure = countOf(cards, "맞았지만 헷갈렸어요");
  if (total === 0) return "꺼내 먹기를 마쳤어요";
  if (wrong > 0) return `${total}개 중 ${wrong}개를 틀렸어요`;
  if (unsure > 0) return `${total}개 다 맞혔지만 ${unsure}개는 헷갈렸어요`;
  return `${total}개 모두 맞혔어요`;
}

export function resultSubtitle(cards: ResultCard[]): string {
  const review = countOf(cards, "틀렸어요") + countOf(cards, "맞았지만 헷갈렸어요");
  return review > 0
    ? "잘 기억한 건 넘어가고, 다른 건 다시 볼 곳을 알려줄게요."
    : "오늘은 새로운 내용으로 넘어가도 좋아요.";
}

export function studyHref({ unitId, key }: StudyTarget): string {
  return key === undefined ? `/study/${unitId}` : `/study/${unitId}#${key}`;
}
