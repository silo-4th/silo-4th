"use client";

import { ChevronDown, ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; attempts: PastAttempt[] };

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
      {/* 패널 안쪽 여백을 넘어 패널 너비 전체에 아래 선을 긋고, 목록을 내려도 패널 맨 위에 남긴다. */}
      <div className="sticky -top-5 z-10 -mx-5 -mt-5 flex h-[46.5px] flex-none items-center gap-1 border-b border-line-2 bg-white px-2.5">
        <button type="button" aria-label="돌아가기" title="돌아가기" onClick={onBack} className="tool-btn flex-none">
          <ChevronLeft size={20} aria-hidden />
        </button>
        <h2
          ref={focusOnMount}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-center text-base font-bold tracking-[-0.02em] text-ink outline-none"
        >
          지난 문제
        </h2>
        <span aria-hidden className="w-[34px] flex-none" />
      </div>
      {loaded.kind === "loading" && (
        <div aria-hidden className="mt-2 flex flex-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-2 border-t border-line-2 py-5 first:border-t-0">
              <span className="h-3.5 w-2/5 animate-pulse rounded bg-line-2" />
              <span className="h-3 w-3/5 animate-pulse rounded bg-line-2" />
            </div>
          ))}
        </div>
      )}
      {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 글만 바꾼다. */}
      <p role="status" className={loaded.kind === "failed" ? "pt-6 text-center text-sm" : "sr-only"}>
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
        <p className="pt-4 text-[13px] leading-relaxed text-gray">아직 푼 확인 문제가 없어요. 문제를 풀면 여기에 모여요.</p>
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
  if (cards.length === 0) return <p className="pt-6 text-[13px] text-gray">이 결과로 푼 문제가 없어요.</p>;
  return (
    <ul aria-label="지난 문제 목록" className="mt-2 flex flex-col pb-10">
      {cards.map((card) => (
        <li key={card.attemptId} className="border-t border-line-2 py-5 first:border-t-0">
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
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none flex-col gap-2.5">
        <span className="flex items-center gap-1.5">
          <span className="chip h-6 min-w-0 rounded-sm">
            <span className="truncate">{card.unitTitle}</span>
          </span>
          <span className="chip h-6 flex-none rounded-sm">{card.formatLabel}</span>
          <span className="ml-auto flex flex-none items-center gap-1">
            <ResultChipLabel chip={card.chip} />
            <ChevronDown size={16} aria-hidden className={`text-gray transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </span>
        {!open && <span className="line-clamp-2 text-[15px] leading-normal font-bold text-ink">{previewOf(card.stem)}</span>}
      </summary>
      {open && (
        <>
          <div className="unit-body mt-2.5 text-[15px] leading-normal font-bold text-ink [&_pre]:text-[12.5px] [&_pre]:font-normal [&>:last-child]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>{card.stem}</Markdown>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <AnswerBox label="내 답">{card.myAnswer}</AnswerBox>
            <AnswerBox label="정답" right>
              {card.correctAnswer}
            </AnswerBox>
          </dl>
          <dl className="mt-2 rounded-md border border-line px-3.5 py-3">
            <dt className="mb-1 text-xs font-bold text-gray">해설</dt>
            <dd className="unit-body text-[13.5px] leading-relaxed text-ink-2 [&>:last-child]:mb-0">
              <Markdown remarkPlugins={[remarkGfm]}>{card.explanation}</Markdown>
            </dd>
          </dl>
        </>
      )}
    </details>
  );
}

function previewOf(stem: string) {
  return stem.split("\n").find((line) => line.trim() !== "") ?? stem;
}

function AnswerBox({ label, right = false, children }: { label: string; right?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-md px-3.5 py-3 ${right ? "bg-green-25" : "bg-bg"}`}>
      <dt className={`mb-1 text-xs font-bold ${right ? "text-green-600" : "text-gray"}`}>{label}</dt>
      <dd className={`text-[13.5px] leading-relaxed break-words whitespace-pre-wrap ${right ? "font-semibold text-ink" : "text-ink-2"}`}>
        {children}
      </dd>
    </div>
  );
}
