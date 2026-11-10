import Image from "next/image";
import type { ReactNode } from "react";
import logo from "@/app/_assets/pluck-logo.svg";

// children은 헤더 오른쪽 끝에 둔다. 로그인한 학습자가 보는 화면은 계정 메뉴를 넣는다.
export function BrandHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="flex h-[60px] items-center justify-between px-6">
        <Image src={logo} alt="Pluck" height={26} className="h-[26px] w-auto" draggable={false} preload />
        {children}
      </div>
    </header>
  );
}
