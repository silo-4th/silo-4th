import { RecallGate } from "./_components/recall-gate";
import { StudyPanel } from "./_components/study-panel";

export default function UnitLayout({ children }: LayoutProps<"/study">) {
  return (
    <RecallGate>
      <div className="flex h-screen">
        <div className="flex min-w-0 flex-1">{children}</div>
        <StudyPanel />
      </div>
    </RecallGate>
  );
}
