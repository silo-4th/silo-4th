import type { ProblemView } from "@/lib/quiz-problems";

// 생성은 30초까지 걸릴 수 있다. 응답이 오지 않는 요청을 끝없이 기다리지 않게 넉넉히 기다린 뒤 실패로 본다.
export const PROBLEM_TIMEOUT_MS = 45_000;

// number는 지금 풀거나 받는 중인 문제가 몇 번째인지다.
// 화면은 loading 단계에 새로 들어올 때만 문제를 요청하므로, 같은 단계에 머무는 동안에는 요청이 하나뿐이다.
export type QuizTab =
  | { stage: "idle" }
  | { stage: "loading"; number: number; unitId: string }
  | { stage: "failed"; number: number }
  | { stage: "problem"; number: number; problem: ProblemView };

export type QuizTabEvent =
  | { type: "enter"; unitId: string }
  | { type: "loaded"; problem: ProblemView }
  | { type: "failed" }
  | { type: "retry"; unitId: string }
  | { type: "next"; unitId: string };

export function startQuizTab(): QuizTab {
  return { stage: "idle" };
}

// 단계마다 받을 수 있는 이벤트만 상태를 바꾸고, 나머지는 같은 상태를 그대로 돌려준다.
// 단원을 바꾸거나 탭에 다시 들어와도 떠 있는 문제는 그대로 두고, 다음 문제부터 그때 열린 단원으로 만든다.
export function advanceQuizTab(tab: QuizTab, event: QuizTabEvent): QuizTab {
  switch (tab.stage) {
    case "idle":
      return event.type === "enter" ? { stage: "loading", number: 1, unitId: event.unitId } : tab;
    case "loading":
      if (event.type === "loaded") return { stage: "problem", number: tab.number, problem: event.problem };
      return event.type === "failed" ? { stage: "failed", number: tab.number } : tab;
    case "failed":
      return event.type === "retry" ? { stage: "loading", number: tab.number, unitId: event.unitId } : tab;
    case "problem":
      return event.type === "next" ? { stage: "loading", number: tab.number + 1, unitId: event.unitId } : tab;
  }
}

// 502, 400, 404와 연결 실패를 화면은 구분하지 않는다. 모두 오류와 다시 시도를 보여 주고, 기본 문제로 대신하지 않는다.
export async function fetchProblem(unitId: string): Promise<ProblemView | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBLEM_TIMEOUT_MS);
  try {
    const response = await fetch("/api/quiz-problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId }),
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as ProblemView) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
