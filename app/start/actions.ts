"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { trackFromServer } from "@/lib/amplitude-server";
import { getCurrentLearner } from "@/lib/auth";
import { reportAuthError } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import { learner } from "@/lib/db/schema";
import { type ExamDateError, daysToExam, parseExamDate } from "@/lib/exam-date";
import { HOME_PATH, STUDY_PATH } from "@/lib/routes";

export type StartFormState = { notice: string } | null;

const NOTICES: Record<ExamDateError | "consent" | "save_failed", string> = {
  required: "시험 날짜를 골라 주세요.",
  invalid: "시험 날짜를 다시 골라 주세요.",
  past: "오늘 이후 날짜를 골라 주세요.",
  consent: "기록을 저장해야 학습을 이어 갈 수 있어요. 저장에 동의해 주세요.",
  save_failed: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
};

export async function submitStart(_previous: StartFormState, formData: FormData): Promise<StartFormState> {
  const current = await getCurrentLearner();
  if (!current) redirect(HOME_PATH);
  // 저장 동의 시각은 처음 값을 지킨다. 이미 낸 학습자는 아무것도 바꾸지 않고 학습 화면으로 보낸다.
  if (current.consentedAt) redirect(STUDY_PATH);

  const submitted = {
    examDate: String(formData.get("examDate") ?? ""),
    consented: formData.get("consent") === "on",
  };
  const parsed = parseExamDate(submitted.examDate, new Date());
  if (!parsed.ok) return { notice: NOTICES[parsed.error] };
  if (!submitted.consented) return { notice: NOTICES.consent };

  let saved = false;
  try {
    // 두 탭에서 거의 동시에 내도 먼저 저장한 값이 남는다.
    const rows = await getDb()
      .update(learner)
      .set({ examDate: parsed.examDate, consentedAt: new Date() })
      .where(and(eq(learner.id, current.id), isNull(learner.consentedAt)))
      .returning({ id: learner.id });
    saved = rows.length > 0;
  } catch (error) {
    // DB 오류 원본에는 쿼리 값이 담기므로 정리한 메시지만 남긴다.
    reportAuthError(error, "start");
    return { notice: NOTICES.save_failed };
  }
  // 저장은 학습 화면으로 보내는 redirect로 끝나서 브라우저가 저장된 순간을 알 수 없다.
  if (saved) trackFromServer(current.id, "start_submit", { days_to_exam: daysToExam(parsed.examDate, new Date()) });
  redirect(STUDY_PATH);
}
