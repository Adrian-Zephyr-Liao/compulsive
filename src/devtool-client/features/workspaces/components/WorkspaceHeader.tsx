import { Badge, Breadcrumb, Layout } from "antd";

const { Header } = Layout;

export interface WorkspaceHeaderProps {
  connectionLabel: string;
  connectionStatus: "error" | "processing" | "success";
  workspaceName: string | undefined;
}

export function WorkspaceHeader({
  connectionLabel,
  connectionStatus,
  workspaceName,
}: WorkspaceHeaderProps) {
  return (
    <Header className="flex !h-11 items-center justify-between border-b border-[var(--ant-color-split)] !bg-white/90 !px-5 !py-0 !leading-normal text-[var(--ant-color-text)] backdrop-blur-sm">
      <Breadcrumb items={[{ title: "工作区" }, { title: workspaceName ?? "" }]} />
      <Badge status={connectionStatus} text={connectionLabel} />
    </Header>
  );
}
