// 알림 판단과 메시지 변환. Apps Script API를 쓰지 않아 Vitest로 확인한다. 설계: _docs/wiki/prd/sentry-slack-alert.md
import { alertEntry } from "@/lib/errors/alert-catalog";

export type Issue = {
  id: string;
  count: number;
  userCount: number;
  firstSeen: string;
  permalink: string;
};

type PlainText = { type: "plain_text"; text: string };
type Markdown = { type: "mrkdwn"; text: string };

export type SlackBlock =
  | { type: "header"; text: PlainText }
  | { type: "section"; text: Markdown }
  | { type: "actions"; elements: { type: "button"; text: PlainText; url: string }[] }
  | { type: "context"; elements: Markdown[] };

export type SlackMessage = { text: string; blocks: SlackBlock[] };

const HOUR_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;

// 성능 이슈, 로컬과 preview 오류, warning으로 기록한 예상된 오류는 건별 알림에서 뺀다.
export function issueQuery(since: string) {
  return `environment:production issue.category:error level:error firstSeen:>${since}`;
}

function field(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`Sentry 이슈 응답에 ${key}가 없다`);
  return String(value);
}

// 질문 원문이 섞일 수 있는 title과 metadata는 읽지 않는다. 허용한 필드만 꺼낸다.
export function parseIssue(raw: unknown): Issue {
  if (typeof raw !== "object" || raw === null) throw new Error("Sentry 이슈 응답이 객체가 아니다");
  const record = raw as Record<string, unknown>;
  return {
    id: field(record, "id"),
    count: Number(field(record, "count")),
    userCount: Number(field(record, "userCount")),
    firstSeen: field(record, "firstSeen"),
    permalink: field(record, "permalink"),
  };
}

// Apps Script의 시간대와 관계없이 한국 시간으로 쓴다. 한국은 서머타임이 없다.
function koreanTime(iso: string) {
  const at = new Date(Date.parse(iso) + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

function escapeSlack(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function message(title: string, code: string, rows: [string, string][], url?: string): SlackMessage {
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    { type: "section", text: { type: "mrkdwn", text: `에러코드 \`${escapeSlack(code)}\`` } },
    {
      type: "section",
      text: { type: "mrkdwn", text: rows.map(([name, value]) => `*${name}*  ${escapeSlack(value)}`).join("\n") },
    },
  ];
  if (url) {
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Sentry에서 보기" }, url }] });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: escapeSlack(code) }] });
  return { text: title, blocks };
}

export function issueMessage(issue: Issue, code: string): SlackMessage {
  const entry = alertEntry(code);
  return message(
    `🚨 [오류] ${entry.summary}`,
    code,
    [
      ["발생 위치", entry.feature],
      ["겪은 학습자", `${issue.userCount}명`],
      ["발생 횟수", `${issue.count}회`],
      ["최초 발생", koreanTime(issue.firstSeen)],
    ],
    issue.permalink,
  );
}

// 받침이 있으면 "이", 없으면 "가"를 붙인다.
function subjectParticle(word: string) {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  return last >= 0 && last <= 11171 && last % 28 !== 0 ? "이" : "가";
}

export function spikeMessage(code: string, count: number, url?: string): SlackMessage {
  const entry = alertEntry(code);
  const title = entry.expected
    ? `⚠️ [급증] ${entry.spikeLabel}${subjectParticle(entry.spikeLabel)} 1시간에 ${entry.spikePerHour}회를 넘었어요`
    : `⚠️ [급증] ${entry.summary}`;
  return message(title, code, [["발생 위치", entry.feature], ["최근 1시간 발생 횟수", `${count}회`]], url);
}

export function shouldAlertSpike(input: { count: number; threshold: number; lastAlertAt: Date | undefined; now: Date }) {
  const { count, threshold, lastAlertAt, now } = input;
  if (count <= threshold) return false;
  return lastAlertAt === undefined || now.getTime() - lastAlertAt.getTime() >= HOUR_MS;
}
