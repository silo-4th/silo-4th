import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandHeader } from "@/app/_components/brand-header";
import { SignOutButton } from "@/app/_components/sign-out-button";
import { getCurrentLearner } from "@/lib/auth";
import { HOME_PATH, STUDY_PATH } from "@/lib/routes";
import { StartForm } from "./start-form";

export default function StartPage() {
  return (
    <>
      <BrandHeader />
      <main className="mx-auto mt-10 mb-20 w-full max-w-[640px] px-6">
        <Suspense>
          <StartGate />
        </Suspense>
      </main>
    </>
  );
}

async function StartGate() {
  const learner = await getCurrentLearner();
  if (!learner) redirect(HOME_PATH);
  if (learner.consentedAt) redirect(STUDY_PATH);
  // 이미 동의한 학습자가 제목을 잠깐 보지 않도록, 확인을 마친 뒤에 제목과 폼을 함께 그린다.
  return (
    <>
      <h1 className="mb-2 text-[26px] font-bold tracking-[-0.03em]">학습을 시작하기 전에 알려 주세요</h1>
      <p className="text-gray">시험 날짜와 기록 저장 동의만 받으면 바로 시작할 수 있어요.</p>
      <StartForm />
      {/* 동의하고 싶지 않은 학습자가 다른 계정으로 바꿀 수 있게 둔다. */}
      <SignOutButton className="btn btn-ghost btn-block mt-2 text-gray" />
    </>
  );
}
