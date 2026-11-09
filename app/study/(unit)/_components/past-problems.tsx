"use client";

import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mascot } from "@/app/_components/mascot";
import { ResultChipLabel } from "@/app/_components/result-chip";
import { PAST_FILTERS, type PastAttempt, type PastCard, type PastFilter, fetchPastAttempts, pastList } from "@/lib/past-problems";

// 누른 버튼이 사라져 자리를 잃은 키보드와 스크린리더 사용자에게 새로 뜬 요소로 포커스를 옮긴다.
// 탭을 바꿔 다시 그려질 때처럼 패널 밖에서 읽던 자리는 빼앗지 않는다.
// 함수가 그대로여야 React가 다시 그릴 때마다 부르지 않고, 붙을 때 한 번만 부른다.
export function focusOnMount(element: HTMLElement | null) {
  if (!element) return;
  const focused = element.ownerDocument.activeElement;
  const lost = !focused || focused === element.ownerDocument.body || element.closest('[role="tabpanel"]')?.contains(focused);
  if (lost) element.focus();
}

type Loaded ={ kind: "loading" } | { kind: "failed" } | { kind: "loaded"; attempts: PastAttempt[] };

// 열 때마다 새로 받는다. 퀴즈 탭에서 방금 푼 문제도 바로 보여야 한다.
export function PastProblems({ onBack }: { onBack: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [filter, setFilter] = useState<PastFilter>("전체");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void fetchPastAttempts().then((attempts) => {
      if (current) setLoaded(attempts ? { kind: "loaded", attempts } : { kind: "failed" });
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  function retry() {
    setLoaded({ kind: "loading" });
    setAttempt((count) => count + 1);
  }

  return (
    <div className="flex flex-col">
      <button type="button" onClick={onBack} className="btn btn-sm btn-ghost -ml-2 self-start">
        <ChevronLeft size={16} aria-hidden />
        돌아가기
      </button>
      <h2 ref={focusOnMount} tabIndex={-1} className="mt-2 text-[21px] font-bold tracking-tight outline-none">
        지난 문제
      </h2>
      {loaded.kind === "loading" && (
        <div className="flex justify-center pt-8">
          <Mascot size={72} spin />
        </div>
      )}
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className={loaded.kind === "loaded" ? "sr-only" : "pt-2 text-center text-sm text-gray"}>
        {loaded.kind === "loading" && "지난 문제를 불러오고 있어요"}
        {loaded.kind === "failed" && <span className="font-bold text-red">지난 문제를 불러오지 못했어요</span>}
      </p>
      {loaded.kind === "failed" && (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={retry} className="btn btn-sm">
            다시 시도
          </button>
        </div>
      )}
      {loaded.kind === "loaded" && loaded.attempts.length === 0 && (
        <p className="pt-8 text-center text-sm leading-relaxed text-gray">
          아직 푼 확인 문제가 없어요.
          <br />
          문제를 풀면 여기에 모여요.
        </p>
      )}
      {loaded.kind === "loaded" && loaded.attempts.length > 0 && (
        <>
          <div role="group" aria-label="결과로 거르기" className="mt-4 flex flex-wrap gap-1.5">
            {PAST_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={`chip cursor-pointer ${filter === option ? "chip-dark" : ""}`}
              >
                {option}
              </button>
            ))}
          </div>
          <PastList cards={pastList(loaded.attempts, filter)} />
        </>
      )}
    </div>
  );
}

function PastList({ cards }: { cards: PastCard[] }) {
  if (cards.length === 0) return <p className="pt-6 text-center text-sm text-gray">이 결과로 푼 문제가 없어요.</p>;
  return (
    <ul aria-label="지난 문제 목록" className="mt-3 flex flex-col gap-2">
      {cards.map((card) => (
        <li key={card.attemptId}>
          <PastItem card={card} />
        </li>
      ))}
    </ul>
  );
}

// 문제에 표나 SQL이 들어 있어 접힌 동안에는 첫 줄만 보여 주고, 펼치면 마크다운으로 보여 준다.
// 접힌 내용도 문서에 남으므로 한쪽만 그려 같은 문제 글이 두 번 읽히지 않게 한다.
function PastItem({ card }: { card: PastCard }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="card p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none flex-col gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="chip">{card.unitTitle}</span>
          <span className="chip">{card.formatLabel}</span>
          <ResultChipLabel chip={card.chip} />
        </span>
        {!open && <span className="line-clamp-2 text-[14.5px] font-semibold">{previewOf(card.stem)}</span>}
      </summary>
      {open && (
        <>
          <div className="unit-body mt-1 text-[15px] leading-normal font-semibold [&_pre]:text-[12.5px] [&_pre]:font-normal [&>:last-child]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>{card.stem}</Markdown>
          </div>
          <dl className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3 text-[13.5px] leading-relaxed">
            <PastRow label="내 답">
              <span className="whitespace-pre-wrap">{card.myAnswer}</span>
            </PastRow>
            <PastRow label="정답">
              <span className="whitespace-pre-wrap">{card.correctAnswer}</span>
            </PastRow>
            <PastRow label="해설">
              <div className="unit-body text-[13.5px] [&>:last-child]:mb-0">
                <Markdown remarkPlugins={[remarkGfm]}>{card.explanation}</Markdown>
              </div>
            </PastRow>
          </dl>
        </>
      )}
    </details>
  );
}

function previewOf(stem: string) {
  return stem.split("\n").find((line) => line.trim() !== "") ?? stem;
}

function PastRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
