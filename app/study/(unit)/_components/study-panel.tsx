"use client";

import { House, X } from "lucide-react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import mascot from "@/app/_assets/mascot.png";
import { Burst } from "@/app/_components/burst";
import { FailState } from "@/app/_components/fail-state";
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
  completesSet,
  fetchPersonalized,
  fetchProblem,
  fetchResumedProblem,
  gaugeFilled,
  readSavedProblem,
  readSetFinished,
  saveProblem,
  saveSetFinished,
  setGuide,
  setAllRight,
  setItems,
  setTitle,
  settleQuizSet,
  startQuizSet,
} from "@/lib/quiz-tab";
import { BetaNotice } from "./beta-notice";
import { PastProblems, focusOnMount } from "./past-problems";
import { QuestionPanel } from "./question-panel";
import { QuizGuide } from "./quiz-guide";
import { QuizHomeArt } from "./quiz-home-art";
import { useSelectionAsk } from "./selection-ask";

const TABS = [
  { id: "agent", label: "AI 에이전트" },
  { id: "quiz", label: "퀴즈" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// 탭 상태가 바뀔 때만 요청한다. 이벤트와 응답에서 보내므로 화면을 다시 그려도 요청이 늘지 않는다.
// 문제를 띄운 동안에는 칩이 바뀔 때마다 기억해, 새로고침 뒤에도 결과에 앞서 푼 문제가 나온다.
// 이어 풀기 응답이 다시 새 문제 요청으로 이어지므로, 응답을 반영할 때도 지금 상태를 ref로 읽어 바로 다음 요청을 보낸다.
function useQuizSet(learnerId: string) {
  const [set, setSet] = useState<QuizSet>(() => startQuizSet(readSetFinished(learnerId)));
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
    const next = settleQuizSet(current.current, requested, problem);
    if (next === current.current) return;
    if (next.tab.stage === "problem") shownAt.current = servedAt;
    commit(next);
  }

  // 탭을 연 채로 학습일이 바뀌었거나 다른 탭에서 묶음을 마쳤을 수 있어, 새 묶음을 시작하는 버튼은 누를 때 저장된 학습일로 다시 판단한다.
  function send(event: QuizSetEvent): QuizSet {
    const starting = event.type === "enter" || event.type === "restart";
    const base = starting ? { ...current.current, finished: readSetFinished(learnerId) } : current.current;
    // 메모리의 finished는 지난 학습일 값일 수 있어, 바뀔 때가 아니라 묶음을 마치는 이벤트마다 오늘 학습일을 남긴다.
    if (completesSet(base.tab, event)) saveSetFinished(learnerId);
    const next = advanceQuizSet(base, event);
    if (next !== current.current) commit(next);
    return next;
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
  const selectionAsks = useSelectionAsk();

  // 드래그 메뉴로 보낸 질문의 답이 보이게, 패널이 닫혀 있거나 퀴즈 탭이 열려 있어도 에이전트 탭을 연다.
  useEffect(
    () =>
      selectionAsks.listen(() => {
        setOpened(true);
        setShown("agent");
      }),
    [selectionAsks],
  );

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
  // 새로고침 뒤 퀴즈 탭을 열기 전이어도 기억해 둔 묶음의 카운트와 칩을 잇도록 함께 보낸다.
  function solveRelated(questionId: string) {
    setShown("quiz");
    tabs.current.get("quiz")?.focus();
    sendQuiz({ type: "related", questionId, saved: readSavedProblem(learnerId) });
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
              <Mascot size={104} mood="zip" hoverMood="cat" />
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
          <QuestionPanel learnerId={learnerId} onSolveRelated={solveRelated} />
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
              // 막혀서 안내가 뜨면 버튼이 남고, 안내를 닫을 때 브라우저가 그 버튼으로 포커스를 돌려준다.
              if (!sendQuiz({ type: "enter", unitId }).betaNotice) tabs.current.get("quiz")?.focus();
            }}
            onRetry={() => sendQuiz({ type: "retry" })}
            onGraded={(solved) => sendQuiz({ type: "graded", solved })}
            onNext={(solved) => sendQuiz({ type: "next", unitId, solved })}
            onLeaveResult={(leave) => {
              // 누른 버튼이 사라지므로, 키보드 사용자가 자리를 잃지 않게 퀴즈 탭으로 포커스를 돌려준다.
              const next = sendQuiz(leave === "home" ? { type: "home" } : { type: "restart", unitId });
              if (!next.betaNotice) tabs.current.get("quiz")?.focus();
            }}
          />
          <BetaNotice open={quiz.betaNotice} onClose={() => sendQuiz({ type: "dismiss" })}>
            지금은 하루에 한 묶음만 풀 수 있어요.
            <br />
            새벽 4시가 지나면 새 문제를 풀 수 있어요.
          </BetaNotice>
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
  // 지난 문제를 연 퀴즈 홈이나 결과 상태다. 관련 문제로 그 화면을 떠났다가 돌아오면 새 상태라 지난 문제가 아니라 그 화면을 보여 준다.
  const [pastOf, setPastOf] = useState<QuizTab>();
  const pastShown = pastOf === tab;
  // 누른 돌아가기 버튼이 사라지므로 연 화면의 지난 문제 보기 버튼으로 포커스를 돌려준다. 돌아온 직후 한 번만 옮겨, 나중에 탭을 다시 열 때는 옮기지 않는다.
  const backPending = useRef(false);
  const [focusBack] = useState(() => (element: HTMLElement | null) => {
    if (!element || !backPending.current) return;
    backPending.current = false;
    focusOnMount(element);
  });
  const waiting = tab.stage === "loading" || tab.stage === "resuming";
  return (
    // 카드가 남은 높이를 채워야 다음 문제 버튼이 패널 아래까지 내려간다.
    // 지난 문제의 제목 줄은 위에 붙어 있으므로, 키보드로 올라갈 때 그 아래로 스크롤해 포커스가 가려지지 않게 한다.
    <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-5 ${pastShown ? "scroll-pt-14" : ""}`}>
      {/* 지난 문제는 패널 맨 위에 제목 줄을 두므로 첫 진입 안내를 가린다. 닫은 안내가 다시 뜨지 않게 지우지 않고 숨긴다. */}
      <div hidden={pastShown}>{guide}</div>
      {/* 읽고 물어볼 때마다 안내가 바뀌므로, 탭을 열 때마다 새로 그려 다시 묻는다. */}
      {pastShown && active && (
        <PastProblems
          onBack={() => {
            backPending.current = true;
            setPastOf(undefined);
          }}
        />
      )}
      {tab.stage === "idle" && active && !pastShown && (
        <QuizHome unitId={unitId} pastRef={focusBack} onStart={onStart} onPast={() => setPastOf(tab)} />
      )}
      {waiting && <QuizSkeleton />}
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className="sr-only">
        {tab.stage === "loading" && "문제를 만들고 있어요"}
        {tab.stage === "resuming" && "풀던 문제를 불러오고 있어요"}
      </p>
      {tab.stage === "failed" && <FailState title="문제를 만들지 못했어요" onRetry={onRetry} />}
      {tab.stage === "problem" && (
        <>
          {/* 그 번호에 문제가 뜰 때 칸을 비우므로, 칸이 차 있으면 지금 문제를 채점받은 것이다. */}
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
      {tab.stage === "result" && !pastShown && (
        <QuizResult results={results} pastRef={focusBack} onLeave={onLeaveResult} onPast={() => setPastOf(tab)} />
      )}
    </div>
  );
}

type QuizResultProps = {
  results: SetResults;
  pastRef: (element: HTMLElement | null) => void;
  onLeave: (leave: Leave) => void;
  onPast: () => void;
};

// 누른 결과 보기 버튼이 사라지므로 제목으로 포커스를 옮긴다. 이어 풀기로 결과가 뜰 때는 패널 밖에서 읽던 자리를 빼앗지 않는다.
// 결과가 길면 아래 두 버튼은 패널 아래에 붙어 늘 보인다.
function QuizResult({ results, pastRef, onLeave, onPast }: QuizResultProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="-mx-2.5 -mt-5 flex h-[47px] flex-none items-center">
        <button type="button" aria-label="퀴즈 홈" title="퀴즈 홈" onClick={() => onLeave("home")} className="tool-btn">
          <House size={18} aria-hidden />
        </button>
      </div>
      <div className="quiz-done flex flex-col items-center px-1 text-center">
        <Burst>
          <Mascot size={72} spin mood={setAllRight(results) ? "wow" : "smile"} />
        </Burst>
        <h2 ref={focusOnMount} tabIndex={-1} className="mt-3 mb-1.5 text-lg leading-snug font-bold tracking-[-0.02em] outline-none">
          {setTitle(results)}
        </h2>
        <p className="mb-4 text-[13.5px] leading-relaxed text-gray">{setGuide(results)}</p>
      </div>
      <ol className="mt-1 rounded-lg bg-[color-mix(in_srgb,var(--color-bg)_80%,#fff)] px-4 py-1">
        {setItems(results).map((slot, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-3 border-t border-[color-mix(in_srgb,var(--color-line)_55%,var(--color-bg))] py-2.5 first:border-t-0"
          >
            <span className="min-w-0 text-sm font-semibold text-ink">
              {index + 1}. {slot.conceptTitle}
            </span>
            <ResultChipLabel chip={slot.chip} />
          </li>
        ))}
      </ol>
      <div className="sticky -bottom-5 z-2 mt-4.5 -mb-5 flex gap-2 bg-white pt-3 pb-5 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-linear-to-b before:from-white/0 before:to-white">
        <button type="button" ref={pastRef} onClick={onPast} className="btn flex-1">
          지난 문제 보기
        </button>
        <button type="button" onClick={() => onLeave("restart")} className="btn btn-dark flex-1">
          새 문제 풀기
        </button>
      </div>
    </div>
  );
}

// 안내 문구가 나중에 붙으면 화면이 밀리므로, 응답을 받을 때까지 홈 대신 로딩을 두고 한 번에 보여 준다.
// 받지 못하면 틀린 안내를 띄우지 않도록 문구만 빼고 보여 준다.
type QuizHomeProps = { unitId: string; pastRef: (element: HTMLElement | null) => void; onStart: () => void; onPast: () => void };

function QuizHome({ unitId, pastRef, onStart, onPast }: QuizHomeProps) {
  const [personalized, setPersonalized] = useState<{ unitId: string; value: boolean | undefined }>();
  useEffect(() => {
    let current = true;
    void fetchPersonalized(unitId).then((value) => {
      if (current) setPersonalized({ unitId, value });
    });
    return () => {
      current = false;
    };
  }, [unitId]);
  if (personalized?.unitId !== unitId) return <QuizHomeLoading />;
  const known = personalized.value;

  return (
    <div className="my-auto flex flex-col items-center px-1 pb-20 text-center">
      <QuizHomeArt />
      <h2 className="mt-3 mb-1.5 text-[21px] font-bold tracking-tight">이해했는지 확인해 볼까요?</h2>
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
        <button type="button" ref={pastRef} onClick={onPast} className="btn btn-lg btn-block">
          지난 문제 보기
        </button>
      </div>
    </div>
  );
}

// 시안의 가장 조용한 로딩이다. 대화의 기다리는 말풍선을 키워 퀴즈 홈 자리에 둔다.
function QuizHomeLoading() {
  return (
    <div aria-busy className="my-auto flex flex-col items-center p-1 pb-20">
      <span
        aria-hidden
        className="grid h-[60px] w-[88px] place-items-center rounded-[22px_22px_22px_8px] bg-bg [&_.typing]:gap-[7px] [&_.typing]:p-0 [&_.typing_i]:size-2.5"
      >
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="sr-only">퀴즈 홈을 불러오고 있어요</span>
    </div>
  );
}

// 진행 막대, 개념 칩, 문제 두 줄, 보기 4칸으로 문제 카드 모양을 그린다.
function QuizSkeleton() {
  return (
    <div aria-hidden className="quiz-skel">
      <div className="quiz-strip">
        {Array.from({ length: SET_SIZE }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <i className="skel mt-5 h-6 w-[92px]" />
      <i className="skel skel-line mt-3.5 w-[92%]" />
      <i className="skel skel-line mt-2.5 w-[64%]" />
      {[0, 1, 2, 3].map((index) => (
        <i key={index} className="skel quiz-skel-opt" />
      ))}
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
      <span aria-hidden className="quiz-runner" style={{ transform: runner }}>
        <Image src={mascot} width={22} height={22} alt="" draggable={false} />
      </span>
      <p className="sr-only">
        문제 {number} / {SET_SIZE}
      </p>
    </div>
  );
}
