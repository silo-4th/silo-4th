import type { Solved } from "@/lib/quiz-card";
import type { ProblemView, ResumedProblem } from "@/lib/quiz-problems";
import { RESULT_CHIPS, type ResultChip, chipOf, needsReview, resultTitle } from "@/lib/recall-result";
import { studyDay } from "@/lib/study-day";

// 생성은 30초까지 걸릴 수 있다. 응답이 오지 않는 요청을 끝없이 기다리지 않게 넉넉히 기다린 뒤 실패로 본다.
export const PROBLEM_TIMEOUT_MS = 45_000;

// 문제 생성 API에 보내는 본문 그대로다. 관련 문제 풀어보기는 질문 ID로 부른다.
export type ProblemAsk = { unitId: string } | { questionId: string };

// 새로고침이나 새 방문 뒤에도 이어 풀도록 브라우저에 남겨 두는 풀던 문제다.
// shownAt은 서버가 문제를 내준 시각이다. 서버는 다시 낸 기본 문제의 예전 풀이를 이 시각으로 걸러 낸다.
// 풀이 시각과 같은 서버 시계로 비교해야 하므로 브라우저 시계를 쓰지 않는다.
// results는 묶음에서 채점받은 칩이다. 새로고침 뒤에도 결과 화면에 앞서 푼 문제가 나오도록 함께 남긴다.
export type SavedProblem = { problemId: string; number: number; shownAt?: string; results?: SetResults };

export type SlotResult = { conceptTitle: string; chip: ResultChip };

// 번호마다 한 칸이다. 관련 문제처럼 그 번호에 새 문제가 뜨면 칸을 비우고, 그 문제를 채점받으면 다시 채운다.
export type SetResults = readonly (SlotResult | null)[];

// 한 브라우저를 여러 학습자가 쓸 수 있어 학습자마다 따로 기억한다.
function savedProblemKey(learnerId: string) {
  return `quiz-tab-problem:${learnerId}`;
}

// idle은 퀴즈 홈이다. 문제 생성에 비용이 들어서 학습자가 AI 맞춤 문제 풀기를 누르거나 풀던 문제가 있을 때만 enter를 보낸다.
// number는 지금 풀거나 받는 중인 문제가 몇 번째인지다.
// 화면은 loading 단계에 새로 들어올 때만 문제를 요청하므로, 같은 단계에 머무는 동안에는 요청이 하나뿐이다.
export type QuizTab =
  | { stage: "idle" }
  | ({ stage: "loading"; number: number } & ProblemAsk)
  | ({ stage: "failed"; number: number } & ProblemAsk)
  | { stage: "resuming"; number: number; problemId: string; shownAt?: string; unitId: string }
  | { stage: "problem"; number: number; problem: ProblemView }
  | { stage: "result" };

export type QuizTabEvent =
  | { type: "enter"; unitId: string; saved?: SavedProblem }
  | { type: "related"; questionId: string; saved?: SavedProblem }
  | { type: "loaded"; problem: ProblemView }
  | { type: "failed" }
  | { type: "solved" }
  | { type: "retry" }
  | { type: "graded"; solved: Solved }
  | { type: "next"; unitId: string; solved?: Solved }
  | { type: "restart"; unitId: string }
  | { type: "home" }
  | { type: "dismiss" };

// 문제 생성 비용 때문에 세 문제를 한 묶음으로 센다. 마지막 문제를 넘기면 결과를 보여 준다.
// 예전에 세 문제를 넘겨 기억해 둔 카운트가 있을 수 있어, 게이지는 가득 찬 채로 두고 그 문제를 넘기면 결과로 간다.
export const SET_SIZE = 3;

export function gaugeFilled(number: number, graded: boolean): number {
  return Math.min(SET_SIZE, number - 1 + (graded ? 1 : 0));
}

export function startQuizTab(): QuizTab {
  return { stage: "idle" };
}

