import type { ProblemView } from "@/lib/quiz-problems";

// 생성은 30초까지 걸릴 수 있다. 응답이 오지 않는 요청을 끝없이 기다리지 않게 넉넉히 기다린 뒤 실패로 본다.
export const PROBLEM_TIMEOUT_MS = 45_000;

// 문제 생성 API에 보내는 본문 그대로다. 관련 문제 풀어보기는 질문 ID로 부른다.
export type ProblemAsk = { unitId: string } | { questionId: string };

// number는 지금 풀거나 받는 중인 문제가 몇 번째인지다.
// 화면은 loading 단계에 새로 들어올 때만 문제를 요청하므로, 같은 단계에 머무는 동안에는 요청이 하나뿐이다.
export type QuizTab =
  | { stage: "idle" }
  | ({ stage: "loading"; number: number } & ProblemAsk)
  | ({ stage: "failed"; number: number } & ProblemAsk)
  | { stage: "problem"; number: number; problem: ProblemView };

export type QuizTabEvent =
  | { type: "enter"; unitId: string }
  | { type: "related"; questionId: string }
  | { type: "loaded"; problem: ProblemView }
  | { type: "failed" }
  | { type: "retry" }
  | { type: "next"; unitId: string };

export function startQuizTab(): QuizTab {
  return { stage: "idle" };
}

function askOf(tab: ProblemAsk): ProblemAsk {
  return "questionId" in tab ? { questionId: tab.questionId } : { unitId: tab.unitId };
}

// 단계마다 받을 수 있는 이벤트만 상태를 바꾸고, 나머지는 같은 상태를 그대로 돌려준다.
// 단원을 바꾸거나 탭에 다시 들어와도 떠 있는 문제는 그대로 두고, 다음 문제부터 그때 열린 단원으로 만든다.
// 관련 문제는 어느 단계에서든 떠 있던 문제를 바꾸지만 카운트는 늘리지 않는다. 같은 질문을 받는 중이면 다시 요청하지 않는다.
export function advanceQuizTab(tab: QuizTab, event: QuizTabEvent): QuizTab {
  if (event.type === "related") {
    if (tab.stage === "loading" && "questionId" in tab && tab.questionId === event.questionId) return tab;
    return { stage: "loading", number: tab.stage === "idle" ? 1 : tab.number, questionId: event.questionId };
  }
  switch (tab.stage) {
    case "idle":
      return event.type === "enter" ? { stage: "loading", number: 1, unitId: event.unitId } : tab;
    case "loading":
      if (event.type === "loaded") return { stage: "problem", number: tab.number, problem: event.problem };
      return event.type === "failed" ? { stage: "failed", number: tab.number, ...askOf(tab) } : tab;
    case "failed":
      return event.type === "retry" ? { stage: "loading", number: tab.number, ...askOf(tab) } : tab;
    case "problem":
      return event.type === "next" ? { stage: "loading", number: tab.number + 1, unitId: event.unitId } : tab;
  }
}

// 응답은 그 요청을 보낸 loading 상태가 아직 화면에 있을 때만 반영한다.
// 받는 중에 관련 문제를 부르면 먼저 보낸 요청의 문제나 실패가 관련 문제 자리를 덮지 않는다.
export function settleProblem(current: QuizTab, requested: QuizTab, problem: ProblemView | undefined): QuizTab {
  if (current !== requested) return current;
  return advanceQuizTab(current, problem ? { type: "loaded", problem } : { type: "failed" });
}

// 502, 400, 404와 연결 실패를 화면은 구분하지 않는다. 모두 오류와 다시 시도를 보여 주고, 기본 문제로 대신하지 않는다.
export async function fetchProblem(ask: ProblemAsk): Promise<ProblemView | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBLEM_TIMEOUT_MS);
  try {
    const response = await fetch("/api/quiz-problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(askOf(ask)),
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as ProblemView) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
