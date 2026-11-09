const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 요청으로 온 ID를 DB에 넘기기 전에 확인한다. 모양이 틀린 값을 넘기면 Postgres가 오류를 던진다.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
