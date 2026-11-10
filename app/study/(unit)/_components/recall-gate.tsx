"use client";

import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import cookieWantFrown from "@/app/_assets/mascot-cookie-want-frown.webp";
import cookieWant from "@/app/_assets/mascot-cookie-want.webp";
import { QuizCard } from "@/app/_components/quiz-card";
import { ResultChipLabel } from "@/app/_components/result-chip";
import {
  RECALL_PREP_STEPS,
  type PrepStepState,
  type RecallFlow,
  type RecallFlowEvent,
  advanceRecall,
  entryOf,
  isLastProblem,
  openTodayRecall,
  prepStepsAt,
  progressOf,
  recordRecallEvent,
  recordSectionOpened,
  startRecall,
} from "@/lib/recall-flow";
import { type ResultCard, resultCards, resultSubtitle, resultTitle, studyHref } from "@/lib/recall-result";
import type { RecallSetView } from "@/lib/recall-sets";

// leavingFrom은 결과에서 다른 단원으로 떠날 때의 주소다. 주소가 바뀌면 학습 화면을 그린다.
type Gate =
  | { stage: "checking" }
  | { stage: "recall"; set: RecallSetView; leavingFrom?: string }
  | { stage: "study" };

// 하루 첫 진입에 꺼내 먹기를 띄운다. 확인이 끝날 때까지 학습 화면을 그리지 않아, 꺼내 먹기 뒤에서 본 절 기록이 쌓이지 않게 한다.
// 레이아웃에 두어 단원을 옮겨도 다시 확인하지 않는다.
export function RecallGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ stage: "checking" });
  const pathname = usePathname();
  const router = useRouter();
  // 오늘 세트는 한 번만 받을 수 있다. 개발 모드에서 효과가 두 번 돌아도 요청은 한 번만 보낸다.
  const opened = useRef<Promise<RecallSetView | null>>(null);

  useEffect(() => {
    let active = true;
    opened.current ??= openTodayRecall();
    void opened.current.then((set) => {
      if (!active) return;
      // 모든 문항을 푼 뒤 완료 기록만 빠진 세트는 결과부터 열리므로, 여기서 완료를 보낸다.
      if (set && startRecall(set).stage === "result") recordRecallEvent(set.id, "complete");
      setGate(set ? { stage: "recall", set } : { stage: "study" });
    });
    return () => {
      active = false;
    };
  }, []);

  // 학습 화면은 주소가 갈 곳으로 바뀐 뒤에 그린다. 먼저 그리면 떠나는 단원의 절을 본 것으로 기록하고, 해시로 절을 찾는 화면이 옛 주소를 읽는다.
  if (gate.stage === "recall" && gate.leavingFrom !== undefined && pathname !== gate.leavingFrom) setGate({ stage: "study" });

  function leave(href: string) {
    if (gate.stage !== "recall") return;
    const target = new URL(href, location.href);
    if (target.pathname === location.pathname) {
      history.pushState(null, "", target.hash || target.pathname);
      setGate({ stage: "study" });
      return;
    }
    setGate({ ...gate, leavingFrom: pathname });
    router.push(href);
  }

  if (gate.stage === "study") return children;
  return (
    <main aria-label="꺼내 먹기" className="fixed inset-0 z-50 overflow-y-auto bg-bg text-ink">
      {gate.stage === "checking" ? (
        <Preparing />
      ) : (
        <RecallScreen set={gate.set} onClose={() => setGate({ stage: "study" })} onLeave={leave} />
      )}
    </main>
  );
}

const STEP_LABEL: Record<RecallFlow["stage"], (flow: RecallFlow) => string> = {
  entry: () => "꺼낼 개념",
  problem: (flow) => `${progressOf(flow) ?? ""} 문제`,
  result: () => "꺼내 먹기 결과",
};

// 누른 버튼이 단계와 함께 사라지므로, 키보드와 스크린리더 사용자가 자리를 잃지 않게 새 단계로 포커스를 옮긴다.
// 단계마다 key가 바뀌어 새로 붙을 때만 불린다.
function focusStep(element: HTMLElement | null) {
  element?.focus();
}

type Exits = { onClose: () => void; onLeave: (href: string) => void };

function RecallScreen({ set, onClose, onLeave }: { set: RecallSetView } & Exits) {
  const [flow, setFlow] = useState<RecallFlow>(() => startRecall(set));

  function send(event: RecallFlowEvent) {
    const next = advanceRecall(flow, event);
    if (next === flow) return;
    // 시작 기록이 빠진 채 모든 문항을 푼 세트는 입구에서 결과로 바로 가므로, 입구를 떠날 때마다 시작을 보낸다.
    if (flow.stage === "entry") recordRecallEvent(set.id, "start");
    if (next.stage === "result") recordRecallEvent(set.id, "complete");
    setFlow(next);
  }

  function postpone() {
    recordRecallEvent(set.id, "postpone");
    onClose();
  }

  return (
    <>
      {flow.stage !== "result" && <RecallHeader progress={progressOf(flow)} />}
      <div className={PAGE}>
        <section
          key={flow.stage === "problem" ? `problem-${flow.index}` : flow.stage}
          ref={focusStep}
          tabIndex={-1}
          aria-label={STEP_LABEL[flow.stage](flow)}
          className={`${FRAME} focus:outline-none`}
        >
          {flow.stage === "entry" && <Entry set={set} onStart={() => send({ type: "start" })} onLater={postpone} />}
          {flow.stage === "problem" && <Problem flow={flow} send={send} />}
          {flow.stage === "result" && <Result flow={flow} onClose={onClose} onLeave={onLeave} />}
        </section>
      </div>
    </>
  );
}

