"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type Unit = { id: string; title: string };

export function UnitRail({ units, currentId }: { units: Unit[]; currentId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        aria-label="강의 목록"
        title="강의 목록"
        aria-expanded={open}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="-ml-1.5 grid size-9 flex-none place-items-center rounded-full text-[#e9ecef] transition-colors hover:bg-[#2a2c2e] hover:text-white aria-expanded:bg-[#2a2c2e]"
      >
        <MenuIcon />
      </button>
      {/* 열린 레일 바깥은 ::backdrop이라 dialog 자신이 클릭을 받는다. */}
      <dialog
        ref={dialogRef}
        aria-label="강의 목록"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="fixed top-14 bottom-0 left-0 m-0 h-auto max-h-none w-[300px] max-w-none flex-col border-r border-[#3a3c3e] bg-[#26282a] text-[#e9ecef] backdrop:bg-[rgba(18,19,20,0.35)] open:flex"
      >
        <div className="flex h-12 flex-none items-center justify-between pr-2.5 pl-5 text-[13px] font-bold text-gray-3">
          <span>강의 목록</span>
          <button
            type="button"
            aria-label="강의 목록 닫기"
            onClick={close}
            className="grid size-8 place-items-center rounded-full hover:bg-[#3a3c3e] hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label="단원" className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-8">
          <ol className="flex flex-col gap-5">
            {units.map(({ id, title }, index) => (
              <li key={id}>
                <Link
                  href={`/study/${id}`}
                  aria-current={id === currentId ? "page" : undefined}
                  onClick={close}
                  className="group flex aspect-[16/7] flex-col justify-end rounded-md bg-[#3a3d41] p-3 text-[17px] leading-tight font-extrabold tracking-[-0.03em] text-white outline-3 outline-offset-3 outline-transparent transition-[outline-color] hover:outline-green focus-visible:outline-white aria-[current=page]:bg-green-600"
                >
                  <span>
                    <span aria-hidden="true">{index + 1}. </span>
                    {title}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </dialog>
    </>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
