import { Check } from "lucide-react";
import Image from "next/image";
import { Suspense } from "react";
import pluckyLaptop from "@/app/_assets/plucky-laptop.webp";
import { BrandHeader } from "@/app/_components/brand-header";
import { SocialLoginButtons } from "@/app/_components/social-login-buttons";

// 로그인한 학습자는 `proxy.ts`가 학습 화면으로 보내므로, 이 화면은 로그인하지 않은 사람만 본다.
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <BrandHeader />
      <main className="grid flex-1 grid-cols-1 min-[861px]:grid-cols-2">
        <Preview />
        <section className="flex flex-col items-center justify-center px-8 *:w-full *:max-w-[440px]">
          <h1 className="mb-3 text-[28px] leading-[1.4] font-bold tracking-[-0.03em]">나만의 학습을 시작해 보세요!</h1>
          <p className="mb-8 text-base leading-[1.6] text-ink-2">
            맞춤형 AI 문제로 막힌 부분을 해결하고, 진짜 내 것으로 만들어요.
          </p>
          <Suspense>
            <Login searchParams={searchParams} />
          </Suspense>
          <p className="mt-4 mb-3 text-xs leading-normal text-gray-2">
            Google로 로그인하면 Pluck 이용약관과 개인정보처리방침에 동의하게 돼요.
          </p>
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
    <section className="login-art">
      <div className="login-stage">
        <div className="login-copy">
          <div className="login-art-head">
            읽고, 확인하고, 기록하는
            <br />
            AI 리딩 파트너
          </div>
          <div className="login-bubbles">
            <p className="login-bubble">
              모르는 문장, <u className="login-drag">드래그</u>만 하면 돼요
            </p>
            <p className="login-bubble login-bubble--icon">
              <span className="login-checkbox">
                <Check size={12} strokeWidth={3.2} />
              </span>
              짧은 문제로 이해했는지 확인해 볼까요?
            </p>
            <p className="login-bubble">
              내 학습 데이터를 한눈에 보아요{" "}
              <span className="login-emoji" aria-hidden>
                👀
              </span>
            </p>
          </div>
        </div>
        <Image src={pluckyLaptop} alt="" className="login-plucky" draggable={false} preload />
      </div>
    </section>
  );
}
