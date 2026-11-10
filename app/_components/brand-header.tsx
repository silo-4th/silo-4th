import Image from "next/image";
import type { ReactNode } from "react";
import logo from "@/app/_assets/logo.svg";

// children은 헤더 오른쪽 끝에 둔다. 꺼내 먹기는 계정 메뉴를 넣는다.
export function BrandHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="flex h-[60px] items-center justify-between px-6">
        <span className="inline-flex items-center gap-1.5 text-[22px] font-extrabold tracking-[-0.04em] text-green">
          <Image src={logo} alt="" width={24} height={24} />
          sprout
        </span>
        {children}
      </div>
    </header>
  );
}
