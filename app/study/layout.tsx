import { type ReactNode, Suspense } from "react";
import { IdentifyLearner } from "@/app/_components/analytics";
import { userProperties } from "@/lib/analytics";
import { requireLearner } from "@/lib/auth";

// `proxy.ts`는 세션 쿠키만 본다. 쿠키는 있지만 학습자가 없거나 저장에 동의하지 않은 경우를 여기서 DB로 걸러 낸다.
export default function StudyLayout({ children }: LayoutProps<"/study">) {
  return (
    <Suspense>
      <LearnerGate>{children}</LearnerGate>
    </Suspense>
  );
}

async function LearnerGate({ children }: { children: ReactNode }) {
  const learner = await requireLearner();
  return (
    <>
      <IdentifyLearner learnerId={learner.id} properties={userProperties(learner)} />
      {children}
    </>
  );
}
