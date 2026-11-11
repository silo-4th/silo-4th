"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import failSign from "@/app/_assets/mascot-fail.webp";
import { FullPageFail } from "@/app/_components/full-page-fail";
import { STUDY_PATH } from "@/lib/routes";

export function UnitNotFound({ account }: { account: ReactNode }) {
  const router = useRouter();
  return (
    <FullPageFail
      account={account}
      art={
        <span aria-hidden className="mascot h-[99px] w-[139px]">
          <Image src={failSign} alt="" width={224} height={160} draggable={false} />
        </span>
      }
      title="찾을 수 없는 단원이에요"
      description="주소가 바뀌었거나 없는 단원이에요."
      action={{ label: "내 학습으로 가기", onAction: () => router.push(STUDY_PATH) }}
    />
  );
}
