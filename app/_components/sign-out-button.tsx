"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetLearner } from "@/lib/amplitude";
import { authClient, succeeded } from "@/lib/auth/client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    if (await succeeded(authClient.signOut())) {
      resetLearner();
      router.refresh();
      return;
    }
    setFailed(true);
    setPending(false);
  }

  return (
    <>
      <button type="button" role="menuitem" disabled={pending} onClick={signOut} className={className}>
        <LogOut size={15} aria-hidden />
        로그아웃
      </button>
      {failed && (
        <p
          role="alert"
          className="mx-2 mt-1 mb-2 animate-[notice-in_0.25s_ease-out] rounded-sm bg-red-50 px-3 py-2 text-[12.5px] leading-normal font-medium text-red"
        >
          로그아웃하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </>
  );
}
