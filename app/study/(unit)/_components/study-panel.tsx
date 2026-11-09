"use client";

import { X } from "lucide-react";
import { useParams } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Mascot } from "@/app/_components/mascot";
import { QuizCard } from "@/app/_components/quiz-card";
import { ResultChipLabel } from "@/app/_components/result-chip";
import type { Solved } from "@/lib/quiz-card";
import {
  SET_SIZE,
  type ProblemResult,
  type QuizSet,
  type QuizSetEvent,
  type QuizTab,
  type SetResults,
  advanceQuizSet,
  clearSavedProblem,
  fetchPersonalized,
  fetchProblem,
  fetchResumedProblem,
  gaugeFilled,
  readSavedProblem,
  saveProblem,
  setGuide,
  setItems,
  setTitle,
  settleProblem,
  startQuizSet,
} from "@/lib/quiz-tab";
import { QuestionPanel } from "./question-panel";
import { QuizGuide } from "./quiz-guide";

const TABS = [
  { id: "agent", label: "AI 에이전트" },
  { id: "quiz", label: "퀴즈" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// 탭 상태가 바뀔 때만 요청한다. 이벤트와 응답에서 보내므로 화면을 다시 그려도 요청이 늘지 않는다.
// 문제를 띄운 동안에는 칩이 바뀔 때마다 기억해, 새로고침 뒤에도 결과에 앞서 푼 문제가 나온다.
// 이어 풀기 응답이 다시 새 문제 요청으로 이어지므로, 응답을 반영할 때도 지금 상태를 ref로 읽어 바로 다음 요청을 보낸다.
function useQuizSet(learnerId: string) {
  const [set, setSet] = useState<QuizSet>(startQuizSet);
  const current = useRef(set);
  // 문제를 처음 내준 서버 시각이다. 풀이는 채점 전 시각으로 늦게 저장되므로, 이어 풀 때 시각을 새로 잡으면 그 풀이를 영영 세지 못한다.
  const shownAt = useRef<string>(undefined);

  function commit(next: QuizSet) {
    const { tab: before, results: earlier } = current.current;
    current.current = next;
    setSet(next);
    const { tab, results } = next;
    // 채점을 받지 못한 칩은 문제를 넘길 때 생기므로, 떠나는 문제의 자리에 함께 남겨야 새로고침 뒤 결과에서 빠지지 않는다.
    const saving = tab.stage === "problem" ? tab : before.stage === "problem" && results !== earlier ? before : undefined;
    if (saving) saveProblem(learnerId, { problemId: saving.problem.id, number: saving.number, shownAt: shownAt.current, results });
    if (tab === before) return;
    // 결과에서 나오면 새 묶음이다. 새 문제를 받기 전에 새로고침해도 지난 묶음의 마지막 문제로 결과를 다시 띄우지 않는다.
    if (before.stage === "result") clearSavedProblem(learnerId);
    if (tab.stage === "loading") void fetchProblem(tab).then((served) => settle(tab, served?.body, served?.servedAt));
    if (tab.stage === "resuming") void fetchResumedProblem(tab).then((problem) => settle(tab, problem, tab.shownAt));
  }

  function settle(requested: QuizTab, problem: ProblemResult, servedAt?: string) {
    const tab = settleProblem(current.current.tab, requested, problem);
    if (tab === current.current.tab) return;
    if (tab.stage === "problem") shownAt.current = servedAt;
    commit({ ...current.current, tab });
  }

  function send(event: QuizSetEvent) {
    const next = advanceQuizSet(current.current, event);
    if (next !== current.current) commit(next);
  }
  return [set, send] as const;
}

// 레이아웃에 두어 단원을 옮겨도 대화와 퀴즈가 남는다. 숨긴 탭과 닫은 패널도 그대로 두어 풀던 답과 받는 중인 답이 남는다.
export function StudyPanel({ learnerId }: { learnerId: string }) {
  const { unitId } = useParams<{ unitId: string }>();
  const [opened, setOpened] = useState(true);
  const [shown, setShown] = useState<TabId>("agent");
  const [quiz, sendQuiz] = useQuizSet(learnerId);
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
    if (id !== "quiz") return;
    const saved = readSavedProblem(learnerId);
    if (saved) sendQuiz({ type: "enter", unitId, saved });
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
            set={quiz}
            unitId={unitId}
            active={opened && shown === "quiz"}
            guide={
              // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다.
              <QuizGuide onClose={() => tabs.current.get("quiz")?.focus()} />
            }
            onStart={() => {
              // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다.
              sendQuiz({ type: "enter", unitId });
              tabs.current.get("quiz")?.focus();
            }}
            onRetry={() => sendQuiz({ type: "retry" })}
            onGraded={(solved) => sendQuiz({ type: "graded", solved })}
            onNext={(solved) => sendQuiz({ type: "next", unitId, solved })}
            onLeaveResult={(leave) => {
              // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다.
              sendQuiz(leave === "home" ? { type: "home" } : { type: "restart", unitId });
              tabs.current.get("quiz")?.focus();
            }}
          />
        </div>
      </aside>
    </>
  );
}

type Leave = "restart" | "home";

type QuizTabBodyProps = {
  set: QuizSet;
  unitId: string;
  active: boolean;
  guide: ReactNode;
  onStart: () => void;
  onRetry: () => void;
  onGraded: (solved: Solved) => void;
  onNext: (solved: Solved) => void;
  onLeaveResult: (leave: Leave) => void;
};

function QuizTabBody({ set, unitId, active, guide, onStart, onRetry, onGraded, onNext, onLeaveResult }: QuizTabBodyProps) {
  const { tab, results } = set;
  const waiting = tab.stage === "loading" || tab.stage === "resuming" || tab.stage === "failed";
  return (
    // 카드가 남은 높이를 채워야 다음 문제 버튼이 패널 아래까지 내려간다.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      {guide}
      {/* 읽고 물어볼 때마다 안내가 바뀌므로, 탭을 열 때마다 새로 그려 다시 묻는다. */}
      {tab.stage === "idle" && active && <QuizHome unitId={unitId} onStart={onStart} />}
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
          {/* 관련 문제가 자리를 바꾸면 그 번호의 칸을 비우므로, 칸이 차 있으면 지금 문제를 채점받은 것이다. */}
          <QuizGauge number={tab.number} filled={gaugeFilled(tab.number, Boolean(results[tab.number - 1]))} />
          <QuizCard
            key={tab.problem.id}
            problem={tab.problem}
            onGraded={onGraded}
            onNext={onNext}
            nextLabel={tab.number >= SET_SIZE ? "결과 보기" : undefined}
            pinNext
          />
        </>
      )}
      {tab.stage === "result" && <QuizResult results={results} onLeave={onLeaveResult} />}
    </div>
  );
}

