import type { ProviderId } from "@/lib/auth/providers";
import type { QuizFormat } from "@/lib/db/schema";
import type { QuizTab } from "@/lib/quiz-tab";
import type { RecallSetView } from "@/lib/recall-sets";
import type { ResultChip } from "@/lib/recall-result";
import { entryOf } from "@/lib/recall-flow";
import { studyDay } from "@/lib/study-day";

// 이벤트 이름과 속성은 스프린트 1 이벤트 로그 설계 문서의 P0 표를 따른다. 근거: Linear 4-155.
// 속성은 ID, 개수, 정해진 값만 둔다. 학습자가 쓴 글이 들어갈 자리를 타입에 두지 않는다.
type RecallReason = RecallSetView["items"][number]["reason"];
type SetId = { set_id: string };
type ItemAt = { item_id: string; position: number };

// 단원을 바꾸는 것만으로는 문제를 요청하지 않아, 설계 문서의 unit_change는 두지 않는다. 바뀐 단원은 unit_id로 본다.
export type GenTrigger = "first" | "next" | "related" | "new_set";
export type GenErrorType = "generation_failed" | "server_error" | "network";
export type StudyStatus = "wrong" | "unsure";

export type AnalyticsEvents = {
  landing_view: { source: string; referrer: string };
  login_click: { provider: ProviderId };
  start_view: Record<string, never>;
  start_submit: { days_to_exam: number };
  recall_intro_view: SetId & { item_count: number; asked_count: number; skipped_count: number };
  recall_start_click: SetId;
  recall_later_click: SetId;
  recall_question_view: SetId & ItemAt & { format: QuizFormat; reason: RecallReason };
  recall_question_skip_click: SetId & ItemAt;
  recall_result_view: SetId & RecallResultProps;
  recall_study_click: SetId & ItemAt & { concept_id: string; reason: RecallReason; status: StudyStatus };
  recall_finish_click: SetId & { study_click_count: number };
  quiz_tab_click: { unit_id: string; resumed: boolean; guide_shown: boolean };
  quiz_gen_request: { gen_id: string; trigger: GenTrigger; unit_id: string; position: number };
  quiz_gen_complete: {
    gen_id: string;
    trigger: GenTrigger;
    problem_id: string;
    concept_id: string;
    format: QuizFormat;
    wait_ms: number;
  };
  quiz_gen_fail: { gen_id: string; trigger: GenTrigger; error_type: GenErrorType; wait_ms: number };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

export type CommonProps = { app_version: string; study_day: string };

export function commonProps(appVersion: string, at: Date): CommonProps {
  return { app_version: appVersion, study_day: studyDay(at) };
}

export type UserProps = { source: string; is_test: boolean; exam_date: string | null; signup_day: string };

type LearnerRecord = { source: string; isTest: boolean; examDate?: string | null; createdAt: Date };

export function userProperties({ source, isTest, examDate, createdAt }: LearnerRecord): UserProps {
  return { source, is_test: isTest, exam_date: examDate ?? null, signup_day: studyDay(createdAt) };
}

// 입구 화면이 보여 주는 물어봄, 넘어감과 같은 기준으로 센다.
export function recallIntroProps(items: RecallSetView["items"]) {
  const { rows } = entryOf(items);
  const asked = rows.filter((row) => row.reason === "물어봄").length;
  return { item_count: rows.length, asked_count: asked, skipped_count: rows.length - asked };
}

type RecallResultProps = { correct_count: number; review_count: number };

// 공부하러 가기는 틀렸거나 헷갈린 항목에만 보이므로, 그 두 칩만 status를 가진다.
const STUDY_STATUS: Partial<Record<ResultChip, StudyStatus>> = {
  "틀렸어요": "wrong",
  "맞았지만 헷갈렸어요": "unsure",
};

export function studyStatus(chip: ResultChip): StudyStatus | undefined {
  return STUDY_STATUS[chip];
}

export function recallResultProps(cards: readonly { chip: ResultChip }[]): RecallResultProps {
  const correct = cards.filter(({ chip }) => chip === "맞혔어요" || chip === "맞았지만 헷갈렸어요").length;
  const review = cards.filter(({ chip }) => studyStatus(chip) !== undefined).length;
  return { correct_count: correct, review_count: review };
}

type LoadingTab = Extract<QuizTab, { stage: "loading" }>;

// 문제를 받는 단계로 들어온 까닭이다. 다시 시도는 실패한 요청과 같은 까닭으로 센다.
// 이어 풀던 문제를 이미 풀었으면 다음 번호를, 불러오지 못하면 같은 번호를 새로 받는다.
export function genTrigger(before: QuizTab, loading: LoadingTab, failed?: GenTrigger): GenTrigger {
  if ("questionId" in loading) return "related";
  switch (before.stage) {
    case "failed":
      return failed ?? "first";
    case "problem":
      return "next";
    case "result":
      return "new_set";
    case "resuming":
      return loading.number > before.number ? "next" : "first";
    default:
      return "first";
  }
}

// 응답이 온 실패는 상태 코드, 응답이 오지 않은 실패는 연결 실패와 시간 초과로 나눈다.
export type FetchFailure = number | "network" | "timeout";

export function genErrorType(failure: FetchFailure): GenErrorType {
  if (failure === 502) return "generation_failed";
  return typeof failure === "number" ? "server_error" : "network";
}
