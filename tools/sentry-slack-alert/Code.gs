// 생성한 파일이라 직접 고치지 않는다. tools/sentry-slack-alert/*.ts를 고치고 npm run alert:build로 다시 만든다.
"use strict";
var SentryAlert = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // tools/sentry-slack-alert/main.ts
  var main_exports = {};
  __export(main_exports, {
    run: () => run,
    setup: () => setup
  });

  // lib/errors/codes.ts
  var ERROR_CODES = [
    "RECORD_SAVE_FAILED",
    "QUESTION_FAILED",
    "QUIZ_PROBLEM_FAILED",
    "QUIZ_ATTEMPT_FAILED",
    "RECALL_SET_FAILED",
    "AUTH_FAILED",
    "START_SAVE_FAILED",
    "LOGIN_CANCELLED",
    "LOGIN_EXPIRED",
    "REQUEST_REJECTED",
    "UNKNOWN"
  ];
  function isErrorCode(value) {
    return ERROR_CODES.includes(value);
  }

  // lib/errors/alert-catalog.ts
  var CATALOG = {
    RECORD_SAVE_FAILED: { summary: "학습 기록을 저장하지 못했어요", feature: "학습셋", expected: false },
    QUESTION_FAILED: { summary: "질문에 답하지 못했어요", feature: "AI 에이전트", expected: false },
    QUIZ_PROBLEM_FAILED: { summary: "퀴즈 문제를 만들지 못했어요", feature: "퀴즈", expected: false },
    QUIZ_ATTEMPT_FAILED: { summary: "퀴즈 풀이를 저장하지 못했어요", feature: "퀴즈", expected: false },
    RECALL_SET_FAILED: { summary: "꺼내 먹기 문제를 생성하지 못했어요", feature: "꺼내 먹기", expected: false },
    AUTH_FAILED: { summary: "로그인 처리 중 오류가 발생했어요", feature: "로그인", expected: false },
    START_SAVE_FAILED: { summary: "시험 날짜와 동의 여부를 저장하지 못했어요", feature: "로그인", expected: false },
    LOGIN_CANCELLED: {
      summary: "학습자가 로그인을 취소했어요",
      feature: "로그인",
      expected: true,
      spikeLabel: "로그인 취소",
      spikePerHour: 20
    },
    LOGIN_EXPIRED: {
      summary: "로그인 요청이 만료됐어요",
      feature: "로그인",
      expected: true,
      spikeLabel: "로그인 요청 만료",
      spikePerHour: 20
    },
    REQUEST_REJECTED: {
      summary: "잘못된 요청을 거절했어요",
      feature: "알 수 없음",
      expected: true,
      spikeLabel: "거절한 요청",
      spikePerHour: 30
    },
    UNKNOWN: { summary: "예상하지 못한 오류가 발생했어요", feature: "알 수 없음", expected: false }
  };
  function alertEntry(code) {
    return isErrorCode(code) ? CATALOG[code] : CATALOG.UNKNOWN;
  }

  // tools/sentry-slack-alert/alert.ts
  var HOUR_MS = 60 * 60 * 1e3;
  var KST_OFFSET_MS = 9 * HOUR_MS;
  function issueQuery(since) {
    return `environment:production issue.category:error level:error firstSeen:>${since}`;
  }
  function field(raw, key) {
    const value = raw[key];
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`Sentry 이슈 응답에 ${key}가 없다`);
    return String(value);
  }
  function parseIssue(raw) {
    if (typeof raw !== "object" || raw === null) throw new Error("Sentry 이슈 응답이 객체가 아니다");
    const record = raw;
    return {
      id: field(record, "id"),
      count: Number(field(record, "count")),
      userCount: Number(field(record, "userCount")),
      firstSeen: field(record, "firstSeen"),
      permalink: field(record, "permalink")
    };
  }
  function koreanTime(iso) {
    const at = new Date(Date.parse(iso) + KST_OFFSET_MS);
    const pad = (n) => String(n).padStart(2, "0");
    return `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
  }
  function escapeSlack(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function message(title, code, rows, url) {
    const blocks = [
      { type: "header", text: { type: "plain_text", text: title } },
      { type: "section", text: { type: "mrkdwn", text: `에러코드 \`${escapeSlack(code)}\`` } },
      {
        type: "section",
        text: { type: "mrkdwn", text: rows.map(([name, value]) => `*${name}*  ${escapeSlack(value)}`).join("\n") }
      }
    ];
    if (url) {
      blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Sentry에서 보기" }, url }] });
    }
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: escapeSlack(code) }] });
    return { text: title, blocks };
  }
  function issueMessage(issue, code) {
    const entry = alertEntry(code);
    return message(
      `🚨 [오류] ${entry.summary}`,
      code,
      [
        ["발생 위치", entry.feature],
        ["겪은 학습자", `${issue.userCount}명`],
        ["발생 횟수", `${issue.count}회`],
        ["최초 발생", koreanTime(issue.firstSeen)]
      ],
      issue.permalink
    );
  }
  function subjectParticle(word) {
    const last = word.charCodeAt(word.length - 1) - 44032;
    return last >= 0 && last <= 11171 && last % 28 !== 0 ? "이" : "가";
  }
  function spikeMessage(code, count, url) {
    const entry = alertEntry(code);
    const title = entry.expected ? `⚠️ [급증] ${entry.spikeLabel}${subjectParticle(entry.spikeLabel)} 1시간에 ${entry.spikePerHour}회를 넘었어요` : `⚠️ [급증] ${entry.summary}`;
    return message(title, code, [["발생 위치", entry.feature], ["최근 1시간 발생 횟수", `${count}회`]], url);
  }
  function shouldAlertSpike(input) {
    const { count, threshold, lastAlertAt, now } = input;
    if (count <= threshold) return false;
    return lastAlertAt === void 0 || now.getTime() - lastAlertAt.getTime() >= HOUR_MS;
  }

  // tools/sentry-slack-alert/main.ts
  var SENTRY_API = "https://us.sentry.io/api/0";
  var MAX_NOTIFIED_IDS = 100;
  function setup() {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty("SINCE")) props.setProperty("SINCE", (/* @__PURE__ */ new Date()).toISOString());
    if (!props.getProperty("NOTIFIED_IDS")) props.setProperty("NOTIFIED_IDS", "[]");
    if (!props.getProperty("SPIKE_ALERTED_AT")) props.setProperty("SPIKE_ALERTED_AT", "{}");
    const hasTrigger = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "run");
    if (!hasTrigger) ScriptApp.newTrigger("run").timeBased().everyMinutes(5).create();
    console.log(`Sentry 조회 성공: SINCE 이후 이슈 ${fetchIssues(props).length}건, 급증 후보 ${fetchSpikes(props).length}건`);
  }
  function run() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e3)) return;
    try {
      const props = PropertiesService.getScriptProperties();
      notifyIssues(props);
      notifySpikes(props);
    } finally {
      lock.releaseLock();
    }
  }
  function notifyIssues(props) {
    const notified = JSON.parse(props.getProperty("NOTIFIED_IDS") || "[]");
    const seen = new Set(notified);
    const fresh = fetchIssues(props).filter((issue) => !seen.has(issue.id)).reverse();
    for (const issue of fresh) {
      postToSlack(props, issueMessage(issue, fetchIssueCode(props, issue.id)));
      notified.push(issue.id);
      props.setProperty("NOTIFIED_IDS", JSON.stringify(notified.slice(-MAX_NOTIFIED_IDS)));
    }
  }
  function notifySpikes(props) {
    const alertedAt = JSON.parse(props.getProperty("SPIKE_ALERTED_AT") || "{}");
    const now = /* @__PURE__ */ new Date();
    for (const { code, count } of fetchSpikes(props)) {
      const entry = alertEntry(code);
      if (!entry.expected) continue;
      const last = alertedAt[code];
      if (!shouldAlertSpike({ count, threshold: entry.spikePerHour, lastAlertAt: last ? new Date(last) : void 0, now })) continue;
      postToSlack(props, spikeMessage(code, count));
      alertedAt[code] = now.toISOString();
      props.setProperty("SPIKE_ALERTED_AT", JSON.stringify(alertedAt));
    }
  }
  function sentryFetch(props, path) {
    return UrlFetchApp.fetch(`${SENTRY_API}/organizations/${props.getProperty("SENTRY_ORG")}${path}`, {
      headers: { Authorization: `Bearer ${props.getProperty("SENTRY_TOKEN")}` },
      muteHttpExceptions: true
    });
  }
  function sentryGet(props, path) {
    const res = sentryFetch(props, path);
    if (res.getResponseCode() !== 200) throw new Error(`Sentry API 응답 ${res.getResponseCode()}`);
    return JSON.parse(res.getContentText("UTF-8"));
  }
  function fetchIssues(props) {
    var _a;
    const query = encodeURIComponent(issueQuery((_a = props.getProperty("SINCE")) != null ? _a : (/* @__PURE__ */ new Date()).toISOString()));
    const raw = sentryGet(props, `/issues/?project=${props.getProperty("SENTRY_PROJECT_ID")}&sort=new&limit=100&query=${query}`);
    if (!Array.isArray(raw)) throw new Error("Sentry 이슈 목록 응답이 배열이 아니다");
    return raw.map(parseIssue);
  }
  function fetchIssueCode(props, issueId) {
    var _a, _b;
    const res = sentryFetch(props, `/issues/${issueId}/tags/error_code/`);
    if (res.getResponseCode() === 404) return "UNKNOWN";
    if (res.getResponseCode() !== 200) throw new Error(`Sentry API 응답 ${res.getResponseCode()}`);
    const raw = JSON.parse(res.getContentText("UTF-8"));
    const value = (_b = (_a = raw.topValues) == null ? void 0 : _a[0]) == null ? void 0 : _b.value;
    return isErrorCode(value) ? value : "UNKNOWN";
  }
  function fetchSpikes(props) {
    var _a;
    const query = encodeURIComponent("environment:production level:warning has:error_code");
    const raw = sentryGet(
      props,
      `/events/?dataset=errors&field=error_code&field=count()&statsPeriod=1h&project=${props.getProperty("SENTRY_PROJECT_ID")}&query=${query}`
    );
    return ((_a = raw.data) != null ? _a : []).map((row) => ({ code: String(row.error_code), count: Number(row["count()"]) }));
  }
  function postToSlack(props, message2) {
    var _a;
    const res = UrlFetchApp.fetch((_a = props.getProperty("SLACK_WEBHOOK_URL")) != null ? _a : "", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(message2),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error(`Slack Webhook 응답 ${res.getResponseCode()}`);
  }
  return __toCommonJS(main_exports);
})();
function setup() { SentryAlert.setup(); }
function run() { SentryAlert.run(); }
