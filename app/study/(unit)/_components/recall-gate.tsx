"use client";

import { Check, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import cookieCloud from "@/app/_assets/cookie-cloud.webp";
import grin from "@/app/_assets/mascot-grin.png";
import cookie from "@/app/_assets/mascot-cookie.webp";
import cookieWantFrown from "@/app/_assets/mascot-cookie-want-frown.webp";
import cookieWant from "@/app/_assets/mascot-cookie-want.webp";
import think from "@/app/_assets/mascot-o.png";
import { ResultChipLabel } from "@/app/_components/result-chip";
import { recallIntroProps, recallResultProps } from "@/lib/analytics";
import { track } from "@/lib/amplitude";
import { type Solved, sendAttempt, shownStem } from "@/lib/quiz-card";
import {
  RECALL_PREP_STEPS,
  type PrepStepState,
  type RecallAnswer,
  type RecallFlow,
  type RecallFlowEvent,
  advanceRecall,
  entryOf,
  isLastProblem,
  openTodayRecall,
  prepStepsAt,
  recordRecallEvent,
  skippedRequest,
  startRecall,
  unsavedItems,
} from "@/lib/recall-flow";
import { type ResultCard, resultCards, resultSubtitle, resultTitle, studyHref } from "@/lib/recall-result";
import type { RecallSetView } from "@/lib/recall-sets";
import { RecallProblem, sqlClass } from "./recall-problem";

type RecallItemView = RecallSetView["items"][number];
type ProblemFlow = Extract<RecallFlow, { stage: "problem" }>;

// leavingFrom은 결과에서 다른 단원으로 떠날 때의 주소다. 주소가 바뀌면 학습 화면을 그린다.
type Gate =
  | { stage: "checking" }
  | { stage: "recall"; set: RecallSetView; leavingFrom?: string }
  | { stage: "study" };

// 하루 첫 진입에 꺼내 먹기를 띄운다. 확인이 끝날 때까지 학습 화면을 그리지 않아, 꺼내 먹기 뒤에서 본 절 기록이 쌓이지 않게 한다.
// 레이아웃에 두어 단원을 옮겨도 다시 확인하지 않는다.
export function RecallGate({ children, header }: { children: ReactNode; header: ReactNode }) {
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
    <main aria-label="꺼내 먹기" className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg text-ink">
      {header}
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
  problem: (flow) => (flow.stage === "problem" ? `${flow.index + 1} / ${flow.set.items.length} 문제` : "문제"),
  result: () => "꺼내 먹기 결과",
};

// 마지막 문항을 넘기면 쿠키가 막대 끝의 플러키에게 건너간 뒤 결과를 연다.
const HANDOFF_MS = 1300;

// 누른 버튼이 단계와 함께 사라지므로, 키보드와 스크린리더 사용자가 자리를 잃지 않게 새 단계로 포커스를 옮긴다.
// 빈칸 입력칸처럼 단계 안에서 먼저 포커스를 받은 요소는 그대로 두고, 새 단계는 화면 맨 위부터 보여 준다.
// 단계마다 key가 바뀌어 새로 붙을 때만 불린다.
function focusStep(element: HTMLElement | null) {
  if (!element) return;
  element.closest("main")?.scrollTo({ top: 0 });
  if (!element.contains(element.ownerDocument.activeElement)) element.focus({ preventScroll: true });
}

type Exits = { onClose: () => void; onLeave: (href: string) => void };

function RecallScreen({ set, onClose, onLeave }: { set: RecallSetView } & Exits) {
  const [flow, setFlow] = useState<RecallFlow>(() => startRecall(set));
  const [handoff, setHandoff] = useState(false);
  const [saving, setSaving] = useState(false);

  function send(event: RecallFlowEvent) {
    const next = advanceRecall(flow, event);
    if (next === flow) return;
    // 시작 기록이 빠진 채 모든 문항을 푼 세트는 입구에서 결과로 바로 가므로, 입구를 떠날 때마다 시작을 보낸다.
    if (flow.stage === "entry") recordRecallEvent(set.id, "start");
    if (next.stage === "result") recordRecallEvent(set.id, "complete");
    if (flow.stage === "problem" && next.stage === "result") {
      setHandoff(true);
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(
        () => {
          setFlow(next);
          setHandoff(false);
        },
        calm ? 0 : HANDOFF_MS,
      );
      return;
    }
    setFlow(next);
  }

  // 저장하는 동안 같은 요청을 두 번 보내지 않는다. 상태는 다음 렌더에야 바뀌므로 ref로 막는다.
  const pending = useRef(false);

  async function whileSaving<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (pending.current) return undefined;
    pending.current = true;
    setSaving(true);
    try {
      return await work();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  // 문항 하나를 넘긴다. 마지막 문항이면 결과로 가기 전에 풀이가 없는 문항을 마저 저장한다.
  function moveOn(problem: ProblemFlow, answer: RecallAnswer) {
    if (isLastProblem(problem)) {
      void finish(problem, answer);
      return;
    }
    send(answer.kind === "answered" ? { type: "answered", submitted: answer.submitted, ...(answer.result && { result: answer.result }) } : { type: "skip" });
  }

  // 건너뛴 문항은 잘 모르겠어요 풀이로 저장한다. 저장하지 못하면 풀이 없이 넘기고, 결과로 갈 때 다시 저장한다.
  async function skip(problem: ProblemFlow, item: RecallItemView) {
    const answer = await whileSaving(() => saveSkipped(item));
    if (answer) moveOn(problem, answer);
  }

  // 결과로 가기 전에 풀이가 없는 문항을 모두 건너뛴 것으로 저장한다. current는 지금 문항의 답이라 다시 저장하지 않는다.
  async function finish(problem: ProblemFlow, current?: RecallAnswer) {
    const rest = unsavedItems(problem).filter((item) => item.id !== current?.itemId);
    const answers = await whileSaving(() => Promise.all(rest.map(saveSkipped)));
    if (!answers) return;
    const saved = answers.filter((answer) => answer.kind === "answered");
    send({ type: "finish", saved: current ? [current, ...saved] : saved });
  }

  function postpone() {
    track("recall_later_click", { set_id: set.id });
    recordRecallEvent(set.id, "postpone");
    onClose();
  }

  return (
    <div className="recall">
      <section className="recall-frame">
        {flow.stage === "problem" && <Steps flow={flow} handoff={handoff} />}
        <div className="recall-body">
          <section
            key={flow.stage === "problem" ? `problem-${flow.index}` : flow.stage}
            ref={focusStep}
            tabIndex={-1}
            aria-label={STEP_LABEL[flow.stage](flow)}
            inert={handoff}
            className="recall-col focus:outline-none"
          >
            {flow.stage === "entry" && (
              <Entry
                set={set}
                onStart={() => {
                  track("recall_start_click", { set_id: set.id });
                  send({ type: "start" });
                }}
                onLater={postpone}
              />
            )}
            {flow.stage === "problem" && <Problem flow={flow} busy={saving} onMove={moveOn} onSkip={skip} onFinish={finish} />}
            {flow.stage === "result" && <Result flow={flow} onClose={onClose} onLeave={onLeave} />}
          </section>
        </div>
      </section>
    </div>
  );
}

// 채점처럼 실패하면 같은 풀이 ID로 한 번 더 보낸다. 서버는 같은 풀이를 한 줄만 남긴다.
async function saveSkipped(item: RecallItemView): Promise<RecallAnswer> {
  const request = skippedRequest(item);
  const result = (await sendAttempt(request)) ?? (await sendAttempt(request));
  return result ? { itemId: item.id, kind: "answered", submitted: request, result } : { itemId: item.id, kind: "skipped" };
}

// 진행 막대 아래로 쿠키 구름이 지금 문제까지 따라오고, 막대 끝에서 배고픈 플러키가 기다린다.
function Steps({ flow, handoff }: { flow: ProblemFlow; handoff: boolean }) {
  const total = flow.set.items.length;
  const at = flow.index;
  const shift = handoff ? -7 : at === 0 ? 13 : 0;
  return (
    <div className="recall-steps-wrap">
      <div className="recall-steps" role="progressbar" aria-label="꺼내 먹기 진행" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at + 1}>
        {flow.set.items.map((item, index) => (
          <i key={item.id} className={index < at ? "on" : index === at ? "now" : ""} />
        ))}
      </div>
      <span aria-hidden className="recall-cookie-runner" style={{ transform: `translateX(calc(${(handoff ? 1 : at / total) * 100}% + ${shift}px))` }}>
        <span className={`recall-cookie-bubble ${handoff ? "given" : ""}`}>
          <Image src={cookieCloud} alt="" width={44} height={39} draggable={false} />
        </span>
      </span>
      <span aria-hidden className={`recall-steps-pluck ${handoff ? "got" : ""}`}>
        <span className="mascot" style={{ width: 30, height: 30 }}>
          <Image src={handoff ? grin : think} alt="" width={30} height={30} draggable={false} />
        </span>
      </span>
    </div>
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
    <div className="recall">
      <section className="recall-frame">
        <div className="recall-body">
          <div role="status" className="recall-col">
            <IntroHead title="어제 공부한 내용을 챙기고 있어요" />
            <ol className="recall-list recall-list--info">
              {RECALL_PREP_STEPS.map(({ label }, index) => (
                <PrepStep key={label} label={label} state={states[index] ?? "wait"} />
              ))}
            </ol>
            <IntroActions />
          </div>
        </div>
      </section>
    </div>
  );
}

const PREP_SPOKEN: Record<PrepStepState, string> = { done: " 완료", now: " 진행 중", wait: "" };

function PrepStep({ label, state }: { label: string; state: PrepStepState }) {
  return (
    <li aria-atomic className={`recall-row recall-prep-step ${state}`}>
      <span aria-hidden className="recall-prep-mark">
        {state === "done" && <Check size={12} strokeWidth={3} />}
      </span>
      {label}
      <span className="sr-only">{PREP_SPOKEN[state]}</span>
    </li>
  );
}

// 꺼내 먹기를 마치면 쿠키를 받는 이야기가 여기서 시작한다. 시무룩한 입은 원본 위에 덮는 조각이라 두 그림 모두 다시 압축하지 않는다.
function IntroHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <span aria-hidden className="mascot recall-intro-art">
        <span className="recall-want-bob">
          <Image src={cookieWant} alt="" width={136} height={110} draggable={false} unoptimized loading="eager" />
          <Image src={cookieWantFrown} alt="" width={136} height={110} draggable={false} unoptimized className="recall-want-frown" />
          <i className="recall-want-droop l" />
          <i className="recall-want-droop r" />
          <i className="mascot-lid l" />
          <i className="mascot-lid r" />
        </span>
      </span>
      <h1 className="recall-title recall-intro-center">{title}</h1>
      <p className="recall-sub recall-intro-center min-h-[1.6em]">{sub}</p>
    </>
  );
}

