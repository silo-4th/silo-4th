import { QueryClient, queryOptions } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetch-json";
import type { PastAttempt } from "@/lib/past-problems";
import type { SessionSummary, SessionTurn } from "@/lib/question-sessions";

// 학습 화면이 브라우저에서 받는 서버 데이터다. 근거와 다시 받는 때는 _docs/wiki/adr/0014-client-state-management.md에 있다.
// 받은 값은 스스로 다시 받지 않고, 값이 바뀌는 때를 아는 화면이 아래 refresh 함수로 알린다.
// 실패 화면과 다시 시도를 지금처럼 바로 보여 주려고 자동 재시도는 끈다. 받지 못한 값은 staleTime과 상관없이 낡은 값으로 보므로,
// 창으로 돌아오거나 다시 연결될 때 실패 화면이 저절로 로딩으로 바뀌지 않게 그때 다시 받는 것도 끈다.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
}

async function load<T>(url: string): Promise<T> {
  const fetched = await fetchJson<T>(url);
  if (!fetched.ok) throw new Error(`${url} 요청이 실패했다: ${fetched.failure}`);
  return fetched.body;
}

export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: async () => (await load<{ sessions: SessionSummary[] }>("/api/question-sessions")).sessions,
});

export function sessionQuery(sessionId: string) {
  return queryOptions({
    queryKey: ["session", sessionId],
    queryFn: async () => (await load<{ turns: SessionTurn[] }>(`/api/question-sessions/${sessionId}`)).turns,
  });
}

export function quizHomeQuery(unitId: string) {
  return queryOptions({
    queryKey: ["quiz-home", unitId],
    queryFn: async () => (await load<{ personalized: boolean }>(`/api/quiz-home?${new URLSearchParams({ unitId })}`)).personalized,
  });
}

export const pastAttemptsQuery = queryOptions({
  queryKey: ["quiz-attempts"],
  queryFn: () => load<PastAttempt[]>("/api/quiz-attempts"),
});

// 그 단원에서 절을 보거나 질문을 보낸 뒤 부른다. 맞춤 여부는 한 번 참이 되면 거짓으로 돌아가지 않아 참이면 다시 받지 않는다.
// 퀴즈 홈이 닫혀 있어도 바로 받아 두어, 다시 열 때 지난 안내가 잠깐 보이지 않게 한다.
export function refreshQuizHome(client: QueryClient, unitId: string) {
  return client.invalidateQueries({
    queryKey: quizHomeQuery(unitId).queryKey,
    predicate: (query) => query.state.data !== true,
    refetchType: "all",
  });
}

// 채점 결과를 받아 풀이가 저장된 뒤 부른다. 지난 문제는 다음에 열 때 앞 목록을 먼저 보여 주고 새로 받는다.
export function refreshPastAttempts(client: QueryClient) {
  return client.invalidateQueries({ queryKey: pastAttemptsQuery.queryKey });
}
