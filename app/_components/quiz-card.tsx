"use client";

import { Check, Lightbulb, X } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";
import { type Mark, type Solved, choiceMarks, fillLines, resultView, sendAttempt, shownStem } from "@/lib/quiz-card";
import {
  MAX_ANSWER_LENGTH,
  type ProblemStage,
  type QuizFlow,
  type QuizFlowEvent,
  advanceQuizFlow,
  canCheck,
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

type QuizCardProps = {
  problem: ProblemView;
  onNext: (solved: Solved) => void;
  // 묶음의 마지막 문제처럼 다음 버튼이 다음 문제로 가지 않을 때 넘긴다.
  nextLabel?: string;
  // 퀴즈 탭이 진행 게이지를 채우고 묶음 결과에 칩을 기억하려고 넘긴다.
  onGraded?: (solved: Solved) => void;
  // 퀴즈 탭처럼 p-5 스크롤 영역 안에 둘 때, 내용이 넘치면 아래 버튼을 그 영역 아래에 붙인다.
  pinNext?: boolean;
};

// 퀴즈 탭의 문제 카드다. 꺼내 먹기는 시안이 달라 recall-problem.tsx를 쓴다. 문제가 바뀌면 부르는 쪽이 key를 바꿔 새 풀이로 시작한다.
export function QuizCard({ problem, onNext, nextLabel, onGraded, pinNext = false }: QuizCardProps) {
  const [flow, setFlow] = useState<QuizFlow>(() => startQuizFlow(problem));
  const dispatch = (...events: QuizFlowEvent[]) => setFlow((current) => events.reduce(advanceQuizFlow, current));

  // 부르는 쪽이 매번 새 함수를 넘겨도 채점 요청을 다시 보내지 않게 효과의 의존성에서 뺀다.
  const graded = useEffectEvent((solved: Solved) => onGraded?.(solved));
  const grading = flow.stage === "grading" ? flow : undefined;
  useEffect(() => {
    if (!grading) return;
    let active = true;
    void sendAttempt(grading.request).then((result) => {
      if (!active) return;
      setFlow((current) => advanceQuizFlow(current, result ? { type: "graded", result } : { type: "grading-failed" }));
      if (result) graded({ submitted: grading.request, result });
    });
    return () => {
      active = false;
    };
  }, [grading]);

  function next() {
    if (flow.stage === "explanation") onNext({ submitted: flow.submitted, result: flow.result });
    else if (flow.stage === "grading-failed") onNext({ submitted: flow.request });
    else return;
    dispatch({ type: "next" });
  }

  return (
    <section aria-label="퀴즈" data-quiz-card className="flex flex-1 flex-col bg-white text-ink">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-5.5 items-center rounded bg-line-2 px-2 text-xs font-semibold text-ink-2">
          {problem.conceptTitle}
        </span>
        {flow.stage === "problem" && !flow.hintUsed && (
          <button
            type="button"
            onClick={() => dispatch({ type: "show-hint" })}
            className="ml-auto inline-flex h-5.5 items-center gap-1 text-[12.5px] font-medium text-gray hover:text-ink-2"
          >
            <Lightbulb size={13} aria-hidden />
            힌트
          </button>
        )}
      </div>
      <div className="unit-body text-[17px] leading-normal font-bold [&_pre]:text-[13px] [&_pre]:font-normal [&>:last-child]:mb-0">
        <Markdown remarkPlugins={[remarkGfm]}>{problem.format === "blank" ? shownStem(problem.stem) : problem.stem}</Markdown>
      </div>
      {flow.stage === "problem" && flow.hintUsed && (
        <p className="mt-2.5 flex gap-1 rounded-md bg-amber-50 px-3 py-2.5 text-[13px] text-[#7a4b00]">
          <Lightbulb size={15} aria-hidden className="mt-px flex-none" />
          <span>
            <b className="mr-2">힌트</b>
            {problem.hint}
          </span>
        </p>
      )}
      {flow.stage === "problem" && <Answering problem={problem} flow={flow} dispatch={dispatch} />}
      {flow.stage === "problem" && (
        <CardAction pinned={pinNext}>
          <button
            type="button"
            disabled={!canCheck(flow)}
            onClick={() => dispatch({ type: "check" })}
            className="btn btn-block btn-dark h-11 text-[15px] disabled:opacity-35"
          >
            정답 확인
          </button>
        </CardAction>
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
          problem={problem}
          submitted={flow.submitted}
          result={flow.result}
          nextLabel={nextLabel ?? "다음 문제"}
          pinNext={pinNext}
          onNext={next}
        />
      )}
    </section>
  );
}

const BUTTON = "h-9 rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-bg";

// 채점 전 보기와 채점 뒤 보기가 같은 모양이라 테두리와 동그라미 색만 바꾼다.
const OPTION = "flex w-full items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.03)]";
const MARKED: Record<Mark, { row: string; key: string }> = {
  right: { row: "border-green bg-green-25", key: "bg-green text-white" },
  wrong: { row: "border-red bg-red-50", key: "bg-red text-white" },
  dim: { row: "border-line bg-white text-gray-3", key: "bg-line-2 text-gray" },
};

function OptionKey({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span aria-hidden className={`grid size-5.5 flex-none place-items-center rounded-full text-[11px] font-bold ${className}`}>
      {children}
    </span>
  );
}

function MarkIcon({ mark }: { mark: Exclude<Mark, "dim"> }) {
  return mark === "right" ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />;
}

function Answering({
  problem,
  flow,
  dispatch,
}: {
  problem: ProblemView;
  flow: ProblemStage;
  dispatch: (...events: QuizFlowEvent[]) => void;
}) {
  const answered = canSubmit(flow);
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
                className={`${OPTION} cursor-pointer border-line bg-white hover:border-gray-3 has-checked:border-ink has-focus-visible:outline-2 has-focus-visible:outline-green-600`}
              >
                <input
                  type="radio"
                  name={`choice-${problem.id}`}
                  checked={picked}
                  onChange={() => dispatch({ type: "choose", index })}
                  className="sr-only"
                />
                <OptionKey className={picked ? "bg-ink text-white" : "bg-line-2 text-gray"}>{LETTERS[index]}</OptionKey>
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
      {/* 확신도는 고르기만 하고, 채점은 정답 확인 버튼이 보낸다. 답이 생기기 전에는 흐리게 두고 누를 수 없다. */}
      <div
        role="group"
        aria-label="확신도"
        className={`mt-3.5 flex flex-wrap items-center gap-1.5 gap-y-2 transition-opacity ${answered ? "" : "opacity-40"}`}
      >
        <span className="basis-full text-[13px] font-bold">{CONFIDENCE_QUESTION[problem.format]}</span>
        {CONFIDENCES.map(({ value, label }) => {
          const on = flow.confidence === value;
          return (
            <button
              key={value}
              type="button"
              disabled={!answered}
              aria-pressed={on}
              onClick={() => dispatch({ type: "pick-confidence", confidence: value })}
              className={`h-7.5 rounded-full border bg-white px-3 text-[13px] transition-colors ${on ? "border-ink font-bold text-ink shadow-[inset_0_0_0_0.5px_var(--color-ink)]" : "border-line font-semibold text-ink-2 enabled:hover:border-gray-3"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}

// 정답 확인과 다음 문제 버튼 자리다. 내용 바로 아래에 두고, 내용이 넘쳐 스크롤되면 스크롤 영역 아래에 붙여 늘 보이게 한다.
function CardAction({ pinned, children }: { pinned: boolean; children: ReactNode }) {
  return <div className={pinned ? "sticky -bottom-5 z-2 mt-1 -mb-5 bg-white pt-3 pb-5" : "mt-6"}>{children}</div>;
}

// 객관식은 보기 목록을, 빈칸은 내 답 줄을 그대로 두고 맞고 틀림을 표시한다. 서술형은 내 답과 모범 답안을 나란히 둔다.
function GradedAnswer({ problem, submitted, result }: { problem: ProblemView; submitted: AttemptInput; result: AttemptResult }) {
  if (problem.format === "mcq") {
    const marks = choiceMarks(submitted, result);
    return (
      <ul aria-label="보기" className="mt-3 flex flex-col gap-2">
        {(problem.choices ?? []).map((choice, index) => {
          const mark = marks[index] ?? "dim";
          const mine = submitted.chosenIndex === index;
          return (
            <li key={index} className={`${OPTION} ${MARKED[mark].row}`}>
              <OptionKey className={MARKED[mark].key}>{mark === "dim" ? LETTERS[index] : <MarkIcon mark={mark} />}</OptionKey>
              <span>{choice}</span>
              {(mark === "right" || mine) && (
                <span className="sr-only">{mark === "right" ? (mine ? "정답, 내 답" : "정답") : "내 답"}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  if (problem.format === "blank") {
    return (
      <dl className="mt-3 flex flex-col gap-2">
        {fillLines(submitted, result).map(({ label, text, mark }) => (
          <div key={label} className={`${OPTION} ${MARKED[mark].row}`}>
            <dt className="sr-only">{label}</dt>
            <OptionKey className={MARKED[mark].key}>
              <MarkIcon mark={mark} />
            </OptionKey>
            <dd className="text-[15px] break-words whitespace-pre-wrap">{text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const { verdict, correctAnswers, myAnswer } = resultView(submitted, result);
  return (
    <dl className="mt-3 flex flex-col gap-2 text-sm">
      <div className={`rounded-lg border px-3.5 py-3 ${verdict === null ? "border-line" : verdict === "맞았어요" ? "border-green bg-green-25" : "border-red bg-red-50"}`}>
        <dt className="text-xs font-semibold text-gray">내 답</dt>
        <dd className="mt-1 whitespace-pre-wrap">{myAnswer}</dd>
      </div>
      <div className="rounded-lg border border-green bg-green-25 px-3.5 py-3">
        <dt className="text-xs font-semibold text-gray">모범 답안</dt>
        <dd className="mt-1 whitespace-pre-wrap">{correctAnswers.join(", ")}</dd>
      </div>
    </dl>
  );
}

function Explanation({
  problem,
  submitted,
  result,
  nextLabel,
  pinNext,
  onNext,
}: {
  problem: ProblemView;
  submitted: AttemptInput;
  result: AttemptResult;
  nextLabel: string;
  pinNext: boolean;
  onNext: () => void;
}) {
  const { verdict } = resultView(submitted, result);
  const right = verdict === "맞았어요";
  return (
    <div ref={focusOnMount} tabIndex={-1} aria-label="채점 결과와 해설" role="region" className="flex flex-col rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-600">
      <GradedAnswer problem={problem} submitted={submitted} result={result} />
      <div className="mt-2.5 rounded-md bg-bg px-4 py-3.5 text-[13px] text-ink-2">
        {verdict && (
          <p className={`mb-1.5 inline-flex items-center gap-1 text-[15px] font-bold ${right ? "text-green-600" : "text-red"}`}>
            {right ? <Check size={18} strokeWidth={3} aria-hidden /> : <X size={18} strokeWidth={3} aria-hidden />}
            {verdict}
          </p>
        )}
        <div className="unit-body">
          <Markdown remarkPlugins={[remarkGfm]}>{result.explanation}</Markdown>
        </div>
      </div>
      <CardAction pinned={pinNext}>
        <button type="button" onClick={onNext} className="btn btn-block btn-dark h-11 text-[15px]">
          {nextLabel}
        </button>
      </CardAction>
    </div>
  );
}
