"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { resultView, sendAttempt, shownStem } from "@/lib/quiz-card";
import {
  MAX_ANSWER_LENGTH,
  type ProblemStage,
  type QuizFlow,
  type QuizFlowEvent,
  advanceQuizFlow,
  canSubmit,
  startQuizFlow,
} from "@/lib/quiz-flow";
import type { ProblemView } from "@/lib/quiz-problems";

type Confidence = NonNullable<AttemptInput["confidence"]>;

const CONFIDENCES: { value: Confidence; label: string }[] = [
  { value: "sure", label: "확실해요" },
  { value: "unsure", label: "애매해요" },
  { value: "guess", label: "찍었어요" },
];

const CONFIDENCE_QUESTION: Record<ProblemView["format"], string> = {
  mcq: "고른 답, 얼마나 확실해요?",
  blank: "쓴 답, 얼마나 확실해요?",
  free: "쓴 설명, 얼마나 확실해요?",
};

const LETTERS = ["A", "B", "C", "D"];

// 채점 중과 실패는 화면에도 보이고, 나머지 단계의 알림은 스크린리더만 읽는다.
const STATUS_CLASS: Partial<Record<QuizFlow["stage"], string>> = {
  grading: "mt-3.5 text-[13px] text-gray",
  "grading-failed": "mt-3.5 text-[13px] font-bold text-red",
};

function statusOf(flow: QuizFlow): string {
  if (flow.stage === "grading") return "채점하고 있어요";
  if (flow.stage === "grading-failed") return "채점 결과를 받지 못했어요";
  if (flow.stage !== "explanation") return "";
  const { verdict } = resultView(flow.submitted, flow.result);
  return verdict ? `채점 결과가 나왔어요. ${verdict}` : "채점 결과가 나왔어요";
}

// 누른 버튼이 사라져 자리를 잃은 키보드와 스크린리더 사용자를 위해, 결과나 실패 단계가 나타나면 포커스를 그쪽으로 옮긴다.
// 채점을 기다리는 동안 카드 밖으로 옮겨 간 포커스는 빼앗지 않는다. 결과와 실패는 상태 알림으로도 전한다.
// 참조가 바뀌지 않는 함수라서 다시 그려도 포커스를 다시 가져가지 않는다.
function focusOnMount(element: HTMLElement | null) {
  if (!element) return;
  const focused = element.ownerDocument.activeElement;
  const stayed = !focused || focused === element.ownerDocument.body || element.closest("[data-quiz-card]")?.contains(focused);
  if (stayed) element.focus();
}

// 다음으로 넘어갈 때 부르는 쪽에 낸 답을 넘긴다. 채점을 받지 못한 채 넘어가면 result가 없다.
export type Solved = { submitted: AttemptInput; result?: AttemptResult };

type QuizCardProps = {
  problem: ProblemView;
  onNext: (solved: Solved) => void;
  // 꺼내 먹기 문항을 풀 때만 넘긴다. 풀이를 그 문항의 풀이로 저장한다.
  recallItemId?: string;
  onSkip?: () => void;
  // 꺼내 먹기의 마지막 문항처럼 다음 버튼이 다음 문제로 가지 않을 때 넘긴다.
  nextLabel?: string;
};

// 퀴즈 탭과 꺼내 먹기가 함께 쓴다. 문제가 바뀌면 부르는 쪽이 key를 바꿔 새 풀이로 시작한다.
export function QuizCard({ problem, onNext, recallItemId, onSkip, nextLabel }: QuizCardProps) {
  const [flow, setFlow] = useState<QuizFlow>(() => startQuizFlow(problem));
  const dispatch = (...events: QuizFlowEvent[]) => setFlow((current) => events.reduce(advanceQuizFlow, current));

  const grading = flow.stage === "grading" ? flow : undefined;
  useEffect(() => {
    if (!grading) return;
    let active = true;
    void sendAttempt(recallItemId ? { ...grading.request, recallItemId } : grading.request).then((result) => {
      if (!active) return;
      setFlow((current) => advanceQuizFlow(current, result ? { type: "graded", result } : { type: "grading-failed" }));
    });
    return () => {
      active = false;
    };
  }, [grading, recallItemId]);

  function next() {
    if (flow.stage === "explanation") onNext({ submitted: flow.submitted, result: flow.result });
    else if (flow.stage === "grading-failed") onNext({ submitted: flow.request });
    else return;
    dispatch({ type: "next" });
  }

  return (
    <section aria-label="퀴즈" data-quiz-card className="flex flex-col bg-white text-ink">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-5.5 items-center rounded bg-line-2 px-2 text-xs font-semibold text-ink-2">
          {problem.conceptTitle}
        </span>
        {flow.stage === "problem" && !flow.hintUsed && (
          <button
            type="button"
            onClick={() => dispatch({ type: "show-hint" })}
            className="ml-auto h-5.5 text-[12.5px] font-medium text-gray hover:text-ink-2"
          >
            힌트
          </button>
        )}
      </div>
      <div className="unit-body text-[17px] leading-normal font-bold [&_pre]:text-[13px] [&_pre]:font-normal [&>:last-child]:mb-0">
        <Markdown remarkPlugins={[remarkGfm]}>{problem.format === "blank" ? shownStem(problem.stem) : problem.stem}</Markdown>
      </div>
      {flow.stage === "problem" && flow.hintUsed && (
        <p className="mt-2.5 rounded-md bg-amber-50 px-3 py-2.5 text-[13px] text-[#7a4b00]">
          <b>힌트</b> {problem.hint}
        </p>
      )}
      {flow.stage === "problem" && <Answering problem={problem} flow={flow} dispatch={dispatch} />}
      {flow.stage === "problem" && onSkip && (
        <button type="button" onClick={onSkip} className="mt-4 self-center text-[13px] font-medium text-gray hover:text-ink-2">
          이 문제 건너뛰기
        </button>
      )}
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className={STATUS_CLASS[flow.stage] ?? "sr-only"}>
        {statusOf(flow)}
      </p>
      {flow.stage === "grading-failed" && (
        <div className="mt-3 flex gap-2">
          <button ref={focusOnMount} type="button" onClick={() => dispatch({ type: "retry" })} className={BUTTON}>
            다시 시도
          </button>
          <button type="button" onClick={next} className={BUTTON}>
            {nextLabel ?? "다음 문제로"}
          </button>
        </div>
      )}
      {flow.stage === "explanation" && (
        <Explanation
          format={problem.format}
          {...resultView(flow.submitted, flow.result)}
          explanation={flow.result.explanation}
          nextLabel={nextLabel ?? "다음 문제"}
          onNext={next}
        />
      )}
    </section>
  );
}

