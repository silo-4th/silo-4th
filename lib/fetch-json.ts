import type { FetchFailure } from "@/lib/analytics";

// 문제 생성은 30초까지 걸릴 수 있다. 응답이 오지 않는 요청을 끝없이 기다리지 않게 넉넉히 기다린 뒤 실패로 본다.
const REQUEST_TIMEOUT_MS = 45_000;

// servedAt은 응답의 Date 헤더로 읽은 서버 시각이다. 초 단위로 내림되어 있어 그 응답 뒤의 풀이는 모두 이 시각 이후다.
// 실패는 이벤트의 error_type으로 나누도록 상태 코드나 응답이 없던 까닭을 남긴다.
export type Fetched<T> = { ok: true; body: T; servedAt?: string } | { ok: false; failure: FetchFailure };

// 브라우저가 서버 데이터를 받는 하나뿐인 함수다. 실패해도 던지지 않고 까닭을 돌려준다.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<Fetched<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return { ok: false, failure: response.status };
    const date = new Date(response.headers.get("date") ?? "");
    const body = (await response.json()) as T;
    return Number.isNaN(date.getTime()) ? { ok: true, body } : { ok: true, body, servedAt: date.toISOString() };
  } catch {
    return { ok: false, failure: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