// 누른 결과 보기 버튼이 사라지므로, 키보드와 스크린리더 사용자가 결과를 바로 읽도록 제목으로 포커스를 옮긴다.
// 이어 풀기로 결과가 뜰 때는 패널 밖에서 읽던 자리를 빼앗지 않는다.
function focusHeading(element: HTMLHeadingElement | null) {
  if (!element) return;
  const focused = element.ownerDocument.activeElement;
  const stayed = !focused || focused === element.ownerDocument.body || element.closest('[role="tabpanel"]')?.contains(focused);
  if (stayed) element.focus();
}

function QuizResult({ results, onLeave }: { results: SetResults; onLeave: (leave: Leave) => void }) {
  return (
    <div className="flex flex-col">
      <h2 ref={focusHeading} tabIndex={-1} className="text-[21px] leading-snug font-bold tracking-tight outline-none">
        {setTitle(results)}
      </h2>
      <ol className="mt-5 flex flex-col gap-2">
        {setItems(results).map((slot, index) => (
          <li key={index} className="card flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold">
              {index + 1}. {slot.conceptTitle}
            </span>
            <ResultChipLabel chip={slot.chip} />
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-gray">{setGuide(results)}</p>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={() => onLeave("restart")} className="btn btn-dark btn-lg btn-block">
          새 문제 풀기
        </button>
        <button type="button" onClick={() => onLeave("home")} className="btn btn-lg btn-block">
          퀴즈 홈
        </button>
      </div>
    </div>
  );
}

// 안내 문구는 응답을 받은 뒤에 보여 준다. 받기 전에 한쪽 문구를 띄우면 틀린 안내가 잠깐 보인다.
function QuizHome({ unitId, onStart }: { unitId: string; onStart: () => void }) {
  const [personalized, setPersonalized] = useState<{ unitId: string; value: boolean }>();
  useEffect(() => {
    let current = true;
    void fetchPersonalized(unitId).then((value) => {
      if (current && value !== undefined) setPersonalized({ unitId, value });
    });
    return () => {
      current = false;
    };
  }, [unitId]);
  const known = personalized?.unitId === unitId ? personalized.value : undefined;

  return (
    <div className="my-auto flex flex-col items-center px-1 pb-20 text-center">
      <Mascot size={96} />
      <h2 className="mt-3 mb-1.5 text-[21px] font-bold tracking-tight">확인 문제</h2>
      {known !== undefined && (
        <p className="text-[13.5px] leading-relaxed text-gray">
          {known ? "AI가 내가 나눈 대화를 바탕으로" : "AI가 내 대화를 바탕으로 문제를 내요."}
          <br />
          {known ? `${SET_SIZE}문제를 출제해요.` : "아직 나눈 대화가 없어서 기출 문제로 준비했어요."}
        </p>
      )}
      <div className="mt-6 flex w-full flex-col gap-2">
        <button type="button" onClick={onStart} className="btn btn-dark btn-lg btn-block">
          AI 맞춤 문제 풀기
        </button>
        {/* 지난 문제 목록은 4-135에서 붙인다. */}
        <button type="button" disabled className="btn btn-lg btn-block">
          지난 문제 보기
        </button>
      </div>
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