const BUTTON = "h-9 rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-bg";

function Answering({
  problem,
  flow,
  dispatch,
}: {
  problem: ProblemView;
  flow: ProblemStage;
  dispatch: (...events: QuizFlowEvent[]) => void;
}) {
  const ready = canSubmit(flow);
  return (
    <>
      {problem.format === "mcq" && (
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">보기</legend>
          {(problem.choices ?? []).map((choice, index) => {
            const picked = flow.chosenIndex === index;
            return (
              <label
                key={index}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3.5 py-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-gray-3 has-checked:border-ink has-focus-visible:outline-2 has-focus-visible:outline-green-600"
              >
                <input
                  type="radio"
                  name={`choice-${problem.id}`}
                  checked={picked}
                  onChange={() => dispatch({ type: "choose", index })}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={`grid size-5.5 flex-none place-items-center rounded-full text-[11px] font-bold ${picked ? "bg-ink text-white" : "bg-line-2 text-gray"}`}
                >
                  {LETTERS[index]}
                </span>
                <span>{choice}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      {problem.format === "blank" && (
        <input
          aria-label="빈칸에 들어갈 말"
          placeholder="빈칸에 들어갈 말"
          maxLength={MAX_ANSWER_LENGTH}
          value={flow.text}
          onChange={(event) => dispatch({ type: "write", text: event.target.value })}
          className="mt-3 h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] focus:border-green-600 focus:outline-none"
        />
      )}
      {problem.format === "free" && (
        <>
          <textarea
            aria-label="설명"
            placeholder="핵심 개념을 넣어 내 말로 설명해 보세요"
            maxLength={MAX_ANSWER_LENGTH}
            value={flow.text}
            onChange={(event) => dispatch({ type: "write", text: event.target.value })}
            className="mt-3 block h-23 w-full resize-none overflow-y-auto rounded-md border border-line bg-white px-3.5 py-3 text-sm leading-relaxed focus:border-green-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => dispatch({ type: "dont-know" })}
            className="mt-2 self-start text-[13px] font-medium text-gray hover:text-ink-2"
          >
            잘 모르겠어요
          </button>
        </>
      )}
      {/* 시안처럼 확신도 버튼이 답 내기를 겸한다. */}
      <div
        role="group"
        aria-label="확신도"
        className={`mt-3.5 flex flex-wrap items-center gap-1.5 gap-y-2 transition-opacity ${ready ? "" : "opacity-40"}`}
      >
        <span className="basis-full text-[13px] font-bold">{CONFIDENCE_QUESTION[problem.format]}</span>
        {CONFIDENCES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            disabled={!ready}
            onClick={() => dispatch({ type: "submit" }, { type: "pick-confidence", confidence: value })}
            className="h-7.5 rounded-full border border-line bg-white px-3 text-[13px] font-semibold text-ink-2 enabled:hover:border-gray-3"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function Explanation({
  format,
  verdict,
  correctAnswers,
  myAnswer,
  explanation,
  nextLabel,
  onNext,
}: ReturnType<typeof resultView> & {
  format: ProblemView["format"];
  explanation: string;
  nextLabel: string;
  onNext: () => void;
}) {
  const right = verdict === "맞았어요";
  return (
    <div ref={focusOnMount} tabIndex={-1} aria-label="채점 결과와 해설" role="region" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-600">
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <div
          className={`rounded-lg border px-3.5 py-3 ${verdict === null ? "border-line" : right ? "border-green bg-green-25" : "border-red bg-red-50"}`}
        >
          <dt className="text-xs font-semibold text-gray">내 답</dt>
          <dd className="mt-1 whitespace-pre-wrap">{myAnswer}</dd>
        </div>
        <div className="rounded-lg border border-green bg-green-25 px-3.5 py-3">
          <dt className="text-xs font-semibold text-gray">{format === "free" ? "모범 답안" : "정답"}</dt>
          <dd className="mt-1 whitespace-pre-wrap">{correctAnswers.join(", ")}</dd>
        </div>
      </dl>
      <div className="mt-2.5 rounded-md bg-bg px-4 py-3.5 text-[13px] text-ink-2">
        {verdict && (
          <p className={`mb-1.5 text-[15px] font-bold ${right ? "text-green-600" : "text-red"}`}>
            <span aria-hidden>{right ? "✓ " : "✕ "}</span>
            {verdict}
          </p>
        )}
        <div className="unit-body">
          <Markdown remarkPlugins={[remarkGfm]}>{explanation}</Markdown>
        </div>
      </div>
      <button type="button" onClick={onNext} className="mt-6 h-11 w-full rounded-md bg-ink text-[15px] font-semibold text-white hover:bg-black">
        {nextLabel}
      </button>
    </div>
  );
}
