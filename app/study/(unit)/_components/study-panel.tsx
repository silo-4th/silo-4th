"use client";

import { X } from "lucide-react";
import { useParams } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Mascot } from "@/app/_components/mascot";
import { QuizCard } from "@/app/_components/quiz-card";
import {
  SET_SIZE,
  type ProblemResult,
  type QuizTab,
  type QuizTabEvent,
  advanceQuizTab,
  fetchProblem,
  fetchResumedProblem,
  gaugeFilled,
  readSavedProblem,
  saveProblem,
  settleProblem,
  startQuizTab,
} from "@/lib/quiz-tab";
import { QuestionPanel } from "./question-panel";
import { QuizGuide } from "./quiz-guide";

const TABS = [
  { id: "agent", label: "AI 에이전트" },
  { id: "quiz", label: "퀴즈" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// 상태가 바뀔 때만 요청하고 기억한다. 이벤트와 응답에서 보내므로 화면을 다시 그려도 요청이 늘지 않는다.
// 이어 풀기 응답이 다시 새 문제 요청으로 이어지므로, 응답을 반영할 때도 지금 상태를 ref로 읽어 바로 다음 요청을 보낸다.
function useQuizTab(learnerId: string) {
  const [tab, setTab] = useState<QuizTab>(startQuizTab);
  const current = useRef(tab);

  // shownAt은 문제를 처음 내준 서버 시각이다. 풀이는 채점 전 시각으로 늦게 저장되므로, 이어 풀 때 시각을 새로 잡으면 그 풀이를 영영 세지 못한다.
  function commit(next: QuizTab, shownAt?: string) {
    current.current = next;
    setTab(next);
    if (next.stage === "problem") saveProblem(learnerId, { problemId: next.problem.id, number: next.number, shownAt });
    if (next.stage === "loading") void fetchProblem(next).then((served) => settle(next, served?.body, served?.servedAt));
    if (next.stage === "resuming") void fetchResumedProblem(next).then((problem) => settle(next, problem, next.shownAt));
  }

  function settle(requested: QuizTab, problem: ProblemResult, shownAt?: string) {
    const next = settleProblem(current.current, requested, problem);
    if (next !== current.current) commit(next, shownAt);
  }

  function send(event: QuizTabEvent) {
    const next = advanceQuizTab(current.current, event);
    if (next !== current.current) commit(next);
  }
  return [tab, send] as const;
}

// 레이아웃에 두어 단원을 옮겨도 대화와 퀴즈가 남는다. 숨긴 탭과 닫은 패널도 그대로 두어 풀던 답과 받는 중인 답이 남는다.
export function StudyPanel({ learnerId }: { learnerId: string }) {
  const { unitId } = useParams<{ unitId: string }>();
  const [opened, setOpened] = useState(true);
  const [shown, setShown] = useState<TabId>("agent");
  const [quiz, sendQuiz] = useQuizTab(learnerId);
  const tabs = useRef(new Map<TabId, HTMLButtonElement>());
  const peek = useRef<HTMLButtonElement>(null);

  // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 새로 보이는 버튼으로 포커스를 옮긴다.
  function closePanel() {
    flushSync(() => setOpened(false));
    peek.current?.focus();
  }

  function openPanel() {
    flushSync(() => setOpened(true));
    tabs.current.get(shown)?.focus();
  }

  function open(id: TabId) {
    setShown(id);
    if (id === "quiz") sendQuiz({ type: "enter", unitId, saved: readSavedProblem(learnerId) });
  }

  // 누른 버튼이 숨는 에이전트 탭에 있으므로 포커스를 퀴즈 탭으로 옮겨 키보드 사용자가 자리를 잃지 않게 한다.
  function solveRelated(questionId: string) {
    setShown("quiz");
    tabs.current.get("quiz")?.focus();
    sendQuiz({ type: "related", questionId });
  }

  function moveFocus(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const target = TABS[(index + step + TABS.length) % TABS.length];
    if (!target) return;
    open(target.id);
    tabs.current.get(target.id)?.focus();
  }

  return (
    <>
      {!opened && (
        <button ref={peek} type="button" aria-label="AI 패널 열기" onClick={openPanel} className="peek">
          <span aria-hidden className="peek-bubble">
            궁금한 거 있어?
          </span>
          <span className="peek-clip">
            <span className="peek-body">
              <Mascot size={104} />
            </span>
          </span>
        </button>
      )}
      <aside aria-label="학습 패널" hidden={!opened} className="panel">
        <div className="panel-head">
          <span />
          <div role="tablist" aria-label="학습 패널 메뉴" className="seg">
            {TABS.map(({ id, label }, index) => (
              <button
                key={id}
                ref={(element) => {
                  if (element) tabs.current.set(id, element);
                }}
                id={`tab-${id}`}
                type="button"
                role="tab"
                aria-selected={shown === id}
                aria-controls={`panel-${id}`}
                tabIndex={shown === id ? 0 : -1}
                onClick={() => open(id)}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="panel-head-end">
            <button type="button" aria-label="패널 닫기" title="패널 닫기" onClick={closePanel} className="head-icon">
              <X size={18} />
            </button>
          </div>
        </div>
        <div id="panel-agent" role="tabpanel" aria-labelledby="tab-agent" hidden={shown !== "agent"} className="flex min-h-0 flex-1 flex-col">
          <QuestionPanel onSolveRelated={solveRelated} />
        </div>
        <div id="panel-quiz" role="tabpanel" aria-labelledby="tab-quiz" hidden={shown !== "quiz"} className="flex min-h-0 flex-1 flex-col">
          <QuizTabBody
            tab={quiz}
            guide={
              // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다.
              <QuizGuide onClose={() => tabs.current.get("quiz")?.focus()} />
            }
            onRetry={() => sendQuiz({ type: "retry" })}
            onNext={() => sendQuiz({ type: "next", unitId })}
          />
        </div>
      </aside>
    </>
  );
}

function QuizTabBody({ tab, guide, onRetry, onNext }: { tab: QuizTab; guide: ReactNode; onRetry: () => void; onNext: () => void }) {
  // 채점을 받은 탭 상태다. 기본 문제는 같은 ID로 다시 나올 수 있어, ID 대신 문제를 띄울 때마다 새로 생기는 상태로 비교한다.
  const [gradedTab, setGradedTab] = useState<QuizTab>();
  const graded = gradedTab === tab;
  const waiting = tab.stage === "loading" || tab.stage === "resuming" || tab.stage === "failed";
  return (
    // 카드가 남은 높이를 채워야 다음 문제 버튼이 패널 아래까지 내려간다.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      {guide}
      {waiting && (
        <div className="flex justify-center pt-8">
          <Mascot size={88} spin={tab.stage !== "failed"} />
        </div>
      )}
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className={waiting ? "text-center text-sm text-gray" : "sr-only"}>
        {tab.stage === "loading" && "문제를 만들고 있어요"}
        {tab.stage === "resuming" && "풀던 문제를 불러오고 있어요"}
        {tab.stage === "failed" && <span className="font-bold text-red">문제를 만들지 못했어요</span>}
      </p>
      {tab.stage === "failed" && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={onRetry} className="btn btn-sm">
            다시 시도
          </button>
        </div>
      )}
      {tab.stage === "problem" && (
        <>
          <QuizGauge number={tab.number} filled={gaugeFilled(tab.number, graded)} />
          <QuizCard key={tab.problem.id} problem={tab.problem} onGraded={() => setGradedTab(tab)} onNext={onNext} pinNext />
        </>
      )}
    </div>
  );
}

// 칸 사이 3px 틈까지 더해 마스코트를 마지막으로 채운 칸의 끝에 세운다.
function QuizGauge({ number, filled }: { number: number; filled: number }) {
  const runner = filled ? `translateX(calc(${filled / SET_SIZE} * (100% + 3px) - 3px))` : "none";
  return (
    <div className="quiz-gauge">
      <div
        role="progressbar"
        aria-label="문제 진행"
        aria-valuemin={0}
        aria-valuemax={SET_SIZE}
        aria-valuenow={filled}
        aria-valuetext={`${SET_SIZE}문제 중 ${filled}문제 풀었어요`}
        className="quiz-strip"
      >
        {Array.from({ length: SET_SIZE }, (_, index) => (
          <i key={index} className={index < filled ? "on" : undefined} />
        ))}
      </div>
      <span className="quiz-runner" style={{ transform: runner }}>
        <Mascot size={22} />
      </span>
      <p className="sr-only">
        문제 {number} / {SET_SIZE}
      </p>
    </div>
  );
}
