import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import type { ProblemView } from "@/lib/quiz-problems";

// 서술형 설명은 채점 AI에게도 넘기므로 아주 긴 글은 받지 않는다. 서버도 같은 값으로 거절한다.
export const MAX_ANSWER_LENGTH = 4000;

type FlowProblem = Pick<ProblemView, "id" | "format" | "choices">;
type Confidence = NonNullable<AttemptInput["confidence"]>;
type Answer = Omit<AttemptInput, "confidence" | "dontKnow">;

export type ProblemStage = {
  stage: "problem";
  problem: FlowProblem;
  attemptId: string;
  hintUsed: boolean;
  chosenIndex: number | null;
  text: string;
  confidence: Confidence | null;
};

// 화면은 grading 단계에 들어오거나 sent가 바뀔 때마다 request를 보낸다.
export type QuizFlow =
  | ProblemStage
  | { stage: "grading"; request: AttemptInput; sent: 1 | 2 }
  | { stage: "grading-failed"; request: AttemptInput }
  | { stage: "explanation"; submitted: AttemptInput; result: AttemptResult }
  | { stage: "done" };

export type QuizFlowEvent =
  | { type: "choose"; index: number }
  | { type: "write"; text: string }
  | { type: "show-hint" }
  | { type: "pick-confidence"; confidence: Confidence }
  | { type: "check" }
  | { type: "dont-know" }
  | { type: "graded"; result: AttemptResult }
  | { type: "grading-failed" }
  | { type: "retry" }
  | { type: "next" };

// 같은 풀이를 다시 보내도 서버가 한 줄만 남기도록 풀이 ID는 문제를 시작할 때 한 번만 만든다.
export function startQuizFlow(problem: FlowProblem): ProblemStage {
  return { stage: "problem", problem, attemptId: crypto.randomUUID(), hintUsed: false, chosenIndex: null, text: "", confidence: null };
}

// 입력창의 maxLength처럼 넘친 글만 자른다. 통째로 버리면 붙여 넣은 글이 소리 없이 사라지고,
// 이모지를 반만 남기면 저장할 때 깨진 글자로 바뀐다.
function clipAnswer(text: string): string {
  if (text.length <= MAX_ANSWER_LENGTH) return text;
  const clipped = text.slice(0, MAX_ANSWER_LENGTH);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

function filledText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

function answerOf(flow: ProblemStage): Answer | undefined {
  const common = { attemptId: flow.attemptId, problemId: flow.problem.id, hintUsed: flow.hintUsed };
  if (flow.problem.format === "mcq") {
    return flow.chosenIndex === null ? undefined : { ...common, chosenIndex: flow.chosenIndex, answerText: null };
  }
  const answerText = filledText(flow.text);
  return answerText === null ? undefined : { ...common, chosenIndex: null, answerText };
}

// 답이 있어야 확신도를 고를 수 있게 보여 주고, 답과 확신도가 다 있어야 정답 확인으로 채점을 보낸다.
export function canSubmit(flow: QuizFlow): boolean {
  return flow.stage === "problem" && answerOf(flow) !== undefined;
}

export function canCheck(flow: QuizFlow): boolean {
  return flow.stage === "problem" && flow.confidence !== null && answerOf(flow) !== undefined;
}

function sending(request: AttemptInput): QuizFlow {
  return { stage: "grading", request, sent: 1 };
}

function onProblem(flow: ProblemStage, event: QuizFlowEvent): QuizFlow {
  const { format, choices = [] } = flow.problem;
  switch (event.type) {
    case "choose":
      return format === "mcq" && Number.isInteger(event.index) && event.index >= 0 && event.index < choices.length
        ? { ...flow, chosenIndex: event.index }
        : flow;
    case "write":
      return format === "mcq" ? flow : { ...flow, text: clipAnswer(event.text) };
    case "show-hint":
      return { ...flow, hintUsed: true };
    case "pick-confidence":
      return { ...flow, confidence: event.confidence };
    case "check": {
      const answer = answerOf(flow);
      return answer && flow.confidence ? sending({ ...answer, confidence: flow.confidence, dontKnow: false }) : flow;
    }
    // 잘 모르겠어요는 서술형에만 있고, 확신도 없이 바로 채점을 보낸다.
    case "dont-know":
      return format === "free"
        ? sending({
            attemptId: flow.attemptId,
            problemId: flow.problem.id,
            chosenIndex: null,
            answerText: filledText(flow.text),
            confidence: null,
            hintUsed: flow.hintUsed,
            dontKnow: true,
          })
        : flow;
    default:
      return flow;
  }
}

// 단계마다 받을 수 있는 이벤트만 상태를 바꾸고, 나머지는 그대로 둔다.
export function advanceQuizFlow(flow: QuizFlow, event: QuizFlowEvent): QuizFlow {
  switch (flow.stage) {
    case "problem":
      return onProblem(flow, event);
    case "grading":
      if (event.type === "graded") return { stage: "explanation", submitted: flow.request, result: event.result };
      if (event.type !== "grading-failed") return flow;
      // 실패하면 같은 요청을 한 번만 자동으로 다시 보낸다.
      return flow.sent === 1 ? { ...flow, sent: 2 } : { stage: "grading-failed", request: flow.request };
    case "grading-failed":
      if (event.type === "retry") return sending(flow.request);
      return event.type === "next" ? { stage: "done" } : flow;
    case "explanation":
      return event.type === "next" ? { stage: "done" } : flow;
    case "done":
      return flow;
  }
}
