import "server-only";
import { type ErrorCode, isErrorCode } from "./codes";

// PO가 Slack 알림에서 읽는 문구라 브라우저 번들에 넣지 않는다.
// 발생 위치는 PO가 알림만 보고 어느 화면인지 알 수 있는 기능 이름으로 쓴다.
type Feature = "로그인" | "학습셋" | "AI 에이전트" | "퀴즈" | "꺼내 먹기" | "알 수 없음";

export type AlertEntry = { summary: string; feature: Feature } & (
  | { expected: false }
  // 예상된 오류는 건별로 알리지 않고, 최근 1시간 발생 횟수가 spikePerHour를 넘을 때만 spikeLabel로 알린다.
  | { expected: true; spikeLabel: string; spikePerHour: number }
);

const CATALOG: Record<ErrorCode, AlertEntry> = {
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
    spikePerHour: 20,
  },
  LOGIN_EXPIRED: {
    summary: "로그인 요청이 만료됐어요",
    feature: "로그인",
    expected: true,
    spikeLabel: "로그인 요청 만료",
    spikePerHour: 20,
  },
  REQUEST_REJECTED: {
    summary: "잘못된 요청을 거절했어요",
    feature: "알 수 없음",
    expected: true,
    spikeLabel: "거절한 요청",
    spikePerHour: 30,
  },
  UNKNOWN: { summary: "예상하지 못한 오류가 발생했어요", feature: "알 수 없음", expected: false },
};

export function alertEntry(code: string): AlertEntry {
  return isErrorCode(code) ? CATALOG[code] : CATALOG.UNKNOWN;
}
