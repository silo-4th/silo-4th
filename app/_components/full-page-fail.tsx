import type { ReactNode } from "react";
import { BrandHeader } from "@/app/_components/brand-header";

type FullPageFailProps = {
  account?: ReactNode;
  art: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onAction: () => void };
};

// 없는 단원, 예상하지 못한 오류, 모바일 안내가 함께 쓰는 전체 화면이다. 퀴즈 탭 실패 화면과 같은 배치를 화면 가운데보다 조금 위에 둔다.
export function FullPageFail({ account, art, title, description, action }: FullPageFailProps) {
  return (
    <>
      <BrandHeader>{account}</BrandHeader>
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-white px-6 py-8">
        <div role="alert" className="flex w-full max-w-[360px] flex-col items-center p-1 pb-20 text-center">
          {art}
          <h1 className="mt-3 mb-1.5 text-[21px] font-bold tracking-[-0.02em]">{title}</h1>
          <p className="text-[13.5px] leading-[1.6] text-gray">{description}</p>
          {action && (
            <div className="mt-6 flex w-full flex-col gap-2">
              <button type="button" onClick={action.onAction} className="btn btn-dark btn-lg btn-block tracking-normal">
                {action.label}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