// 준비 중에는 버튼을 숨기되 자리는 남겨, 준비가 끝나 버튼이 나타나도 아래가 밀리지 않는다.
function IntroActions({ onStart, onLater }: { onStart?: () => void; onLater?: () => void }) {
  const ready = onStart !== undefined;
  return (
    <div aria-hidden={!ready} className="recall-cta recall-intro-cta">
      <button type="button" onClick={onStart} tabIndex={ready ? undefined : -1} className="btn btn-dark btn-lg btn-block">
        시작하기
      </button>
      <button type="button" onClick={onLater} tabIndex={ready ? undefined : -1} className="recall-later">
        내일 꺼내 먹을래요
      </button>
    </div>
  );
}

function Entry({ set, onStart, onLater }: { set: RecallSetView; onStart: () => void; onLater: () => void }) {
  // 시안처럼 질문 없이 넘어간 개념을 먼저 보여 준다.
  useEffect(() => {
    track("recall_intro_view", { set_id: set.id, ...recallIntroProps(set.items) });
  }, [set]);
  const rows = [...entryOf(set.items).rows].sort((a, b) => Number(a.reason === "물어봄") - Number(b.reason === "물어봄"));
  return (
    <>
      <IntroHead title={`지난번에 공부한 것 중 ${rows.length}개를 꺼내 볼게요`} sub={`${rows.length}개를 꺼내 보면 플러키에게 쿠키를 줄 수 있어요`} />
      <ul className="recall-list recall-list--info">
        {rows.map((row, index) => (
          <li key={row.id} className="recall-row recall-row-in" style={{ animationDelay: `${index * 90}ms` }}>
            <span className={`chip ${row.reason === "물어봄" ? "chip-green" : "chip-red"}`}>{row.reason}</span>
            <span className="recall-row-name">{row.conceptTitle}</span>
            {row.unitTitle && <span className="recall-row-src">{row.unitTitle}</span>}
          </li>
        ))}
      </ul>
      <IntroActions onStart={onStart} onLater={onLater} />
    </>
  );
}