// 퀴즈 탭을 열기 전에 관련 문제를 부르면 기억해 둔 묶음 위에서 받는다. 마지막 칸까지 찼으면 끝난 묶음이라 새로 시작한다.
function unfinished(saved: SavedProblem | undefined): SavedProblem | undefined {
  return saved && !(saved.number >= SET_SIZE && saved.results?.[saved.number - 1]) ? saved : undefined;
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
    const number = tab.stage === "result" ? 1 : tab.stage === "idle" ? (unfinished(event.saved)?.number ?? 1) : tab.number;
    return { stage: "loading", number, questionId: event.questionId };
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
      if (event.type === "solved")
        return tab.number >= SET_SIZE ? { stage: "result" } : { stage: "loading", number: tab.number + 1, unitId: tab.unitId };
      return event.type === "failed" ? { stage: "loading", number: tab.number, unitId: tab.unitId } : tab;
    case "loading":
      if (event.type === "loaded") return { stage: "problem", number: tab.number, problem: event.problem };
      return event.type === "failed" ? { stage: "failed", number: tab.number, ...askOf(tab) } : tab;
    case "failed":
      return event.type === "retry" ? { stage: "loading", number: tab.number, ...askOf(tab) } : tab;
    case "problem":
      if (event.type !== "next") return tab;
      return tab.number >= SET_SIZE ? { stage: "result" } : { stage: "loading", number: tab.number + 1, unitId: event.unitId };
    case "result":
      if (event.type === "restart") return { stage: "loading", number: 1, unitId: event.unitId };
      return event.type === "home" ? { stage: "idle" } : tab;
  }
}

// 탭 상태와 묶음 결과를 함께 옮긴다. 탭 상태가 바뀔 때만 문제를 요청하므로, 칩만 바뀐 상태는 요청을 늘리지 않는다.
// finished는 이 학습자가 오늘 학습일에 한 묶음을 마쳤는지다. 베타 동안에는 문제 생성 비용 때문에 마친 학습자가 새 묶음을 시작하지 못하고,
// 시작하려 하면 betaNotice로 막혔다는 안내를 띄운다.
export type QuizSet = { tab: QuizTab; results: SetResults; finished: boolean; betaNotice: boolean };
export type QuizSetEvent = QuizTabEvent;

export function startQuizSet(finished = false): QuizSet {
  return { tab: startQuizTab(), results: [], finished, betaNotice: false };
}

// 마지막 문제를 채점받거나 넘기는 순간 묶음을 마친 것으로 센다. 채점받고 결과 보기 전에 새로고침해도 마친 날이 남아야 하고,
// 이어 풀기로 결과에 다시 들어온 것은 지난 학습일에 마친 묶음일 수 있어 세지 않는다.
export function completesSet(tab: QuizTab, event: QuizSetEvent): boolean {
  return tab.stage === "problem" && tab.number >= SET_SIZE && (event.type === "graded" || event.type === "next");
}

// 기억해 둔 문제로 이어 푸는 enter는 새 묶음이 아니다. 퀴즈 홈의 AI 맞춤 문제 풀기만 saved 없이 enter를 보낸다.
function startsNewSet(tab: QuizTab, event: QuizSetEvent): boolean {
  if (tab.stage === "result") return event.type === "restart";
  return tab.stage === "idle" && event.type === "enter" && !event.saved;
}

function withSlot(results: SetResults, number: number, slot: SlotResult | null): SetResults {
  const next = Array.from({ length: Math.max(results.length, number) }, (_, index) => results[index] ?? null);
  next[number - 1] = slot;
  return next;
}

// 퀴즈 홈이나 결과에서 나가면 새 묶음이다. 기억해 둔 문제로 이어 풀 때만 남겨 둔 칩을 되살린다.
// 칩은 채점받을 때 남기고, 채점을 받지 못한 채 넘길 때도 낸 답으로 남긴다.
// 칸은 그 번호에 문제가 실제로 뜰 때 비운다. 관련 문제를 받는 중이나 풀지 않은 문제를 이어 풀기 전에 새로고침해도 앞서 받은 칩이 남는다.
function resultsAfter({ tab, results }: QuizSet, next: QuizTab, event: QuizSetEvent): SetResults {
  if (tab.stage === "idle" || tab.stage === "result") {
    if (next === tab) return results;
    if (event.type === "enter") return event.saved?.results ?? [];
    return event.type === "related" && tab.stage === "idle" ? (unfinished(event.saved)?.results ?? []) : [];
  }
  if (event.type === "loaded" && next !== tab && next.stage === "problem") return withSlot(results, next.number, null);
  const solved = event.type === "graded" || event.type === "next" ? event.solved : undefined;
  if (tab.stage !== "problem" || !solved) return results;
  return withSlot(results, tab.number, { conceptTitle: tab.problem.conceptTitle, chip: chipOf(solved.submitted, solved.result) });
}

export function advanceQuizSet(set: QuizSet, event: QuizSetEvent): QuizSet {
  if (event.type === "dismiss") return set.betaNotice ? { ...set, betaNotice: false } : set;
  if (set.finished && startsNewSet(set.tab, event)) return set.betaNotice ? set : { ...set, betaNotice: true };
  const tab = advanceQuizTab(set.tab, event);
  const results = resultsAfter(set, tab, event);
  const finished = set.finished || completesSet(set.tab, event);
  return tab === set.tab && results === set.results && finished === set.finished ? set : { ...set, tab, results, finished };
}

