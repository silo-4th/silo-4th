import type { Metadata } from "next";
import Image from "next/image";
import failSign from "@/app/_assets/mascot-fail.webp";
import { FullPageFail } from "@/app/_components/full-page-fail";

export const metadata: Metadata = {
  title: "PC에서 열어 주세요",
};

// 모바일로 들어오면 `proxy.ts`가 주소는 그대로 두고 이 화면을 보여 준다.
export default function MobileNotice() {
  return (
    <FullPageFail
      art={
        <span aria-hidden className="mascot h-[99px] w-[139px]">
          <Image src={failSign} alt="" width={224} height={160} draggable={false} preload />
        </span>
      }
      title="PC에서 열어 주세요"
      description="이 서비스는 PC 브라우저에서만 쓸 수 있어요."
    />
  );
}
