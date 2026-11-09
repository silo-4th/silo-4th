"use client";

import { useActionState, useId } from "react";
import { submitStart } from "./actions";

export function StartForm() {
  const [state, formAction, pending] = useActionState(submitStart, null);
  const examDateId = useId();

  return (
    // 폼은 제출이 끝나면 처음 값으로 돌아간다. 낸 값을 처음 값으로 두어 안내를 본 뒤에도 입력이 남는다.
    <form action={formAction} className="mt-7 flex flex-col">
      <div className="mb-3.5 flex flex-col gap-1.5">
        <label htmlFor={examDateId} className="text-[13px] font-semibold text-ink-2">
          시험 날짜
        </label>
        <input
          id={examDateId}
          type="date"
          name="examDate"
          required
          defaultValue={state?.examDate}
          className="input"
        />
      </div>
      <label className="flex items-start gap-2.5 rounded-md border border-line p-3.5 text-sm text-ink-2 transition-colors has-checked:border-green has-checked:bg-green-25">
        <input
          type="checkbox"
          name="consent"
          defaultChecked={state?.consented}
          className="mt-0.5 size-4 flex-none accent-green"
        />
        공부하며 남긴 질문과 확인 결과를 저장하고 분석하는 데 동의해요
      </label>
      {state && (
        <p role="alert" className="mt-3 text-sm text-red">
          {state.notice}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary btn-lg btn-block mt-7">
        시작하기
      </button>
    </form>
  );
}
