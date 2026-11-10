"use client";

import { LoaderCircle, RotateCw } from "lucide-react";
import { type ComponentProps, useEffect, useEffectEvent, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttemptInput } from "@/lib/quiz-attempts";
import { type Solved, sendAttempt, shownStem } from "@/lib/quiz-card";
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
import type { RecallSetView } from "@/lib/recall-sets";

type RecallItemView = RecallSetView["items"][number];
type Confidence = NonNullable<AttemptInput["confidence"]>;

const CONFIDENCES: { value: Confidence; label: string }[] = [
  { value: "sure", label: "확실해요" },
  { value: "unsure", label: "애매해요" },
  { value: "guess", label: "찍었어요" },
];

const LETTERS = ["A", "B", "C", "D"];

// 시안처럼 SQL 문을 그대로 쓴 보기는 고정폭 글꼴로 조금 작게 그린다.
export function sqlClass(text: string): string {
  return text.includes("SELECT") ? "mono text-[12.5px]" : "";
}

// 빈칸 밑줄 네 개를 인라인 코드 표시로 바꿔 두고, 마크다운이 그 코드를 그릴 때 시안의 빈칸 선으로 바꾼다.
// 코드 블록과 인라인 코드 안에서는 백틱을 넣을 수 없어 퀴즈 탭처럼 전각 밑줄로 보여 준다.
const BLANK_MARK = "⁣빈칸⁣";

function markBlanks(stem: string): string {
  return stem
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 0 ? part.replaceAll("____", `\`${BLANK_MARK}\``) : shownStem(part)))
    .join("");
}

function BlankOrCode({ children, ...props }: ComponentProps<"code">) {
  if (children === BLANK_MARK) {
    return (
      <span className="q-blank" aria-label="빈칸">
        {" "}
      </span>
    );
  }
  return <code {...props}>{children}</code>;
}

type RecallProblemProps = {
  item: RecallItemView;
  last: boolean;
  // 건너뛰기나 결과 보기로 풀이를 저장하는 동안에는 다른 버튼을 막는다.
  busy: boolean;
  onSolved: (solved: Solved) => void;
  onSkip: () => void;
  // 채점을 받지 못한 채 결과 보기를 누르면 낸 답을 함께 넘겨, 그 문항을 건너뛴 것으로 다시 저장하지 않게 한다.
  onFinish: (current?: Solved) => void;
};

