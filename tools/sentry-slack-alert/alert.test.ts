import { describe, expect, it } from "vitest";
import { issueMessage, issueQuery, parseIssue, type SlackMessage, shouldAlertSpike, spikeMessage } from "./alert";

// Slack에 보이는 글자를 위에서 아래 순서로 한 줄씩 꺼낸다. 굵게 표시와 줄 맞춤 공백은 지운다.
function visibleLines(message: SlackMessage) {
  return message.blocks
    .flatMap((block) => {
      if (block.type === "actions") return block.elements.map((button) => button.text.text);
      if (block.type === "context") return block.elements.map((element) => element.text);
      return [block.text.text];
    })
    .flatMap((text) => text.split("\n"))
    .map((line) => line.replace(/[*`]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const rawIssue = {
  id: "7001",
  shortId: "4TH-SILO-K",
  title: "Error: 재귀 함수는 왜 스택이 넘치나요? fake.learner@example.com",
  culprit: "POST /api/section-views",
  level: "error",
  count: "58",
  userCount: 3,
  firstSeen: "2026-11-05T15:11:36Z",
  permalink: "https://eb5a968646b3.sentry.io/issues/7001/",
  metadata: { type: "Error", value: "재귀 함수는 왜 스택이 넘치나요? fake.learner@example.com" },
};

describe("건별 알림", () => {
  it("TC-328 알림 대상 이슈는 production 환경의 error 이슈로만 조회해요", () => {
    const query = issueQuery("2026-11-12T00:00:00.000Z");

    expect(query).toContain("environment:production");
    expect(query).toContain("issue.category:error");
    expect(query).toContain("level:error");
    expect(query).toContain("firstSeen:>2026-11-12T00:00:00.000Z");
  });

  it("TC-329 운영 오류 이슈를 한국어 요약 제목과 발생 위치, 겪은 학습자, 발생 횟수, 최초 발생으로 바꿔요", () => {
    const message = issueMessage(parseIssue(rawIssue), "RECORD_SAVE_FAILED");
    const lines = visibleLines(message);

    expect(lines[0]).toBe("🚨 [오류] 학습 기록을 저장하지 못했어요");
    expect(lines.filter((line) => /^(발생 위치|겪은 학습자|발생 횟수|최초 발생) /.test(line))).toEqual([
      "발생 위치 학습셋",
      "겪은 학습자 3명",
      "발생 횟수 58회",
      "최초 발생 11월 6일 00:11",
    ]);
    const buttons = message.blocks.flatMap((block) => (block.type === "actions" ? block.elements : []));
    expect(buttons).toEqual([
      expect.objectContaining({ text: expect.objectContaining({ text: "Sentry에서 보기" }), url: rawIssue.permalink }),
    ]);
    expect(lines.at(-1)).toBe("RECORD_SAVE_FAILED");
    expect(message.blocks.at(-1)?.type).toBe("context");
    expect(JSON.stringify(message)).not.toContain("4TH-SILO-K");

    const unknown = visibleLines(issueMessage(parseIssue(rawIssue), "UNKNOWN"));
    expect(unknown[0]).toBe("🚨 [오류] 예상하지 못한 오류가 발생했어요");
    expect(unknown).toContain("발생 위치 알 수 없음");
  });

  it("TC-330 알림 메시지에 에러코드를 보여 주고 이슈 제목과 오류 메시지 원문은 담지 않아요", () => {
    const message = issueMessage(parseIssue(rawIssue), "RECORD_SAVE_FAILED");

    expect(visibleLines(message)[1]).toBe("에러코드 RECORD_SAVE_FAILED");
    const sent = JSON.stringify(message);
    expect(sent).not.toContain("재귀 함수는 왜 스택이 넘치나요?");
    expect(sent).not.toContain("fake.learner@example.com");
  });
});

describe("급증 알림", () => {
  it("TC-331 예상된 오류가 1시간 급증 기준을 넘으면 한 번 알리고 같은 코드는 1시간 동안 다시 알리지 않아요", () => {
    const alertedAt = new Date("2026-11-12T03:00:00Z");
    const minutesAfter = (minutes: number) => new Date(alertedAt.getTime() + minutes * 60_000);

    expect(shouldAlertSpike({ count: 20, threshold: 20, lastAlertAt: undefined, now: alertedAt })).toBe(false);
    expect(shouldAlertSpike({ count: 21, threshold: 20, lastAlertAt: undefined, now: alertedAt })).toBe(true);
    expect(visibleLines(spikeMessage("LOGIN_CANCELLED", 21))[0]).toBe("⚠️ [급증] 로그인 취소가 1시간에 20회를 넘었어요");
    expect(shouldAlertSpike({ count: 25, threshold: 20, lastAlertAt: alertedAt, now: minutesAfter(30) })).toBe(false);
    expect(shouldAlertSpike({ count: 25, threshold: 20, lastAlertAt: alertedAt, now: minutesAfter(61) })).toBe(true);
  });
});
