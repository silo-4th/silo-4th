import Image from "next/image";
import failSign from "@/app/_assets/mascot-fail.webp";

// 불러오거나 만들지 못했을 때 그 자리에 두는 화면이다. compact는 대화 기록 메뉴처럼 좁은 곳에 두는 작은 모양이다.
export function FailState({ title, onRetry, compact = false }: { title: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center text-center ${compact ? "px-4 pt-16 pb-8" : "my-auto p-1 pb-20"}`}
    >
      <span aria-hidden className="mascot h-[99px] w-[139px]">
        <Image src={failSign} alt="" width={224} height={160} draggable={false} />
      </span>
      <h2
        className={`mb-1.5 font-bold tracking-[-0.02em] text-balance ${compact ? "mt-2 text-[15px]" : "mt-3 text-[21px]"}`}
      >
        {title}
      </h2>
      <p className={`leading-[1.6] text-gray ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>잠시 뒤 다시 시도해 주세요.</p>
      <div className={`flex flex-col gap-2 ${compact ? "mt-4" : "mt-6 w-full"}`}>
        <button type="button" onClick={onRetry} className={`btn btn-dark tracking-normal ${compact ? "btn-sm" : "btn-lg btn-block"}`}>
          다시 시도
        </button>
      </div>
    </div>
  );
}