// 꺼내 먹기 문제 한 개다. 시안처럼 문항 사이에 채점 결과와 해설을 보여 주지 않고, 채점을 받으면 바로 다음으로 넘긴다.
// 채점하는 동안과 실패했을 때도 고른 답과 확신도를 그대로 보여 준다. 문제가 바뀌면 부르는 쪽이 key를 바꿔 새 풀이로 시작한다.
export function RecallProblem({ item, last, busy, onSolved, onSkip, onFinish }: RecallProblemProps) {
  const { problem } = item;
  const [flow, setFlow] = useState<QuizFlow>(() => startQuizFlow(problem));
  const [answer, setAnswer] = useState<ProblemStage>(() => startQuizFlow(problem));
  // 채점을 보내면 풀이 단계를 떠나므로, 마지막으로 고른 답을 따로 두어 계속 보여 준다.
  const dispatch = (event: QuizFlowEvent) => {
    const next = advanceQuizFlow(flow, event);
    if (flow.stage === "problem") setAnswer(next.stage === "problem" ? next : flow);
    setFlow(next);
  };

  const solved = useEffectEvent((done: Solved) => onSolved(done));
  const grading = flow.stage === "grading" ? flow : undefined;
  useEffect(() => {
    if (!grading) return;
    let active = true;
    void sendAttempt({ ...grading.request, recallItemId: item.id }).then((result) => {
      if (!active) return;
      setFlow((current) => advanceQuizFlow(current, result ? { type: "graded", result } : { type: "grading-failed" }));
      if (result) solved({ submitted: grading.request, result });
    });
    return () => {
      active = false;
    };
  }, [grading, item.id]);

  const working = flow.stage === "grading" || busy;
  const cta = `btn btn-dark btn-block ${last ? "btn-lg" : "recall-next"}`;

  return (
    <div className="recall-col">
      <span className="chip recall-from">{problem.conceptTitle}</span>
      <Answering item={item} flow={flow.stage === "problem" ? flow : answer} locked={flow.stage !== "problem" || busy} dispatch={dispatch} />
      {flow.stage === "grading-failed" && !busy ? (
        <>
          <div className="explain grade-fail" role="alert">
            <span>채점 결과를 받지 못했어요.</span>
            <button type="button" className="bubble-retry" onClick={() => dispatch({ type: "retry" })}>
              <RotateCw size={13} aria-hidden />
              다시 시도
            </button>
          </div>
          <button type="button" className="recall-later grade-skip" onClick={() => onSolved({ submitted: flow.request })}>
            {last ? "결과 보기" : "다음 문제로"}
          </button>
          {!last && (
            <button type="button" onClick={() => onFinish({ submitted: flow.request })} className="recall-later grade-skip">
              결과 보기
            </button>
          )}
        </>
      ) : (
        <div className="recall-cta">
          {working ? (
            <button type="button" disabled aria-busy="true" className={`${cta} is-busy`}>
              <LoaderCircle size={17} className="spinner" aria-hidden />
              {busy ? "저장하는 중…" : "채점하는 중…"}
            </button>
          ) : (
            <button
              type="button"
              disabled={flow.stage === "problem" && !canCheck(flow)}
              onClick={() => dispatch({ type: "check" })}
              className={cta}
            >
              {last ? "결과 보기" : "다음"}
            </button>
          )}
          {!working && problem.format !== "mcq" && (
            <button type="button" onClick={onSkip} className="recall-later">
              이 문제 건너뛰기
            </button>
          )}
          {!working && !last && (
            <button type="button" onClick={() => onFinish()} className="recall-later">
              결과 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Answering({
  item,
  flow,
  locked,
  dispatch,
}: {
  item: RecallItemView;
  flow: ProblemStage;
  locked: boolean;
  dispatch: (event: QuizFlowEvent) => void;
}) {
  const { problem } = item;
  const answered = canSubmit(flow);
  const submit = () => {
    if (canCheck(flow)) dispatch({ type: "check" });
  };
  return (
    <div inert={locked}>
      {problem.format === "blank" ? (
        <>
          <p className="q-stem">빈칸에 들어갈 말을 떠올려 보세요</p>
          <div className="recall-scaffold">
            <div className="recall-scaffold-stem recall-md">
              <Markdown remarkPlugins={[remarkGfm]} components={{ code: BlankOrCode }}>
                {markBlanks(problem.stem)}
              </Markdown>
            </div>
            <input
              // 시안처럼 빈칸 문제가 열리면 바로 쓸 수 있게 한다.
              autoFocus
              className="input"
              aria-label="빈칸에 들어갈 말"
              placeholder="빈칸에 들어갈 말"
              maxLength={MAX_ANSWER_LENGTH}
              value={flow.text}
              onChange={(event) => dispatch({ type: "write", text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
              }}
            />
          </div>
        </>
      ) : (
        <div className="q-stem recall-md">
          <Markdown remarkPlugins={[remarkGfm]}>{problem.stem}</Markdown>
        </div>
      )}
      {problem.format === "mcq" && (
        <div className="opts" role="radiogroup" aria-label="보기">
          {(problem.choices ?? []).map((choice, index) => {
            const picked = flow.chosenIndex === index;
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => dispatch({ type: "choose", index })}
                className={`opt ${picked ? "sel" : ""}`}
              >
                <span className="k" aria-hidden>
                  {LETTERS[index]}
                </span>
                <span className={sqlClass(choice)}>{choice}</span>
              </button>
            );
          })}
        </div>
      )}
      {problem.format === "free" && (
        <textarea
          aria-label="설명"
          placeholder="핵심 개념을 넣어 내 말로 설명해 보세요"
          maxLength={MAX_ANSWER_LENGTH}
          value={flow.text}
          onChange={(event) => dispatch({ type: "write", text: event.target.value })}
          className="input q-write"
        />
      )}
      <div role="group" aria-label="확신도" className={`recall-conf ${answered ? "" : "off"}`}>
        <span className="recall-conf-q">{problem.format === "mcq" ? "고른 답, 얼마나 확실해요?" : "쓴 답, 얼마나 확실해요?"}</span>
        {CONFIDENCES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            disabled={!answered}
            aria-pressed={flow.confidence === value}
            onClick={() => dispatch({ type: "pick-confidence", confidence: value })}
            className={`recall-conf-chip ${flow.confidence === value ? "on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
