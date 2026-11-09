import Image from "next/image";
import logo from "@/app/_assets/logo.svg";

export function BrandHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="flex h-[60px] items-center px-6">
        <span className="inline-flex items-center gap-1.5 text-[22px] font-extrabold tracking-[-0.04em] text-green">
          <Image src={logo} alt="" width={24} height={24} />
          sprout
        </span>
      </div>
    </header>
  );
}
