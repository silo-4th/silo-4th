import Image from "next/image";
import failSign from "@/app/_assets/mascot-fail.webp";

// 퀴즈 탭에서 불러오거나 만들지 못했을 때 퀴즈 홈과 같은 자리에 두는 화면이다.
export function FailState({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" className="my-auto flex flex-col items-center p-1 pb-20 text-center">
      <span aria-hidden className="mascot h-[99px] w-[139px]">
        <Image src={failSign} alt="" width={224} height={160} draggable={false} />
      </span>
      <h2 className="mt-3 mb-1.5 text-[21px] font-bold tracking-[-0.02em] text-balance">{title}</h2>
      <p className="text-[13.5px] leading-[1.6] text-gray">잠시 뒤 다시 시도해 주세요.</p>
      <div className="mt-6 flex w-full flex-col gap-2">
        <button type="button" onClick={onRetry} className="btn btn-dark btn-lg btn-block">
          다시 시도
        </button>
      </div>
    </div>
  );
}
