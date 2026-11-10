"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import face from "@/app/_assets/mascot-plain.png";
import { SignOutButton } from "@/app/_components/sign-out-button";

export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative ml-auto flex-none">
      <button
        ref={buttonRef}
        type="button"
        aria-label="계정 메뉴"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="-mr-1 flex h-10 items-center rounded-full p-1 transition-colors hover:bg-[#2a2c2e]"
      >
        <Avatar className="size-8" />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute top-[calc(100%+6px)] right-0 z-30 w-[260px] rounded-lg border border-line bg-white p-1.5 text-ink shadow-pop"
      >
        <div className="mb-1.5 flex items-center gap-2.5 border-b border-line px-2.5 pt-2 pb-3">
          <Avatar className="size-9" />
          <span>
            <b className="block text-sm">{name}</b>
            <span className="mt-0.5 block text-xs text-gray">로그인됨</span>
          </span>
        </div>
        <SignOutButton className="w-full rounded-md px-2.5 py-[9px] text-left text-[13.5px] font-semibold text-ink-2 transition-colors hover:bg-bg" />
      </div>
    </div>
  );
}

// 확대해서 얼굴만 보여 주므로 원보다 크게 불러와야 흐려지지 않는다.
function Avatar({ className }: { className: string }) {
  return (
    <span className={`avatar ${className}`}>
      <Image src={face} alt="" width={96} height={96} draggable={false} />
    </span>
  );
}
