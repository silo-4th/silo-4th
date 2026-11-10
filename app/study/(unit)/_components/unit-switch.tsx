"use client";

import { useParams } from "next/navigation";
import { type ReactNode, createContext, use, useEffect, useState } from "react";

type Target = { id: string; title: string };

type UnitSwitchState = {
  // 누른 단원의 본문이 아직 오지 않았다. 주소가 그 단원으로 바뀌면 끝난다.
  pending?: Target;
  // 주소는 바뀌었지만 본문을 아직 받는 중일 때 보여 줄 제목이다.
  arriving?: string;
  begin: (target: Target | undefined) => void;
};

const UnitSwitchContext = createContext<UnitSwitchState>({ begin: () => {} });

// 단원 페이지는 본문을 서버에서 받아 그리므로, 받는 동안 누른 단원의 제목과 본문 뼈대를 먼저 보여 준다.
export function UnitSwitch({ children }: { children: ReactNode }) {
  const { unitId } = useParams<{ unitId?: string }>();
  const [to, setTo] = useState<Target>();
  const [shownUnit, setShownUnit] = useState(unitId);
  // 뒤로 가기처럼 누른 단원이 아닌 곳으로 옮기면 기다리던 전환을 버린다.
  if (unitId !== shownUnit) {
    setShownUnit(unitId);
    if (to && to.id !== unitId) setTo(undefined);
  }
  // 뒤로 가기로 같은 단원의 다른 기록으로 가면 단원은 그대로라 위에서 지워지지 않는다. 이때 Next는 기다리던 이동을 버린다.
  useEffect(() => {
    const cancel = () => setTo(undefined);
    window.addEventListener("popstate", cancel);
    return () => window.removeEventListener("popstate", cancel);
  }, []);
  const state: UnitSwitchState = {
    pending: to && to.id !== unitId ? to : undefined,
    arriving: to && to.id === unitId ? to.title : undefined,
    begin: setTo,
  };
  return <UnitSwitchContext value={state}>{children}</UnitSwitchContext>;
}

export function useBeginUnitSwitch() {
  return use(UnitSwitchContext).begin;
}

export function UnitTitle({ children }: { children: string }) {
  const { pending } = use(UnitSwitchContext);
  return <span className="min-w-0 truncate text-base font-bold">{pending?.title ?? children}</span>;
}

export function UnitPending({ children }: { children: ReactNode }) {
  const { pending } = use(UnitSwitchContext);
  // 이동을 취소하면 읽던 자리로 돌아오도록 본문을 지우지 않고 가린 채 그 위에 뼈대를 덮는다.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div inert={pending !== undefined} className={`flex min-h-0 flex-1 flex-col ${pending ? "invisible" : ""}`}>
        {children}
      </div>
      {pending && (
        <div className="absolute inset-0 flex flex-col">
          <UnitSkeleton title={pending.title} />
        </div>
      )}
    </div>
  );
}

// 주소가 바뀐 뒤 본문이 스트리밍되는 동안 페이지 자리를 채운다.
export function UnitLoading() {
  const { pending, arriving } = use(UnitSwitchContext);
  const title = pending?.title ?? arriving;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-3.5 bg-player px-4 text-white">
        <span className="size-9 flex-none" />
        {title && <span className="min-w-0 truncate text-base font-bold">{title}</span>}
      </header>
      <UnitSkeleton title={title} />
    </div>
  );
}

const TOC_WIDTHS = [44, 92, 80, 96, 84];

function UnitSkeleton({ title }: { title?: string }) {
  const lines = (widths: number[]) =>
    widths.map((width, index) => <i key={index} className="skel h-3.5" style={{ width: `${width}%` }} />);
  return (
    <article className="min-h-0 flex-1 overflow-y-auto">
      <div aria-hidden className="sticky top-0 z-[2] border-b border-line-2 bg-white/92 backdrop-blur-[6px]">
        <div className="mx-auto flex max-w-[760px] gap-5.5 px-10 max-[860px]:px-5">
          {TOC_WIDTHS.map((width, index) => (
            <span key={index} className="flex h-11 flex-none items-center">
              <i className="skel h-3" style={{ width }} />
            </span>
          ))}
        </div>
      </div>
      <div className="unit-body reader">
        {title && <h1>{title}</h1>}
        <p role="status" className="sr-only">
          본문을 불러오고 있어요
        </p>
        <div aria-hidden className="mt-6 flex flex-col">
          <div className="flex flex-col gap-3">{lines([100, 97, 92, 58])}</div>
          <i className="skel mt-10 mb-4 h-5 w-[34%]" />
          <div className="flex flex-col gap-3">{lines([100, 94, 71])}</div>
          <i className="skel mt-6 h-42 rounded-md" />
          <i className="skel mt-10 mb-4 h-5 w-[34%]" />
          <div className="flex flex-col gap-3">{lines([100, 96, 89, 64])}</div>
        </div>
      </div>
    </article>
  );
}