// 시안처럼 회색 바탕 위 흰 카드 하나에 꺼내 먹기의 모든 단계를 담는다.
const PAGE = "px-6 pt-8 pb-14";
const FRAME = "mx-auto flex min-h-[440px] w-full max-w-[680px] flex-col rounded-lg border border-line bg-white px-10 pt-10 pb-12 shadow-card";

function RecallHeader({ progress }: { progress?: string }) {
  return (
    <header className="sticky top-0 flex h-14 items-center justify-between border-b border-line bg-white px-6">
      <span className="text-[15px] font-bold">꺼내 먹기</span>
      <span className="text-sm font-semibold text-gray">{progress}</span>
    </header>
  );
}

// 세트는 10초 넘게 걸려 만들어진다. 입구와 같은 자리에 준비 단계를 두어, 준비가 끝나면 같은 상자가 개념 목록으로 바뀌어 보인다.
function Preparing() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timers = RECALL_PREP_STEPS.flatMap(({ doneAtMs }) =>
      doneAtMs === undefined ? [] : [setTimeout(() => setElapsed(doneAtMs), doneAtMs)],
    );
    return () => timers.forEach(clearTimeout);
  }, []);
  const states = prepStepsAt(elapsed);
  return (
    <>
      <RecallHeader />
      <div className={PAGE}>
        <div role="status" className={FRAME}>
          <IntroHead title="어제 공부한 내용을 챙기고 있어요" />
          <ol className={INFO_BOX}>
            {RECALL_PREP_STEPS.map(({ label }, index) => (
              <PrepStep key={label} label={label} state={states[index] ?? "wait"} />
            ))}
          </ol>
          <IntroActions />
        </div>
      </div>
    </>
  );
}

const PREP_STEP_STYLE: Record<PrepStepState, { text: string; mark: string; spoken: string }> = {
  done: { text: "text-ink-2", mark: "prep-tick border-green bg-green", spoken: " 완료" },
  now: { text: "text-ink", mark: "prep-spin border-line border-t-green", spoken: " 진행 중" },
  wait: { text: "text-gray-3", mark: "border-line", spoken: "" },
};

function PrepStep({ label, state }: { label: string; state: PrepStepState }) {
  const style = PREP_STEP_STYLE[state];
  return (
    <li aria-atomic className={`${INFO_ROW} gap-3 text-[15px] font-semibold transition-colors duration-300 ${style.text}`}>
      <span aria-hidden className={`grid size-5 flex-none place-items-center rounded-full border-2 text-white ${style.mark}`}>
        {state === "done" && <Check size={12} strokeWidth={3} />}
      </span>
      {label}
      <span className="sr-only">{style.spoken}</span>
    </li>
  );
}

// 준비 단계와 개념 목록이 같은 상자, 같은 줄 높이를 써서 준비가 끝나도 상자 크기가 바뀌지 않는다.
const INFO_BOX = "flex flex-col rounded-lg border border-line bg-white px-4";
const INFO_ROW = "flex min-h-[52px] items-center border-t border-line-2 py-3.5 first:border-t-0";

// 꺼내 먹기를 마치면 쿠키를 받는 이야기가 여기서 시작한다. 마스코트가 쿠키를 바라고 있다.
function IntroHead({ title, summary }: { title: string; summary?: string }) {
  return (
    <>
      <span aria-hidden className="recall-want">
        <span className="recall-want-bob">
          <Image src={cookieWant} alt="" width={136} height={110} draggable={false} unoptimized loading="eager" />
          <Image src={cookieWantFrown} alt="" width={136} height={110} draggable={false} unoptimized className="recall-want-frown" />
          <i className="recall-want-droop l" />
          <i className="recall-want-droop r" />
          <i className="mascot-lid l" />
          <i className="mascot-lid r" />
        </span>
      </span>
      <h1 className="mb-2 text-center text-2xl leading-[1.35] font-bold tracking-[-0.03em] text-balance">{title}</h1>
      <p className="mb-6 min-h-[1.6em] text-center text-sm leading-[1.6] text-gray">{summary}</p>
    </>
  );
}

