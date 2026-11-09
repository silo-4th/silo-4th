"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { QuizCard } from "@/app/_components/quiz-card";
import {
  type RecallFlow,
  type RecallFlowEvent,
  advanceRecall,
  entryOf,
  openTodayRecall,
  progressOf,
  recordRecallEvent,
  startRecall,
} from "@/lib/recall-flow";
import type { RecallSetView } from "@/lib/recall-sets";

type Gate = { stage: "checking" } | { stage: "recall"; set: RecallSetView } | { stage: "study" };

// 하루 첫 진입에 꺼내 먹기를 띄운다. 확인이 끝날 때까지 학습 화면을 그리지 않아, 꺼내 먹기 뒤에서 본 절 기록이 쌓이지 않게 한다.
// 레이아웃에 두어 단원을 옮겨도 다시 확인하지 않는다.
export function RecallGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ stage: "checking" });
  // 오늘 세트는 한 번만 받을 수 있다. 개발 모드에서 효과가 두 번 돌아도 요청은 한 번만 보낸다.
  const opened = useRef<Promise<RecallSetView | null>>(null);

  useEffect(() => {
    let active = true;
    opened.current ??= openTodayRecall();
    void opened.current.then((set) => {
      if (active) setGate(set ? { stage: "recall", set } : { stage: "study" });
    });
    return () => {
      active = false;
    };
  }, []);

  if (gate.stage === "study") return children;
  return (
    <main aria-label="꺼내 먹기" aria-busy={gate.stage === "checking"} className="fixed inset-0 z-50 overflow-y-auto bg-white text-ink">
      {gate.stage === "checking" ? (
        <p role="status" className="grid h-full place-items-center text-[15px] font-semibold text-gray">
          어제 공부한 내용을 챙기고 있어요
        </p>
      ) : (
        <RecallScreen set={gate.set} onClose={() => setGate({ stage: "study" })} />
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

function RecallScreen({ set, onClose }: { set: RecallSetView; onClose: () => void }) {
  const [flow, setFlow] = useState<RecallFlow>(() => startRecall(set));

  function send(event: RecallFlowEvent) {
    const next = advanceRecall(flow, event);
    if (next === flow) return;
    if (next.stage === "problem" && flow.stage === "entry") recordRecallEvent(set.id, "start");
    if (next.stage === "result") recordRecallEvent(set.id, "complete");
    setFlow(next);
  }

  function postpone() {
    recordRecallEvent(set.id, "postpone");
    onClose();
  }

  return (
    <>
      <header className="sticky top-0 flex h-14 items-center justify-between border-b border-line bg-white px-6">
        <span className="text-[15px] font-bold">꺼내 먹기</span>
        <span className="text-sm font-semibold text-gray">{progressOf(flow)}</span>
      </header>
      <section
        key={flow.stage === "problem" ? `problem-${flow.index}` : flow.stage}
        ref={focusStep}
        tabIndex={-1}
        aria-label={STEP_LABEL[flow.stage](flow)}
        className="mx-auto flex w-full max-w-[560px] flex-col px-4 py-10 focus:outline-none"
      >
        {flow.stage === "entry" && <Entry set={set} onStart={() => send({ type: "start" })} onLater={postpone} />}
        {flow.stage === "problem" && <Problem flow={flow} send={send} />}
        {flow.stage === "result" && <Finished onClose={onClose} />}
      </section>
    </>
  );
}

function Entry({ set, onStart, onLater }: { set: RecallSetView; onStart: () => void; onLater: () => void }) {
  const { rows, summary } = entryOf(set.items);
  return (
    <>
      <h1 className="text-[22px] leading-snug font-bold">지난번에 공부한 것 중 {rows.length}개를 꺼내 볼게요</h1>
      <p className="mt-2 text-sm text-gray">{summary}</p>
      <ul className="mt-6 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="card flex items-center gap-2.5 px-4 py-3.5">
            <span className={`chip ${row.reason === "물어봄" ? "chip-green" : "chip-red"}`}>{row.reason}</span>
            <span className="text-[15px] font-semibold">{row.conceptTitle}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onStart} className="btn btn-dark btn-lg btn-block mt-8">
        시작하기
      </button>
      <button type="button" onClick={onLater} className="mt-3 self-center text-sm font-medium text-gray hover:text-ink-2">
        내일 꺼내 먹을래요
      </button>
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
  const last = flow.index === flow.set.items.length - 1;
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

// 결과 화면은 4-34에서 만든다. 지금은 마쳤다는 것만 알리고 학습 화면으로 돌려보낸다.
function Finished({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h1 className="text-[22px] font-bold">꺼내 먹기를 마쳤어요</h1>
      <button type="button" onClick={onClose} className="btn btn-dark btn-lg btn-block mt-8">
        학습하러 가기
      </button>
    </>
  );
}
