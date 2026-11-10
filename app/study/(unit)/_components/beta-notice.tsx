"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

// 확인이나 Esc로 닫으면 close 이벤트가 오고, 브라우저가 모달을 열기 전 버튼으로 포커스를 돌려준다.
export function BetaNotice({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(320px,calc(100%-32px))] rounded-2xl bg-white p-6 text-center text-ink backdrop:bg-[rgba(18,19,20,0.35)]"
    >
      <h2 id={titleId} className="text-[19px] font-bold tracking-tight">
        아직 베타 단계예요
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-gray">{children}</p>
      <form method="dialog" className="mt-5">
        <button type="submit" className="btn btn-dark btn-lg btn-block">
          확인
        </button>
      </form>
    </dialog>
  );
}