// 준비 중에는 버튼을 숨기되 자리는 남겨, 준비가 끝나 버튼이 나타나도 아래가 밀리지 않는다.
function IntroActions({ onStart, onLater }: { onStart?: () => void; onLater?: () => void }) {
  const ready = onStart !== undefined;
  return (
    <div
      aria-hidden={!ready}
      className={`mt-7 flex flex-col items-center gap-5 ${ready ? "cta-in" : "pointer-events-none opacity-0"}`}
    >
      <button type="button" onClick={onStart} tabIndex={ready ? undefined : -1} className="btn btn-dark btn-lg btn-block">
        시작하기
      </button>
      <button
        type="button"
        onClick={onLater}
        tabIndex={ready ? undefined : -1}
        className="rounded-[4px] text-[13.5px] font-semibold text-gray underline underline-offset-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
      >
        내일 꺼내 먹을래요
      </button>
    </div>
  );
}

function Entry({ set, onStart, onLater }: { set: RecallSetView; onStart: () => void; onLater: () => void }) {
  const { rows, summary } = entryOf(set.items);
  return (
    <>
      <IntroHead title={`지난번에 공부한 것 중 ${rows.length}개를 꺼내 볼게요`} summary={summary} />
      <ul className={INFO_BOX}>
        {rows.map((row, index) => (
          <li key={row.id} className={`${INFO_ROW} rise-in gap-2.5`} style={{ animationDelay: `${index * 90}ms` }}>
            <span className={`chip ${row.reason === "물어봄" ? "chip-green" : "chip-red"}`}>{row.reason}</span>
            <span className="text-[15px] font-bold">{row.conceptTitle}</span>
          </li>
        ))}
      </ul>
      <IntroActions onStart={onStart} onLater={onLater} />
    </>
  );
}

function Problem({
  flow,
  send,
}: {
  flow: Extract<RecallFlow, { stage: "problem" }>;
  send: (event: RecallFlowEvent) => void;
}) {
  const item = flow.set.items[flow.index];
  if (!item) return null;
  const last = isLastProblem(flow);
  return (
    <QuizCard
      key={item.id}
      problem={item.problem}
      recallItemId={item.id}
      nextLabel={last ? "결과 보기" : "다음 문제"}
      onNext={(solved) => send({ type: "answered", ...solved })}
      onSkip={() => send({ type: "skip" })}
    />
  );
}

// 링크로 두어 새 탭으로도 열 수 있게 하고, 이 화면에서 옮길 때만 주소가 바뀐 뒤 꺼내 먹기를 닫는다.
function LeaveLink({
  href,
  onLeave,
  onOpen,
  className,
  children,
}: {
  href: string;
  onLeave: (href: string) => void;
  onOpen?: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        onOpen?.();
        onLeave(href);
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

function Result({ flow, onClose, onLeave }: { flow: Extract<RecallFlow, { stage: "result" }> } & Exits) {
  const cards = resultCards(flow.set, flow.answers);
  const { studyFrom } = flow.set;
  const start = "btn btn-dark btn-lg btn-block mt-8";
  return (
    <>
      <p className="text-sm font-semibold text-green-600">🍪 플러키에게 쿠키를 전달했어요!</p>
      <h1 className="mt-2 text-[22px] leading-snug font-bold">{resultTitle(cards)}</h1>
      <p className="mt-2 text-sm text-gray">{resultSubtitle(cards)}</p>
      <ol className="mt-6 flex flex-col gap-3">
        {cards.map((card, index) => (
          <ResultItem key={card.itemId} number={index + 1} card={card} onLeave={onLeave} />
        ))}
      </ol>
      {studyFrom ? (
        <LeaveLink href={studyHref(studyFrom)} onLeave={onLeave} className={start}>
          오늘 공부 시작하기
        </LeaveLink>
      ) : (
        <button type="button" onClick={onClose} className={start}>
          오늘 공부 시작하기
        </button>
      )}
    </>
  );
}

function ResultItem({ number, card, onLeave }: { number: number; card: ResultCard; onLeave: (href: string) => void }) {
  const { section } = card;
  return (
    <li className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[15px] font-semibold">
          {number}. {card.conceptTitle}
        </span>
        <ResultChipLabel chip={card.chip} />
      </div>
      {card.myAnswer !== undefined && (
        <dl className={card.stacked || card.correctAnswer === undefined ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"}>
          <AnswerBox label="내 답" text={card.myAnswer} />
          {card.correctAnswer !== undefined && <AnswerBox label="정답" text={card.correctAnswer} />}
        </dl>
      )}
      {card.explanation !== undefined && (
        <p className="text-sm leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">해설</span> {card.explanation}
        </p>
      )}
      {card.studyLink && section && (
        <LeaveLink
          href={studyHref(section)}
          onLeave={onLeave}
          onOpen={() => recordSectionOpened(card.itemId)}
          className="btn btn-sm self-start"
        >
          공부하러 가기
        </LeaveLink>
      )}
    </li>
  );
}

function AnswerBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0 rounded-md bg-bg px-3 py-2.5">
      <dt className="text-xs font-semibold text-gray">{label}</dt>
      <dd className="mt-1 text-sm break-words">{text}</dd>
    </div>
  );
}
