import { Suspense } from "react";
import { BrandHeader } from "@/app/_components/brand-header";
import { requireLearner } from "@/lib/auth";
import { AccountMenu } from "./_components/account-menu";
import { RecallGate } from "./_components/recall-gate";
import { SelectionAskProvider } from "./_components/selection-ask";
import { StudyPanel } from "./_components/study-panel";
import { UnitSwitch } from "./_components/unit-switch";

export default function UnitLayout({ children }: LayoutProps<"/study">) {
  return (
    <RecallGate
      header={
        <BrandHeader>
          <Suspense>
            <LearnerAccountMenu />
          </Suspense>
        </BrandHeader>
      }
    >
      <SelectionAskProvider>
        <div className="relative flex h-screen">
          <div className="flex min-w-0 flex-1">
            <UnitSwitch>{children}</UnitSwitch>
          </div>
          <Suspense>
            <LearnerStudyPanel />
          </Suspense>
        </div>
      </SelectionAskProvider>
    </RecallGate>
  );
}

// 퀴즈 탭은 풀던 문제를 학습자마다 따로 기억하므로 학습자 ID를 넘긴다.
async function LearnerStudyPanel() {
  const learner = await requireLearner();
  return <StudyPanel learnerId={learner.id} />;
}

async function LearnerAccountMenu() {
  const learner = await requireLearner();
  return <AccountMenu name={learner.name} light />;
}
