import { notFound } from "next/navigation";
import { Suspense } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireLearner } from "@/lib/auth";
import { remarkSectionIds, sectionConceptId, unitSections } from "@/lib/unit-sections";
import { findUnit, listUnits } from "@/lib/units";
import { AccountMenu } from "../_components/account-menu";
import { ScrollToSection } from "../_components/scroll-to-section";
import { UnitBody } from "../_components/unit-body";
import { UnitRail } from "../_components/unit-rail";
import { UnitLoading, UnitPending, UnitTitle } from "../_components/unit-switch";

type Params = PageProps<"/study/[unitId]">["params"];

export default function UnitPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<UnitLoading />}>
      <StudyUnit params={params} />
    </Suspense>
  );
}

// 레이아웃은 단원을 옮길 때 다시 그려지지 않으므로 페이지에서도 확인한다.
async function StudyUnit({ params }: { params: Params }) {
  const learner = await requireLearner();
  const { unitId } = await params;
  const [units, current] = await Promise.all([listUnits(), findUnit(unitId)]);
  if (!current) notFound();
  const sections = unitSections(current.content).map((section) => ({
    ...section,
    conceptId: sectionConceptId(current.id, section),
  }));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-3.5 bg-player px-4 text-white">
        <UnitRail units={units} currentId={current.id} />
        <UnitTitle>{current.title}</UnitTitle>
        <AccountMenu name={learner.name} />
      </header>
      <UnitPending>
        <UnitBody sections={sections}>
          <Markdown remarkPlugins={[remarkGfm, remarkSectionIds]}>{current.content}</Markdown>
          <ScrollToSection />
        </UnitBody>
      </UnitPending>
    </div>
  );
}
