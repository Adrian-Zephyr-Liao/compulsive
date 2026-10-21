import { RepositoryPanel } from "./components/RepositoryPanel.js";
import type { RepositoryPanelProps } from "./components/RepositoryPanel.js";
import { WorkspaceSummary } from "./components/WorkspaceSummary.js";
import type { WorkspaceSummaryProps } from "./components/WorkspaceSummary.js";

interface RequirementPageProps {
  summary: WorkspaceSummaryProps;
  repositories: RepositoryPanelProps;
}

export function RequirementPage({ summary, repositories }: RequirementPageProps) {
  return (
    <div className="grid min-w-[940px] grid-cols-[minmax(720px,1fr)] items-stretch gap-4 px-5 pt-4 pb-6">
      <WorkspaceSummary {...summary} />
      <RepositoryPanel {...repositories} />
    </div>
  );
}
