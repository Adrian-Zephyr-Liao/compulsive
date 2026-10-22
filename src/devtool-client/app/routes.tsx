import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";

export const routePaths = {
  requirements: "/requirements",
  requirementPattern: "/requirements/:workspaceId",
  codePreviewPattern: "/requirements/:workspaceId/code/:repositoryId",
  codePreview: (workspaceId: string, repositoryId: string) =>
    `/requirements/${encodeURIComponent(workspaceId)}/code/${encodeURIComponent(repositoryId)}`,
  requirement: (workspaceId: string) => `/requirements/${encodeURIComponent(workspaceId)}`,
  settings: "/settings/storage",
  settingsPattern: "/settings/*",
  doctor: "/settings/doctor",
  worktreeAudit: "/settings/doctor/worktrees",
} as const;

interface DevtoolRoutesProps {
  defaultWorkspaceId: string | undefined;
  requirementExists: boolean;
  requirements: ReactNode;
  settings: ReactNode;
  codePreview?: ReactNode;
}

export function DevtoolRoutes({
  defaultWorkspaceId,
  requirementExists,
  requirements,
  settings,
  codePreview,
}: DevtoolRoutesProps) {
  const defaultPath = defaultWorkspaceId
    ? routePaths.requirement(defaultWorkspaceId)
    : routePaths.requirements;

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={defaultPath} />} />
      <Route
        path={routePaths.requirements}
        element={defaultWorkspaceId ? <Navigate replace to={defaultPath} /> : requirements}
      />
      <Route
        path={routePaths.requirementPattern}
        element={requirementExists ? requirements : <Navigate replace to={defaultPath} />}
      />
      <Route path={routePaths.settingsPattern} element={settings} />
      <Route
        path={routePaths.codePreviewPattern}
        element={requirementExists ? codePreview : <Navigate replace to={defaultPath} />}
      />
      <Route path="*" element={<Navigate replace to={defaultPath} />} />
    </Routes>
  );
}
