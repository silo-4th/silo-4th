"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import face from "@/app/_assets/mascot-plain.png";
import { SignOutButton } from "@/app/_components/sign-out-button";

// 어두운 학습 헤더에서만 마우스를 올리면 아바타 둘레를 밝힌다. 흰 헤더는 light로 그린다.
export function AccountMenu({ name, light = false }: { name: string; light?: boolean }) {
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
        aria-label={`${name}(으)로 로그인됨, 계정 메뉴`}
        title={`${name} · 로그인됨`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={`-mr-1 inline-flex h-10 items-center rounded-full p-1 transition-[background-color] duration-150 ease-[ease] ${light ? "" : "hover:bg-[#2a2c2e]"}`}
      >
        <Avatar className="size-8" />
      </button>
      {/* 닫을 때 메뉴를 지워야 로그아웃 실패 안내가 다음에 열 때 남지 않는다. */}
      {open && (
        <div id={menuId} role="menu" aria-label="계정" className="tone-menu text-ink">
          <div className="mb-1.5 flex items-center gap-2.5 border-b border-line px-2.5 pt-2 pb-3">
            <Avatar className="size-9" />
            <span>
              <b className="block text-sm leading-normal">{name}</b>
              <span className="mt-0.5 block text-xs leading-[1.4] text-gray">로그인됨</span>
            </span>
          </div>
          <SignOutButton className="flex w-full items-center gap-2 rounded-md px-2.5 py-[9px] text-left text-[13.5px] font-semibold tracking-normal text-ink-2 transition-[background-color] duration-150 ease-[ease] hover:bg-bg focus-visible:-outline-offset-2" />
        </div>
      )}
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