export function setItems(results: SetResults): SlotResult[] {
  return results.filter((slot) => slot !== null);
}

export function setTitle(results: SetResults): string {
  return resultTitle(setItems(results), "퀴즈를 마쳤어요");
}

// 헷갈렸어도 맞혔으면 맞힌 것으로 본다. 결과 화면의 마스코트가 이때 활짝 웃는다.
export function setAllRight(results: SetResults): boolean {
  const items = setItems(results);
  return items.length > 0 && items.every(({ chip }) => chip === "맞혔어요" || chip === "맞았지만 헷갈렸어요");
}

export function setGuide(results: SetResults): string {
  return needsReview(setItems(results))
    ? "헷갈리거나 틀린 개념은 본문에서 한 번 더 읽어 보면 좋아요."
    : "이 흐름 그대로 다음 단원으로 가도 좋아요.";
}

// 응답은 그 요청을 보낸 loading 상태가 아직 화면에 있을 때만 반영한다.
// 받는 중에 관련 문제를 부르면 먼저 보낸 요청의 문제나 실패가 관련 문제 자리를 덮지 않는다.
// 요청 하나의 결과다. solved는 기억해 둔 문제를 이미 풀었다는 뜻이고, undefined는 받지 못했다는 뜻이다.
export type ProblemResult = ProblemView | "solved" | undefined;

function settledEvent(problem: ProblemResult): QuizTabEvent {
  if (problem === "solved") return { type: "solved" };
  return problem ? { type: "loaded", problem } : { type: "failed" };
}

export function settleProblem(current: QuizTab, requested: QuizTab, problem: ProblemResult): QuizTab {
  return current === requested ? advanceQuizTab(current, settledEvent(problem)) : current;
}

// 화면은 이 함수로만 응답을 반영한다. 탭만 바꾸면 문제가 뜰 때 칸을 비우는 규칙을 건너뛴다.
export function settleQuizSet(current: QuizSet, requested: QuizTab, problem: ProblemResult): QuizSet {
  return current.tab === requested ? advanceQuizSet(current, settledEvent(problem)) : current;
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

export async function fetchPersonalized(unitId: string): Promise<boolean | undefined> {
  const home = await fetchJson<{ personalized: boolean }>(`/api/quiz-home?${new URLSearchParams({ unitId })}`);
  return home?.body.personalized;
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
    const { problemId, number, shownAt, results } = saved as Record<string, unknown>;
    if (typeof problemId !== "string" || !Number.isInteger(number) || Number(number) < 1) return undefined;
    const parsed = parseResults(results);
    return { problemId, number: Number(number), ...(typeof shownAt === "string" && { shownAt }), ...(parsed && { results: parsed }) };
  } catch {
    return undefined;
  }
}

function parseSlot(slot: unknown): SlotResult | null | undefined {
  if (slot === null) return null;
  if (typeof slot !== "object") return undefined;
  const { conceptTitle, chip } = slot as Record<string, unknown>;
  const known = RESULT_CHIPS.find((candidate) => candidate === chip);
  return typeof conceptTitle === "string" && known ? { conceptTitle, chip: known } : undefined;
}

// 칩 하나라도 읽지 못하면 결과가 어긋나므로 통째로 버린다.
function parseResults(results: unknown): SetResults | undefined {
  if (!Array.isArray(results)) return undefined;
  const slots = results.map(parseSlot);
  return slots.every((slot) => slot !== undefined) ? slots : undefined;
}

// 결과 화면을 나가면 풀던 문제는 지우므로, 묶음을 마쳤다는 사실은 따로 남겨야 새로고침 뒤에도 막힌다.
function finishedKey(learnerId: string) {
  return `quiz-tab-finished:${learnerId}`;
}

export function readSetFinished(learnerId: string): boolean {
  try {
    return finishedToday(localStorage.getItem(finishedKey(learnerId)) ?? undefined, new Date());
  } catch {
    return false;
  }
}

// 베타 동안의 제한은 하루 한 묶음이라, 묶음을 마친 학습일이 지나면 다시 새 묶음을 시작할 수 있다.
export function finishedToday(finishedDay: string | undefined, now: Date): boolean {
  return finishedDay === studyDay(now);
}

export function saveSetFinished(learnerId: string) {
  try {
    localStorage.setItem(finishedKey(learnerId), studyDay(new Date()));
  } catch {}
}

export function clearSavedProblem(learnerId: string) {
  try {
    localStorage.removeItem(savedProblemKey(learnerId));
  } catch {}
}

export function saveProblem(learnerId: string, saved: SavedProblem) {
  try {
    localStorage.setItem(savedProblemKey(learnerId), JSON.stringify(saved));
  } catch {}
}