function Problem({
  flow,
  busy,
  onMove,
  onSkip,
  onFinish,
}: {
  flow: ProblemFlow;
  busy: boolean;
  onMove: (flow: ProblemFlow, answer: RecallAnswer) => void;
  onSkip: (flow: ProblemFlow, item: RecallItemView) => Promise<void>;
  onFinish: (flow: ProblemFlow, current?: RecallAnswer) => Promise<void>;
}) {
  const item = flow.set.items[flow.index];
  const setId = flow.set.id;
  const position = flow.index + 1;
  useEffect(() => {
    if (!item) return;
    track("recall_question_view", { set_id: setId, item_id: item.id, position, format: item.problem.format, reason: item.reason });
  }, [setId, item, position]);
  if (!item) return null;
  const answerOf = (solved: Solved): RecallAnswer => ({ itemId: item.id, kind: "answered", ...solved });
  return (
    <RecallProblem
      key={item.id}
      item={item}
      last={isLastProblem(flow)}
      busy={busy}
      onSolved={(solved) => onMove(flow, answerOf(solved))}
      onSkip={() => {
        track("recall_question_skip_click", { set_id: setId, item_id: item.id, position });
        void onSkip(flow, item);
      }}
      onFinish={(current) => void onFinish(flow, current && answerOf(current))}
    />
  );
}

