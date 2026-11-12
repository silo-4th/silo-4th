// Apps Script에서 실행하는 부분. `npm run alert:build`가 이 파일을 Code.gs 하나로 묶는다.
// Script Properties: SENTRY_TOKEN, SLACK_WEBHOOK_URL, SENTRY_ORG, SENTRY_PROJECT_ID
import { alertEntry } from "@/lib/errors/alert-catalog";
import { type ErrorCode, isErrorCode } from "@/lib/errors/codes";
import { issueMessage, issueQuery, parseIssue, type SlackMessage, shouldAlertSpike, spikeMessage } from "./alert";

type Properties = { getProperty(key: string): string | null; setProperty(key: string, value: string): void };
type HttpResponse = { getResponseCode(): number; getContentText(charset: string): string };
type FetchOptions = { method?: "get" | "post"; contentType?: string; payload?: string; headers?: Record<string, string>; muteHttpExceptions: boolean };

declare const PropertiesService: { getScriptProperties(): Properties };
declare const LockService: { getScriptLock(): { tryLock(ms: number): boolean; releaseLock(): void } };
declare const UrlFetchApp: { fetch(url: string, options: FetchOptions): HttpResponse };
declare const ScriptApp: {
  getProjectTriggers(): { getHandlerFunction(): string }[];
  newTrigger(name: string): { timeBased(): { everyMinutes(n: number): { create(): void } } };
};

const SENTRY_API = "https://us.sentry.io/api/0";
const MAX_NOTIFIED_IDS = 100;

/** 처음 한 번 편집기에서 실행한다. 다시 실행해도 상태와 트리거가 늘지 않는다. */
export function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SINCE")) props.setProperty("SINCE", new Date().toISOString());
  if (!props.getProperty("NOTIFIED_IDS")) props.setProperty("NOTIFIED_IDS", "[]");
  if (!props.getProperty("SPIKE_ALERTED_AT")) props.setProperty("SPIKE_ALERTED_AT", "{}");

  const hasTrigger = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "run");
  if (!hasTrigger) ScriptApp.newTrigger("run").timeBased().everyMinutes(5).create();

  console.log(`Sentry 조회 성공: SINCE 이후 이슈 ${fetchIssues(props).length}건, 급증 후보 ${fetchSpikes(props).length}건`);
}

export function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    notifyIssues(props);
    notifySpikes(props);
  } finally {
    lock.releaseLock();
  }
}

// 전송에 성공할 때마다 상태를 저장한다. 중간에 멈추면 다음 실행에서 한 번 더 보내더라도 놓치지는 않는다.
function notifyIssues(props: Properties) {
  const notified: string[] = JSON.parse(props.getProperty("NOTIFIED_IDS") || "[]");
  const seen = new Set(notified);
  // sort=new라 최신순으로 오므로, 먼저 생긴 이슈부터 보내도록 뒤집는다.
  const fresh = fetchIssues(props)
    .filter((issue) => !seen.has(issue.id))
    .reverse();

  for (const issue of fresh) {
    postToSlack(props, issueMessage(issue, fetchIssueCode(props, issue.id)));
    notified.push(issue.id);
    props.setProperty("NOTIFIED_IDS", JSON.stringify(notified.slice(-MAX_NOTIFIED_IDS)));
  }
}

function notifySpikes(props: Properties) {
  const alertedAt: Record<string, string> = JSON.parse(props.getProperty("SPIKE_ALERTED_AT") || "{}");
  const now = new Date();

  for (const { code, count } of fetchSpikes(props)) {
    const entry = alertEntry(code);
    if (!entry.expected) continue;
    const last = alertedAt[code];
    if (!shouldAlertSpike({ count, threshold: entry.spikePerHour, lastAlertAt: last ? new Date(last) : undefined, now })) continue;

    postToSlack(props, spikeMessage(code, count));
    alertedAt[code] = now.toISOString();
    props.setProperty("SPIKE_ALERTED_AT", JSON.stringify(alertedAt));
  }
}

function sentryFetch(props: Properties, path: string) {
  return UrlFetchApp.fetch(`${SENTRY_API}/organizations/${props.getProperty("SENTRY_ORG")}${path}`, {
    headers: { Authorization: `Bearer ${props.getProperty("SENTRY_TOKEN")}` },
    muteHttpExceptions: true,
  });
}

function sentryGet(props: Properties, path: string) {
  const res = sentryFetch(props, path);
  if (res.getResponseCode() !== 200) throw new Error(`Sentry API 응답 ${res.getResponseCode()}`);
  return JSON.parse(res.getContentText("UTF-8")) as unknown;
}

function fetchIssues(props: Properties) {
  const query = encodeURIComponent(issueQuery(props.getProperty("SINCE") ?? new Date().toISOString()));
  const raw = sentryGet(props, `/issues/?project=${props.getProperty("SENTRY_PROJECT_ID")}&sort=new&limit=100&query=${query}`);
  if (!Array.isArray(raw)) throw new Error("Sentry 이슈 목록 응답이 배열이 아니다");
  return raw.map(parseIssue);
}

// 이슈 목록 응답에는 태그가 없어 이슈마다 오류 코드 태그를 따로 읽는다.
// 배포 전 화면이 보낸 이벤트처럼 태그가 없는 이슈는 404가 온다. 이 이슈 하나 때문에 실행 전체가 멈추지 않게 UNKNOWN으로 본다.
// 공개 DSN으로 누구나 이벤트를 보낼 수 있어, 목록에 있는 코드만 Slack에 싣는다.
function fetchIssueCode(props: Properties, issueId: string): ErrorCode {
  const res = sentryFetch(props, `/issues/${issueId}/tags/error_code/`);
  if (res.getResponseCode() === 404) return "UNKNOWN";
  if (res.getResponseCode() !== 200) throw new Error(`Sentry API 응답 ${res.getResponseCode()}`);
  const raw = JSON.parse(res.getContentText("UTF-8")) as { topValues?: { value?: unknown }[] };
  const value = raw.topValues?.[0]?.value;
  return isErrorCode(value) ? value : "UNKNOWN";
}

// 예상된 오류는 warning으로 기록되므로, 최근 1시간 warning 이벤트를 오류 코드별로 센다.
function fetchSpikes(props: Properties) {
  const query = encodeURIComponent("environment:production level:warning has:error_code");
  const raw = sentryGet(
    props,
    `/events/?dataset=errors&field=error_code&field=count()&statsPeriod=1h&project=${props.getProperty("SENTRY_PROJECT_ID")}&query=${query}`,
  ) as { data?: Record<string, unknown>[] };
  return (raw.data ?? []).map((row) => ({ code: String(row.error_code), count: Number(row["count()"]) }));
}

function postToSlack(props: Properties, message: SlackMessage) {
  const res = UrlFetchApp.fetch(props.getProperty("SLACK_WEBHOOK_URL") ?? "", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(message),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error(`Slack Webhook 응답 ${res.getResponseCode()}`);
}
