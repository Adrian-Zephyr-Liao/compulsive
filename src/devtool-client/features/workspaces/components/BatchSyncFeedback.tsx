import { Button, Typography } from "antd";

import type { WorkspaceBranchSyncItem } from "../../../../types.js";
import { useI18n, type MessageKey } from "../../../app/i18n.js";

const { Text } = Typography;
const outcomeMessages = {
  synced: "feedback.batchOutcomeSynced",
  skipped: "feedback.batchOutcomeSkipped",
  conflict: "feedback.batchOutcomeConflict",
  failed: "feedback.batchOutcomeFailed",
  "push-required": "feedback.batchOutcomePushRequired",
} satisfies Record<WorkspaceBranchSyncItem["outcome"], MessageKey>;
const phaseMessages = {
  preflight: "feedback.batchPhasePreflight",
  stash: "feedback.batchPhaseStash",
  fetch: "feedback.batchPhaseFetch",
  rebase: "feedback.batchPhaseRebase",
  push: "feedback.batchPhasePush",
  restore: "feedback.batchPhaseRestore",
} satisfies Record<NonNullable<WorkspaceBranchSyncItem["phase"]>, MessageKey>;

interface BatchSyncFeedbackProps {
  items: WorkspaceBranchSyncItem[];
  refreshError?: string | undefined;
  onInspectConflict: (repositoryId: string) => void;
}

export function BatchSyncFeedback({
  items,
  refreshError,
  onInspectConflict,
}: BatchSyncFeedbackProps) {
  const { t } = useI18n();
  const count = (outcome: WorkspaceBranchSyncItem["outcome"]) =>
    items.filter((item) => item.outcome === outcome).length;
  const details = items.filter((item) => item.outcome !== "synced" || item.backup);

  return (
    <div className="grid min-w-0 gap-3">
      <Text type="secondary">
        {t("feedback.batchSummary", {
          synced: count("synced"),
          skipped: count("skipped"),
          conflicts: count("conflict"),
          failed: count("failed"),
          pushRequired: count("push-required"),
        })}
      </Text>
      {refreshError && (
        <Text type="warning">{t("feedback.batchRefreshFailed", { error: refreshError })}</Text>
      )}
      {details.length > 0 && (
        <ul className="m-0 grid max-h-96 gap-3 overflow-auto p-0 list-none">
          {details.map((item) => (
            <li className="grid min-w-0 gap-1" key={item.repositoryId}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Text strong>{item.alias}</Text>
                <Text type="secondary">
                  {t(outcomeMessages[item.outcome])}
                  {item.phase && ` · ${t(phaseMessages[item.phase])}`}
                </Text>
              </div>
              <Text className="break-words" type="secondary">
                {item.message}
              </Text>
              {item.backup && (
                <div className="grid min-w-0 gap-1">
                  <Text type={item.backup.restored ? "secondary" : "warning"}>
                    {t(
                      item.backup.restored
                        ? "feedback.batchBackupRestored"
                        : "feedback.batchBackupPending",
                    )}
                  </Text>
                  <Text
                    className="min-w-0 [&_code]:m-0 [&_code]:block [&_code]:overflow-x-auto [&_code]:whitespace-nowrap"
                    code
                  >
                    {item.backup.oid}
                  </Text>
                </div>
              )}
              {item.outcome === "push-required" && (
                <Text type="warning">{t("feedback.batchPushRequiredHint")}</Text>
              )}
              {item.outcome === "conflict" && (
                <Button
                  className="justify-self-start"
                  size="small"
                  onClick={() => onInspectConflict(item.repositoryId)}
                >
                  {t(
                    item.phase === "restore"
                      ? "feedback.batchInspectRestore"
                      : "feedback.batchResolveConflict",
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
