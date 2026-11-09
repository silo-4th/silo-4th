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

export type RecallFlowEvent =
  | { type: "start" }
  | { type: "answered"; submitted: AttemptInput; result?: AttemptResult }
  | { type: "skip" };

type ProblemFlow = Extract<RecallFlow, { stage: "problem" }>;

export function startRecall(set: RecallSetView): RecallFlow {
  return { stage: "entry", set };
}

function moveOn(flow: ProblemFlow, answer: RecallAnswer): RecallFlow {
  const answers = [...flow.answers, answer];
  const index = flow.index + 1;
  return index < flow.set.items.length ? { ...flow, index, answers } : { stage: "result", set: flow.set, answers };
}

// 단계마다 받을 수 있는 이벤트만 상태를 바꾸고, 나머지는 그대로 둔다.
export function advanceRecall(flow: RecallFlow, event: RecallFlowEvent): RecallFlow {
  switch (flow.stage) {
    case "entry":
      if (event.type !== "start") return flow;
      return flow.set.items.length > 0
        ? { stage: "problem", set: flow.set, index: 0, answers: [] }
        : { stage: "result", set: flow.set, answers: [] };
    case "problem": {
      const item = flow.set.items[flow.index];
      if (!item || event.type === "start") return flow;
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
    reason: ENTRY_REASON[item.reason],
  }));
  const skipped = rows.filter((row) => row.reason === "넘어감").length;
  const asked = rows.length - skipped;
  const parts = [skipped > 0 && `질문 없이 넘어간 ${skipped}개`, asked > 0 && `물어본 ${asked}개`].filter(Boolean);
  return { rows, summary: `${parts.join(", ")}예요` };
}

async function post(path: string, init: RequestInit = {}): Promise<Response | undefined> {
  try {
    return await fetch(path, { method: "POST", ...init });
  } catch {
    return undefined;
  }
}

// 세트를 준비한 뒤 오늘 띄울 세트를 받는다. 준비가 실패해도 이미 만들어 둔 세트가 있을 수 있어 조회는 한다.
// 어느 쪽이든 실패하면 꺼내 먹기 없이 학습 화면을 보여 주도록 null을 돌려준다.
export async function openTodayRecall(): Promise<RecallSetView | null> {
  await post("/api/recall-sets");
  const response = await post("/api/recall-sets/today");
  if (!response?.ok) return null;
  try {
    const { set } = (await response.json()) as { set: RecallSetView | null };
    return set;
  } catch {
    return null;
  }
}

let recording: Promise<unknown> = Promise.resolve();

// 서버는 시작 기록이 있어야 완료를 받으므로, 앞 기록의 응답을 받은 뒤에 다음 기록을 보낸다.
// 기록이 실패해도 학습자의 흐름은 막지 않는다. 화면을 떠나도 보낸 기록은 끝까지 가도록 keepalive를 쓴다.
export function recordRecallEvent(setId: string, event: RecallEvent) {
  recording = recording.then(() =>
    post(`/api/recall-sets/${setId}/events`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }),
  );
}