// 링크로 두어 새 탭으로도 열 수 있게 하고, 이 화면에서 옮길 때만 주소가 바뀐 뒤 꺼내 먹기를 닫는다.
function LeaveLink({ href, onLeave, className, children }: { href: string; onLeave: (href: string) => void; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
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
  // 결과 단계의 flow는 화면이 떠 있는 동안 바뀌지 않아, 결과가 보일 때 한 번만 보낸다.
  useEffect(() => {
    track("recall_result_view", { set_id: flow.set.id, ...recallResultProps(resultCards(flow.set, flow.answers)) });
  }, [flow]);
  // 공부하러 가기는 결과 화면에서 빠져 있어 누른 수가 늘 0이다. 버튼을 다시 두면 recall_study_click과 함께 센다.
  const finished = () => track("recall_finish_click", { set_id: flow.set.id, study_click_count: 0 });
  const start = "btn btn-dark btn-lg btn-block";
  return (
    <>
      <div className="recall-reward">
        <p className="recall-reward-msg">
          <span aria-hidden>🍪</span>플러키에게 쿠키를 전달했어요!
        </p>
        <div className="recall-cookie">
          <div className="recall-cookie-float">
            <Image src={cookie} alt="쿠키를 먹는 플러키" width={139} height={138} draggable={false} />
          </div>
        </div>
      </div>
      <h1 className="recall-title">{resultTitle(cards)}</h1>
      <p className="recall-sub">{resultSubtitle(cards)}</p>
      <ol className="recall-list">
        {cards.map((card, index) => (
          <ResultItem key={card.itemId} number={index + 1} card={card} />
        ))}
      </ol>
      <div className="recall-cta">
        {studyFrom ? (
          <LeaveLink
            href={studyHref(studyFrom)}
            onLeave={(href) => {
              finished();
              onLeave(href);
            }}
            className={start}
          >
            오늘 공부 시작하기
          </LeaveLink>
        ) : (
          <button
            type="button"
            onClick={() => {
              finished();
              onClose();
            }}
            className={start}
          >
            오늘 공부 시작하기
          </button>
        )}
        <p className="subtle recall-foot">헷갈린 개념은 복습 일정에 넣어 두었어요. 며칠 뒤 같은 원리의 새 문제로 다시 나와요.</p>
      </div>
    </>
  );
}

const LETTERS = ["A", "B", "C", "D"];

// 번호 뒤 점을 이스케이프해 순서 목록이 되지 않게 한다. 지문이 코드 블록으로 시작하면 번호를 따로 한 줄에 둔다.
function numbered(number: number, stem: string): string {
  return stem.trimStart().startsWith("```") ? `${number}\\.\n\n${stem}` : `${number}\\. ${stem}`;
}

// 시안처럼 개념 배지와 상태 칩 아래에 번호 붙은 지문을 두고, 객관식은 보기 전체에, 나머지는 내 답과 정답 상자에 표시한다.
function ResultItem({ number, card }: { number: number; card: ResultCard }) {
  return (
    <li className="recall-res">
      <div className="quiz-history-q-head">
        <span className="chip recall-from">{card.conceptTitle}</span>
        <ResultChipLabel chip={card.chip} />
      </div>
      <div className="quiz-history-stem recall-md">
        <Markdown remarkPlugins={[remarkGfm]}>{numbered(number, shownStem(card.stem))}</Markdown>
      </div>
      {card.choices ? (
        <div className="opts">
          {card.choices.map((choice, index) => (
            <div key={index} className={`opt ${choice.mark} quiz-history-opt`}>
              <span className="k" aria-hidden>
                {choice.mark === "right" ? <Check size={12} /> : choice.mark === "wrong" ? <X size={12} /> : LETTERS[index]}
              </span>
              <span className={sqlClass(choice.text)}>{choice.text}</span>
              {(choice.mark === "right" || choice.mine) && (
                <span className="quiz-history-mine">{choice.mark === "right" ? "정답" : "내 답"}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        card.myAnswer !== undefined && (
          <dl className={`recall-compare ${card.stacked ? "stack" : ""}`}>
            <div className="mine">
              <dt>내 답</dt>
              <dd className="recall-compare-text">{card.myAnswer || "—"}</dd>
            </div>
            {card.correctAnswer !== undefined && (
              <div className="right">
                <dt>정답</dt>
                <dd className="recall-compare-text">{card.correctAnswer}</dd>
              </div>
            )}
          </dl>
        )
      )}
      {card.explanation !== undefined && (
        <div className="recall-why">
          <span>해설</span>
          <div className="recall-compare-text recall-md">
            <Markdown remarkPlugins={[remarkGfm]}>{card.explanation}</Markdown>
          </div>
        </div>
      )}
    </li>
  );
}
