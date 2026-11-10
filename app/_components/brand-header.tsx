import Image from "next/image";
import logo from "@/app/_assets/pluck-logo.svg";

export function BrandHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="flex h-[60px] items-center px-6">
        <Image src={logo} alt="Pluck" height={26} className="h-[26px] w-auto" draggable={false} preload />
      </div>
    </header>
  );
}
