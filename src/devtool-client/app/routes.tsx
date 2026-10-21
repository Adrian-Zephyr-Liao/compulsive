import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";

export const routePaths = {
  requirements: "/requirements",
  requirementPattern: "/requirements/:workspaceId",
  requirement: (workspaceId: string) => `/requirements/${encodeURIComponent(workspaceId)}`,
  settings: "/settings/storage",
  settingsPattern: "/settings/*",
  doctor: "/settings/doctor",
} as const;

interface DevtoolRoutesProps {
  defaultWorkspaceId: string | undefined;
  requirementExists: boolean;
  requirements: ReactNode;
  settings: ReactNode;
}

export function DevtoolRoutes({
  defaultWorkspaceId,
  requirementExists,
  requirements,
  settings,
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
      <Route path="*" element={<Navigate replace to={defaultPath} />} />
    </Routes>
  );
}
