"use client";

import { X } from "lucide-react";
import { useParams } from "next/navigation";
import { type KeyboardEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Mascot } from "@/app/_components/mascot";
import { QuizCard } from "@/app/_components/quiz-card";
import { type QuizTab, type QuizTabEvent, advanceQuizTab, fetchProblem, settleProblem, startQuizTab } from "@/lib/quiz-tab";
import { QuestionPanel } from "./question-panel";
import { QuizGuide } from "./quiz-guide";

const TABS = [
  { id: "agent", label: "AI 에이전트" },
  { id: "quiz", label: "퀴즈" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// 디자인 시안처럼 다섯 문제를 한 묶음으로 센다.
const SET_SIZE = 5;

// 다음 상태가 새 loading 단계일 때만 문제를 요청한다. 이벤트에서 보내므로 화면을 다시 그려도 요청이 늘지 않는다.
function useQuizTab() {
  const [tab, setTab] = useState<QuizTab>(startQuizTab);
  function send(event: QuizTabEvent) {
    const next = advanceQuizTab(tab, event);
    if (next === tab) return;
    setTab(next);
    if (next.stage !== "loading") return;
    void fetchProblem(next).then((problem) => setTab((current) => settleProblem(current, next, problem)));
  }
  return [tab, send] as const;
}

// 레이아웃에 두어 단원을 옮겨도 대화와 퀴즈가 남는다. 숨긴 탭과 닫은 패널도 그대로 두어 풀던 답과 받는 중인 답이 남는다.
export function StudyPanel() {
  const { unitId } = useParams<{ unitId: string }>();
  const [opened, setOpened] = useState(true);
  const [shown, setShown] = useState<TabId>("agent");
  const [quiz, sendQuiz] = useQuizTab();
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
    if (id === "quiz") sendQuiz({ type: "enter", unitId });
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
        <div id="panel-quiz" role="tabpanel" aria-labelledby="tab-quiz" hidden={shown !== "quiz"} className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다. */}
          <QuizGuide onClose={() => tabs.current.get("quiz")?.focus()} />
          <QuizTabBody
            tab={quiz}
            onRetry={() => sendQuiz({ type: "retry" })}
            onNext={() => sendQuiz({ type: "next", unitId })}
          />
        </div>
      </aside>
    </>
  );
}

function QuizTabBody({ tab, onRetry, onNext }: { tab: QuizTab; onRetry: () => void; onNext: () => void }) {
  return (
    <>
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className={tab.stage === "problem" || tab.stage === "idle" ? "sr-only" : "text-sm text-gray"}>
        {tab.stage === "loading" && (
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-line border-t-green-600 motion-reduce:animate-none" />
            문제를 만들고 있어요
          </span>
        )}
        {tab.stage === "failed" && <span className="font-bold text-red">문제를 만들지 못했어요</span>}
      </p>
      {tab.stage === "failed" && (
        <button type="button" onClick={onRetry} className="mt-3 h-9 rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-bg">
          다시 시도
        </button>
      )}
      {tab.stage === "problem" && (
        <>
          <p className="mb-3 text-xs font-semibold text-gray">
            {tab.number} / {SET_SIZE}
          </p>
          <QuizCard key={tab.problem.id} problem={tab.problem} onNext={onNext} />
        </>
      )}
    </>
  );
}
