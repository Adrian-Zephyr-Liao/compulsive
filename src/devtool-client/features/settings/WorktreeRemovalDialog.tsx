import { Alert, Checkbox, Input, Modal, Tag, Typography } from "antd";
import { useState } from "react";

import type { WorktreeRemovalPlan } from "../../../worktree-audit-types.js";
import { useI18n } from "../../app/i18n.js";
import { auditLabel } from "./worktreeAuditLabels.js";

interface Props {
  plan: WorktreeRemovalPlan;
  busy: boolean;
  onClose: () => void;
  onConfirm: (path: string, includeIgnored: boolean, force: boolean) => void;
}

export function WorktreeRemovalDialog({ plan, busy, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const [confirmedPath, setConfirmedPath] = useState("");
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [force, setForce] = useState(false);
  const ignored = plan.item.changes.filter((change) => change.status === "!!");
  const blockers = plan.blockers;
  const requiresForce = plan.forceReasons.length > 0;
  const warnings = plan.item.risks.filter(
    (risk) => !plan.forceReasons.includes(risk) && risk !== "ignored-files",
  );
  return (
    <Modal
      open
      centered
      title={t("audit.removePreview")}
      width={640}
      destroyOnHidden
      mask={{ closable: !busy }}
      closable={!busy}
      keyboard={!busy}
      onCancel={onClose}
      confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }}
      okText={t(requiresForce ? "audit.forceRemove" : "audit.remove")}
      cancelText={t("common.cancel")}
      okButtonProps={{
        danger: true,
        disabled:
          blockers.length > 0 ||
          confirmedPath !== plan.item.path ||
          (requiresForce && !force) ||
          (ignored.length > 0 && !includeIgnored),
      }}
      onOk={() => onConfirm(confirmedPath, includeIgnored, force)}
    >
      <div className="flex flex-col gap-4 py-4">
        <Typography.Text>{t("audit.removeDescription")}</Typography.Text>
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4">
          <Typography.Text strong>{plan.item.repositoryName}</Typography.Text>
          <Typography.Text className="break-all" copyable>
            {plan.item.path}
          </Typography.Text>
          <Typography.Text type="secondary">
            {plan.item.branch ?? t("audit.detached")} · {plan.item.head?.slice(0, 12)}
          </Typography.Text>
        </div>
        {blockers.length ? (
          <Alert
            type="error"
            showIcon
            title={t("audit.removeBlocked")}
            description={
              <div className="mt-2 flex flex-wrap gap-2">
                {blockers.map((reason) => (
                  <Tag key={reason} color="error">
                    {auditLabel(reason, t)}
                  </Tag>
                ))}
              </div>
            }
          />
        ) : (
          <>
            {requiresForce && (
              <Alert
                type="error"
                showIcon
                title={t("audit.forceWarning")}
                description={
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {plan.forceReasons.map((reason) => (
                        <Tag key={reason} color="error">
                          {auditLabel(reason, t)}
                        </Tag>
                      ))}
                    </div>
                    {plan.item.references.length > 0 && (
                      <Typography.Text>
                        {t("audit.detachReferences", { names: plan.item.references.join(", ") })}
                      </Typography.Text>
                    )}
                    <Checkbox
                      checked={force}
                      disabled={busy}
                      onChange={(event) => setForce(event.target.checked)}
                    >
                      {t("audit.confirmForce")}
                    </Checkbox>
                  </div>
                }
              />
            )}
            {warnings.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {warnings.map((risk) => (
                  <Tag key={risk} color="warning">
                    {auditLabel(risk, t)}
                  </Tag>
                ))}
              </div>
            )}
            <Typography.Text type="secondary">{t("audit.removeWarning")}</Typography.Text>
            {ignored.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--ant-color-warning-border)] p-4">
                <Typography.Text strong>{t("audit.ignoredFiles")}</Typography.Text>
                <ul className="m-0 list-inside list-disc break-all p-0">
                  {ignored.slice(0, 5).map(({ path }) => (
                    <li key={path}>{path}</li>
                  ))}
                  {ignored.length > 5 && <li>+{ignored.length - 5}</li>}
                </ul>
                <Checkbox
                  checked={includeIgnored}
                  disabled={busy}
                  onChange={(event) => setIncludeIgnored(event.target.checked)}
                >
                  {t("audit.confirmIgnored")}
                </Checkbox>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor="worktree-removal-path">{t("audit.confirmPath")}</label>
              <Input
                id="worktree-removal-path"
                value={confirmedPath}
                onChange={(event) => setConfirmedPath(event.target.value)}
                disabled={busy}
                autoComplete="off"
                placeholder={plan.item.path}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
