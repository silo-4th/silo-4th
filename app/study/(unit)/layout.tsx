import { Suspense } from "react";
import { requireLearner } from "@/lib/auth";
import { StudyPanel } from "./_components/study-panel";

export default function UnitLayout({ children }: LayoutProps<"/study">) {
  return (
    <div className="relative flex h-screen">
      <div className="flex min-w-0 flex-1">{children}</div>
      <Suspense>
        <LearnerStudyPanel />
      </Suspense>
    </div>
  );
}

// 퀴즈 탭은 풀던 문제를 학습자마다 따로 기억하므로 학습자 ID를 넘긴다.
async function LearnerStudyPanel() {
  const learner = await requireLearner();
  return <StudyPanel learnerId={learner.id} />;
}
