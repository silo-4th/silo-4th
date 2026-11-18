import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { quizHomeQuery, refreshQuizHome } from "./queries";

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
