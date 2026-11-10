import { Suspense } from "react";
import { AccountMenu } from "@/app/_components/account-menu";
import { requireLearner } from "@/lib/auth";
import { UnitNotFound } from "./_components/unit-not-found";

// 단원 화면의 레이아웃과 학습 패널까지 덮도록 학습 화면 바로 아래에 둔다.
export default function StudyNotFound() {
  return (
    <UnitNotFound
      account={
        <Suspense>
          <LearnerAccount />
        </Suspense>
      }
    />
  );
}

async function LearnerAccount() {
  const learner = await requireLearner();
  return <AccountMenu name={learner.name} light />;
}
