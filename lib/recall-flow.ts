import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import type { RecallEvent, RecallSetView } from "@/lib/recall-sets";

type RecallItemView = RecallSetView["items"][number];

// 결과 단계에 넘길 문항별 답이다. 채점을 받지 못한 채 넘어가면 result가 없다.
export type RecallAnswer =
  | { itemId: string; kind: "answered"; submitted: AttemptInput; result?: AttemptResult }
  | { itemId: string; kind: "skipped" };

export type RecallFlow =
  | { stage: "entry"; set: RecallSetView }
  | { stage: "problem"; set: RecallSetView; index: number; answers: RecallAnswer[] }
  | { stage: "result"; set: RecallSetView; answers: RecallAnswer[] };

// finish는 마지막이 아닌 문제에서 결과 보기를 누를 때 보낸다. 남은 문항은 건너뛴 것으로 두고, saved에 서버에 저장한 풀이가 있으면 그것을 쓴다.
export type RecallFlowEvent =
  | { type: "start" }
  | { type: "answered"; submitted: AttemptInput; result?: AttemptResult }
  | { type: "skip" }
  | { type: "finish"; saved?: RecallAnswer[] };

type ProblemFlow = Extract<RecallFlow, { stage: "problem" }>;

function ordered(set: RecallSetView, answers: RecallAnswer[]): RecallAnswer[] {
  return set.items.flatMap((item) => answers.find((answer) => answer.itemId === item.id) ?? []);
}

// 이미 푼 문항은 서버에 저장된 풀이로 결과에 모으고 다시 내지 않는다. 저장하지 못한 채 건너뛴 문항은 다시 낸다.
function openFrom(set: RecallSetView, answers: RecallAnswer[], from: number): RecallFlow {
  const index = set.items.findIndex((item, at) => at >= from && !item.answered);
  if (index !== -1) return { stage: "problem", set, index, answers };
  return { stage: "result", set, answers: ordered(set, answers) };
}

function savedAnswers(set: RecallSetView): RecallAnswer[] {
  return set.items.flatMap((item) => (item.answered ? { itemId: item.id, kind: "answered" as const, ...item.answered } : []));
}

// 시작한 세트는 입구를 다시 보이지 않고 남은 문항부터 이어 간다.
export function startRecall(set: RecallSetView): RecallFlow {
  return set.started ? openFrom(set, savedAnswers(set), 0) : { stage: "entry", set };
}

function moveOn(flow: ProblemFlow, answer: RecallAnswer): RecallFlow {
  return openFrom(flow.set, [...flow.answers, answer], flow.index + 1);
}

function remainingItems(flow: ProblemFlow): RecallItemView[] {
  return flow.set.items.filter((item, at) => at >= flow.index && !item.answered);
}

// 서버에 풀이가 없는 문항이다. 지금 문제부터 풀지 않은 문항과, 앞에서 건너뛰었지만 저장하지 못한 문항이다.
// 결과 보기를 누르면 이 문항들을 잘 모르겠어요 풀이로 저장한다.
export function unsavedItems(flow: ProblemFlow): RecallItemView[] {
  const skipped = new Set(flow.answers.flatMap((answer) => (answer.kind === "skipped" ? answer.itemId : [])));
  return flow.set.items.filter((item, at) => skipped.has(item.id) || (at >= flow.index && !item.answered));
}

// 건너뛴 문항도 잘 모르겠어요 풀이로 저장해, 결과에 정답과 해설을 보여 주고 이어 풀 때 다시 내지 않는다.
export function skippedRequest(item: RecallItemView): AttemptInput {
  return {
    attemptId: crypto.randomUUID(),
    problemId: item.problem.id,
    recallItemId: item.id,
    chosenIndex: null,
    answerText: null,
    confidence: null,
    hintUsed: false,
    dontKnow: true,
  };
}

// 저장한 풀이가 앞의 답보다 먼저 오게 두어, 앞에서 저장하지 못하고 건너뛴 문항도 저장한 풀이로 바꾼다.
function finish(flow: ProblemFlow, saved: RecallAnswer[] = []): RecallFlow {
  const rest = remainingItems(flow).map((item): RecallAnswer => ({ itemId: item.id, kind: "skipped" }));
  return { stage: "result", set: flow.set, answers: ordered(flow.set, [...saved, ...flow.answers, ...rest]) };
}

// 단계마다 받을 수 있는 이벤트만 상태를 바꾸고, 나머지는 그대로 둔다.
export function advanceRecall(flow: RecallFlow, event: RecallFlowEvent): RecallFlow {
  switch (flow.stage) {
    case "entry":
      if (event.type !== "start") return flow;
      return openFrom(flow.set, savedAnswers(flow.set), 0);
    case "problem": {
      const item = flow.set.items[flow.index];
      if (!item || event.type === "start") return flow;
      if (event.type === "finish") return finish(flow, event.saved);
      return moveOn(
        flow,
        event.type === "skip"
          ? { itemId: item.id, kind: "skipped" }
          : { itemId: item.id, kind: "answered", submitted: event.submitted, ...(event.result && { result: event.result }) },
      );
    }
    case "result":
      return flow;
  }
}

