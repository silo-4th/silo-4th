import { Check, CircleCheck } from "lucide-react";
import Image from "next/image";
import { type ReactNode, Suspense } from "react";
import mascot from "@/app/_assets/mascot.png";
import { BrandHeader } from "@/app/_components/brand-header";
import { SocialLoginButtons } from "@/app/_components/social-login-buttons";

const POINTS = [
  "읽다가 모르는 내용은 바로 AI에게 물어보기",
  "질문한 개념으로 확인 문제를 풀며 진짜 이해했는지 체크",
  "다음 날 어제 공부한 내용을 다시 꺼내 확인하기",
];

// 로그인한 학습자는 `proxy.ts`가 학습 화면으로 보내므로, 이 화면은 로그인하지 않은 사람만 본다.
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <BrandHeader />
      <main className="grid flex-1 grid-cols-1 min-[861px]:grid-cols-2">
        <Preview />
        <section className="flex flex-col justify-center px-6 py-10 min-[861px]:px-[12%]">
          <h1 className="mb-3 text-[28px] leading-[1.4] font-bold tracking-[-0.03em]">나만의 학습을 시작해보세요!</h1>
          <p className="mb-7 max-w-[420px] text-[17px] leading-relaxed text-ink-2">
            오늘 AI에게 물어본 내용, 내일 진짜 혼자 풀 수 있는지 확인해 드려요
          </p>
          <Suspense>
            <Login searchParams={searchParams} />
          </Suspense>
        </section>
      </main>
    </>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { error } = await searchParams;
  return <SocialLoginButtons error={typeof error === "string" ? error : undefined} />;
}

function Preview() {
  return (
    <section className="m-4 flex min-h-[220px] flex-col items-center justify-center gap-7 overflow-hidden rounded-[20px] border border-green-50 bg-green-25 p-6 min-[861px]:m-6 min-[861px]:p-9">
      <div aria-hidden className="flex w-full items-end justify-center gap-3.5">
        <Image src={mascot} alt="" width={72} height={72} className="flex-none" />
        <div className="w-full rounded-[14px] bg-white p-4 shadow-[0_12px_32px_rgba(0,90,50,0.12)] min-[861px]:w-[300px]">
          <div className="mb-1.5 text-xs text-gray-2">WHERE와 HAVING 확인 문제</div>
          <div className="mb-2.5 text-sm font-bold">WHERE 절에는 집계 함수를 조건으로 사용할 수 없다.</div>
          <div className="flex flex-col gap-2">
            <PreviewOption mark={<Check size={12} />} label="O" right />
            <PreviewOption mark="X" label="X" />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md bg-green-50 px-3 py-2.5 text-[13px] font-bold text-green-600">
            <span>정답입니다!</span>
            <span className="chip chip-green">확신하고 맞힘</span>
          </div>
        </div>
      </div>
      <div className="w-full max-w-[380px]">
        <div className="mb-2.5 text-[17px] font-bold">읽고, 확인하고, 기록하는 AI 리딩 파트너</div>
        {POINTS.map((point) => (
          <div key={point} className="mt-1.5 flex items-center gap-2 text-sm text-ink-2">
            <CircleCheck size={16} className="flex-none text-green" />
            {point}
          </div>
        ))}
      </div>
    </section>
  );
}

function PreviewOption({ mark, label, right = false }: { mark: ReactNode; label: string; right?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border px-3 py-[9px] text-[13px] ${right ? "border-green bg-green-25" : "border-line bg-white text-gray-3"}`}
    >
      <span
        className={`grid size-[22px] flex-none place-items-center rounded-full text-[11px] font-bold ${right ? "bg-green text-white" : "bg-line-2 text-gray"}`}
      >
        {mark}
      </span>
      {label}
    </div>
  );
}
