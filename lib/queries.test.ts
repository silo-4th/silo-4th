import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClient, pastAttemptsQuery, quizHomeQuery, refreshPastAttempts, refreshQuizHome } from "./queries";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function requestsAfterRefresh(personalized: boolean) {
  const fetchMock = vi.fn(async () => Response.json({ personalized }));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient();
  await client.fetchQuery(quizHomeQuery("unit-1"));
  await refreshQuizHome(client, "unit-1");
  client.clear();
  return fetchMock.mock.calls.length;
}

it("TC-342 퀴즈 홈 맞춤 여부가 참이면 절을 보거나 답을 받아도 다시 받지 않고, 거짓이면 다시 받아요", async () => {
  expect(await requestsAfterRefresh(true)).toBe(1);
  expect(await requestsAfterRefresh(false)).toBe(2);
});

// 응답을 차례로 돌려주되, 요청이 진행 중인 동안 다음 일이 끼어들 수 있게 조금 늦게 돌려준다.
function stubSlowFetch(bodies: unknown[]) {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const body = bodies[Math.min(call++, bodies.length - 1)];
    await new Promise((resolve) => setTimeout(resolve, 50));
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// 화면이 쿼리를 열어 둔 것처럼 구독한다. 아래 테스트는 앱과 같은 createQueryClient로 확인한다.
// 기본 QueryClient는 받은 값을 바로 낡은 값으로 봐서, 다시 구독만 해도 다시 받아 무효 표시를 확인하지 못한다.
function watch<T>(observer: QueryObserver<T, Error, T, T, string[]>) {
  return { observer, unsubscribe: observer.subscribe(() => {}) };
}

it("TC-346 퀴즈 홈을 처음 받는 중에 질문의 답이 끊기거나 실패해도 퀴즈 홈이 로딩에 멈추지 않고, 다음에 열 때 한 번 더 받아요", async () => {
  const fetchMock = stubSlowFetch([{ personalized: false }, { personalized: false }, { personalized: true }]);
  const client = createQueryClient();
  const opened = watch(new QueryObserver(client, quizHomeQuery("unit-1")));
  expect(opened.observer.getCurrentResult().isFetching).toBe(true);

  await refreshQuizHome(client, "unit-1", false);

  await vi.waitFor(() => expect(opened.observer.getCurrentResult().isPending).toBe(false));
  expect(opened.observer.getCurrentResult().data).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  opened.unsubscribe();

  const reopened = watch(new QueryObserver(client, quizHomeQuery("unit-1")));
  await vi.waitFor(() => expect(reopened.observer.getCurrentResult().data).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  reopened.unsubscribe();
  client.clear();
});

it("TC-347 지난 문제 목록을 처음 받는 중에 채점이 끝나면 방금 푼 문제가 있는 목록을 보여 줘요", async () => {
  stubSlowFetch([[], [{ id: "graded" }]]);
  const client = createQueryClient();
  const opened = watch(new QueryObserver(client, pastAttemptsQuery));
  expect(opened.observer.getCurrentResult().isFetching).toBe(true);

  await refreshPastAttempts(client);

  await vi.waitFor(() => expect(opened.observer.getCurrentResult().data).toEqual([{ id: "graded" }]));
  opened.unsubscribe();
  client.clear();
});
