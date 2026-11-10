"use client";

import { Calendar, LoaderCircle } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { submitStart } from "./actions";

export function StartForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(submitStart, null);
  const [examDate, setExamDate] = useState(today);
  const [consented, setConsented] = useState(true);
  const examDateId = useId();
  const ready = examDate !== "" && consented;

  return (
    <form action={formAction}>
      <div className="mb-5 flex flex-col gap-2">
        <label htmlFor={examDateId} className="text-[13px] font-semibold text-ink-2">
          시험 날짜
        </label>
        <span className="date-field">
          <Calendar size={17} aria-hidden className="date-field-ico" />
          <input
            id={examDateId}
            type="date"
            name="examDate"
            required
            value={examDate}
            disabled={pending}
            onChange={(event) => setExamDate(event.target.value)}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker();
              } catch {
                // 칸 어디를 눌러도 달력이 열리게 한다. 지원하지 않는 브라우저는 스스로 연다.
              }
            }}
            className="input tracking-normal"
          />
        </span>
      </div>
      <label className="start-consent">
        <input
          type="checkbox"
          name="consent"
          checked={consented}
          disabled={pending}
          onChange={(event) => setConsented(event.target.checked)}
        />
        학습 기록 저장과 분석에 동의해요
      </label>
      <div className="mt-4 flex flex-col items-center gap-5 [@media(max-height:760px)_and_(min-width:861px)]:gap-4">
        {pending ? (
          <button type="submit" disabled aria-busy="true" className="btn btn-dark btn-lg btn-block tracking-normal disabled:opacity-100">
            <LoaderCircle size={18} aria-hidden className="animate-[spin_0.8s_linear_infinite] motion-reduce:animate-[spin_2s_linear_infinite]" />
            저장하는 중…
          </button>
        ) : (
          <button type="submit" disabled={!ready} className="btn btn-dark btn-lg btn-block tracking-normal">
            시작하기
          </button>
        )}
        {state && !pending && (
          <p
            role="alert"
            className="-mt-1 w-full animate-[notice-in_0.25s_ease-out] rounded-md bg-red-50 px-4 py-3 text-center text-sm leading-normal font-medium text-red"
          >
            {state.notice}
          </p>
        )}
      </div>
    </form>
  );
}
