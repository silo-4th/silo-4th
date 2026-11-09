import type { ProblemView, ResumedProblem } from "@/lib/quiz-problems";

// 생성은 30초까지 걸릴 수 있다. 응답이 오지 않는 요청을 끝없이 기다리지 않게 넉넉히 기다린 뒤 실패로 본다.
export const PROBLEM_TIMEOUT_MS = 45_000;

// 문제 생성 API에 보내는 본문 그대로다. 관련 문제 풀어보기는 질문 ID로 부른다.
export type ProblemAsk = { unitId: string } | { questionId: string };

// 새로고침이나 새 방문 뒤에도 이어 풀도록 브라우저에 남겨 두는 풀던 문제다.
// shownAt은 서버가 문제를 내준 시각이다. 서버는 다시 낸 기본 문제의 예전 풀이를 이 시각으로 걸러 낸다.
// 풀이 시각과 같은 서버 시계로 비교해야 하므로 브라우저 시계를 쓰지 않는다.
export type SavedProblem = { problemId: string; number: number; shownAt?: string };

// 한 브라우저를 여러 학습자가 쓸 수 있어 학습자마다 따로 기억한다.
function savedProblemKey(learnerId: string) {
  return `quiz-tab-problem:${learnerId}`;
}

// number는 지금 풀거나 받는 중인 문제가 몇 번째인지다.
// 화면은 loading 단계에 새로 들어올 때만 문제를 요청하므로, 같은 단계에 머무는 동안에는 요청이 하나뿐이다.
export type QuizTab =
  | { stage: "idle" }
  | ({ stage: "loading"; number: number } & ProblemAsk)
  | ({ stage: "failed"; number: number } & ProblemAsk)
  | { stage: "resuming"; number: number; problemId: string; shownAt?: string; unitId: string }
  | { stage: "problem"; number: number; problem: ProblemView };

export type QuizTabEvent =
  | { type: "enter"; unitId: string; saved?: SavedProblem }
  | { type: "related"; questionId: string }
  | { type: "loaded"; problem: ProblemView }
  | { type: "failed" }
  | { type: "solved" }
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
      if (event.type !== "enter") return tab;
      return event.saved
        ? { stage: "resuming", ...event.saved, unitId: event.unitId }
        : { stage: "loading", number: 1, unitId: event.unitId };
    // 이미 푼 문제면 다음 문제를, 불러오지 못하면 같은 카운트의 새 문제를 열린 단원으로 만든다.
    case "resuming":
      if (event.type === "loaded") return { stage: "problem", number: tab.number, problem: event.problem };
      if (event.type === "solved") return { stage: "loading", number: tab.number + 1, unitId: tab.unitId };
      return event.type === "failed" ? { stage: "loading", number: tab.number, unitId: tab.unitId } : tab;
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
// 요청 하나의 결과다. solved는 기억해 둔 문제를 이미 풀었다는 뜻이고, undefined는 받지 못했다는 뜻이다.
export type ProblemResult = ProblemView | "solved" | undefined;

export function settleProblem(current: QuizTab, requested: QuizTab, problem: ProblemResult): QuizTab {
  if (current !== requested) return current;
  if (problem === "solved") return advanceQuizTab(current, { type: "solved" });
  return advanceQuizTab(current, problem ? { type: "loaded", problem } : { type: "failed" });
}

// servedAt은 응답의 Date 헤더로 읽은 서버 시각이다. 초 단위로 내림되어 있어 그 응답 뒤의 풀이는 모두 이 시각 이후다.
type Fetched<T> = { body: T; servedAt?: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<Fetched<T> | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBLEM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return undefined;
    const date = new Date(response.headers.get("date") ?? "");
    const body = (await response.json()) as T;
    return Number.isNaN(date.getTime()) ? { body } : { body, servedAt: date.toISOString() };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// 502, 400, 404와 연결 실패를 화면은 구분하지 않는다. 모두 오류와 다시 시도를 보여 주고, 기본 문제로 대신하지 않는다.
export function fetchProblem(ask: ProblemAsk): Promise<Fetched<ProblemView> | undefined> {
  return fetchJson<ProblemView>("/api/quiz-problems", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(askOf(ask)),
  });
}

export async function fetchResumedProblem({ problemId, shownAt }: { problemId: string; shownAt?: string }): Promise<ProblemResult> {
  const query = shownAt ? `?${new URLSearchParams({ shownAt })}` : "";
  const resumed = await fetchJson<ResumedProblem>(`/api/quiz-problems/${encodeURIComponent(problemId)}${query}`);
  if (!resumed) return undefined;
  return resumed.body.solved ? "solved" : resumed.body.problem;
}

// 브라우저가 저장소를 막아 두면 읽기와 쓰기가 예외를 던진다. 기억하지 못해도 퀴즈는 풀 수 있어야 한다.
export function readSavedProblem(learnerId: string): SavedProblem | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(savedProblemKey(learnerId)) ?? "null");
    if (typeof saved !== "object" || saved === null) return undefined;
    const { problemId, number, shownAt } = saved as Record<string, unknown>;
    if (typeof problemId !== "string" || !Number.isInteger(number) || Number(number) < 1) return undefined;
    return { problemId, number: Number(number), ...(typeof shownAt === "string" && { shownAt }) };
  } catch {
    return undefined;
  }
}

export function saveProblem(learnerId: string, saved: SavedProblem) {
  try {
    localStorage.setItem(savedProblemKey(learnerId), JSON.stringify(saved));
  } catch {}
}
