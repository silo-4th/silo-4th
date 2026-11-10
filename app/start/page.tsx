import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandHeader } from "@/app/_components/brand-header";
import { Mascot } from "@/app/_components/mascot";
import { getCurrentLearner } from "@/lib/auth";
import { koreanToday } from "@/lib/exam-date";
import { HOME_PATH, STUDY_PATH } from "@/lib/routes";
import { StartForm } from "./start-form";

export default function StartPage() {
  return (
    <>
      <BrandHeader />
      <main className="min-h-[calc(100vh-64px)] bg-bg px-6 pt-8 pb-14 max-[640px]:px-3 max-[640px]:pt-4 max-[640px]:pb-10 [@media(max-height:760px)_and_(min-width:861px)]:py-3">
        <section className="mx-auto max-w-[680px] overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div className="min-h-[440px] [@media(max-height:760px)_and_(min-width:861px)]:min-h-0 px-5 pt-8 pb-12 min-[521px]:px-10 min-[521px]:pt-10 min-[521px]:pb-14">
            <Suspense>
              <StartGate />
            </Suspense>
          </div>
        </section>
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
      <span className="mt-4 mb-5 flex justify-center [&_.mascot--live]:m-0">
        <Mascot size={88} live />
      </span>
      <h1 className="mb-2 text-center text-2xl leading-[1.35] font-bold tracking-[-0.03em] max-[640px]:text-[21px]">
        학습을 시작하기 전에 알려 주세요
      </h1>
      <p className="mb-6 text-center text-sm leading-[1.6] text-gray">시험 날짜를 저장하고 바로 시작해요</p>
      <StartForm today={koreanToday(new Date())} />
    </>
  );
}