// 뒤에 이미 푼 문항만 남았으면 이 문제를 넘길 때 결과로 간다.
export function isLastProblem(flow: ProblemFlow): boolean {
  return !flow.set.items.some((item, at) => at > flow.index && !item.answered);
}

// 문제 단계에서만 몇 번째 문제인지 보여 준다.
export function progressOf(flow: RecallFlow): string | undefined {
  return flow.stage === "problem" ? `${flow.index + 1} / ${flow.set.items.length}` : undefined;
}

export type EntryReason = "넘어감" | "물어봄";

// 퀴즈 탭에서 푼 절도 질문한 절로 센다.
const ENTRY_REASON: Record<RecallItemView["reason"], EntryReason> = {
  read_no_question: "넘어감",
  asked: "물어봄",
  quiz: "물어봄",
};

export function entryOf(items: RecallItemView[]) {
  const rows = items.map((item) => ({
    id: item.id,
    conceptTitle: item.problem.conceptTitle,
    unitTitle: item.unitTitle,
    reason: ENTRY_REASON[item.reason],
  }));
  return { rows, summary: `${rows.length}개를 꺼내 보면 플러키에게 쿠키를 줄 수 있어요` };
}

async function post(path: string, init: RequestInit = {}): Promise<Response | undefined> {
  try {
    return await fetch(path, { method: "POST", ...init });
  } catch {
    return undefined;
  }
}

// 서버는 세트를 요청 하나로 만들어 단계별 진행을 알려 주지 않는다. 앞 두 단계는 시간으로 체크하고,
// 마지막 단계는 시간을 두지 않아 요청이 끝나기 전에는 모두 체크된 것처럼 보이지 않게 한다.
export const RECALL_PREP_STEPS: readonly { label: string; doneAtMs?: number }[] = [
  { label: "지난 공부 기록 살펴보기", doneAtMs: 1_200 },
  { label: "꺼내 볼 개념 3개 고르기", doneAtMs: 2_500 },
  { label: "문제 3개 만들기" },
];

export type PrepStepState = "done" | "now" | "wait";

export function prepStepsAt(elapsedMs: number): PrepStepState[] {
  const now = RECALL_PREP_STEPS.findIndex(({ doneAtMs }) => doneAtMs === undefined || elapsedMs < doneAtMs);
  return RECALL_PREP_STEPS.map((_, index) => (index < now ? "done" : index === now ? "now" : "wait"));
}

// 세트 준비는 서버에서 AI 문제 생성을 30초에서 끊는다. 채점과 같이 서버 상한의 두 배를 기다린 뒤 실패로 본다.
// 정상 응답을 끊지 않으면서, 서버가 멈췄을 때 학습 화면이 끝없이 막히지 않게 하는 값이다.
export const RECALL_CHECK_TIMEOUT_MS = 60_000;

// 세트를 준비한 뒤 오늘 띄울 세트를 받는다. 준비가 실패해도 이미 만들어 둔 세트가 있을 수 있어 조회는 한다.
// 어느 쪽이든 실패하면 꺼내 먹기 없이 학습 화면을 보여 주도록 null을 돌려준다.
export async function openTodayRecall(): Promise<RecallSetView | null> {
  await post("/api/recall-sets", { signal: AbortSignal.timeout(RECALL_CHECK_TIMEOUT_MS) });
  const response = await post("/api/recall-sets/today", { signal: AbortSignal.timeout(RECALL_CHECK_TIMEOUT_MS) });
  if (!response?.ok) return null;
  try {
    const { set } = (await response.json()) as { set: RecallSetView | null };
    return set;
  } catch {
    return null;
  }
}

// 네트워크가 잠깐 끊겨 시작 기록이 빠지면 뒤따르는 완료 기록도 서버가 거절하므로, 실패한 기록은 잠시 뒤 다시 보낸다.
// 4xx는 다시 보내도 결과가 같아 다시 보내지 않는다.
const EVENT_RETRY_DELAYS_MS = [1_000, 3_000];
// 기록은 차례로 보내므로 응답 없는 요청 하나가 뒤 기록을 모두 막는다. 시도마다 끊고 다시 보낸다.
// 기록 API는 서버에서 10초 안에 끝나거나 멈춘다. 그보다 길게 기다려야, 끊은 시작 기록이 완료 기록보다 늦게 저장되지 않는다.
// 서버는 같은 기록을 다시 받으면 처음 시각을 유지하므로, 끊긴 요청이 실제로 저장됐어도 다시 보내도 된다.
const EVENT_TIMEOUT_MS = 15_000;

async function sendEvent(setId: string, event: RecallEvent) {
  for (const delay of [0, ...EVENT_RETRY_DELAYS_MS]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await post(`/api/recall-sets/${setId}/events`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
      signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
    });
    if (response && response.status < 500) return;
  }
}

let recording: Promise<unknown> = Promise.resolve();

// 서버는 시작 기록이 있어야 완료를 받으므로, 앞 기록을 다시 보내는 것까지 끝난 뒤에 다음 기록을 보낸다.
// 기록이 실패해도 학습자의 흐름은 막지 않는다. 화면을 떠나도 보낸 기록은 끝까지 가도록 keepalive를 쓴다.
export function recordRecallEvent(setId: string, event: RecallEvent) {
  recording = recording.then(() => sendEvent(setId, event));
}
