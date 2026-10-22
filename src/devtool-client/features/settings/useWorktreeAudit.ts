import { useEffect, useRef, useState } from "react";

import type {
  WorktreeAuditItem,
  WorktreeAuditJob,
  WorktreeAuditReport,
  WorktreeRemovalPlan,
} from "../../../worktree-audit-types.js";
import type { WorkspaceRpc } from "../workspaces/types.js";
import { useI18n } from "../../app/i18n.js";

export function useWorktreeAudit(
  getRpc: () => Promise<WorkspaceRpc>,
  onRemoved: () => Promise<void>,
) {
  const { t } = useI18n();
  const [report, setReport] = useState<WorktreeAuditReport | null>(null);
  const [job, setJob] = useState<WorktreeAuditJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retainedCommitRef, setRetainedCommitRef] = useState<string | null>(null);
  const [removal, setRemoval] = useState<WorktreeRemovalPlan | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const initialGeneration = generation.current;
    void getRpc()
      .then((rpc) => rpc.call("get-worktree-audit"))
      .then(({ report }) => {
        if (active && generation.current === initialGeneration) setReport(report);
      })
      .catch((error: unknown) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      generation.current++;
    };
  }, [getRpc]);

  async function run(operation: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function start() {
    const current = ++generation.current;
    await run(async () => {
      const rpc = await getRpc();
      let update = await rpc.call("start-worktree-audit");
      while (mounted.current && generation.current === current) {
        setJob(update);
        if (update.status !== "running") {
          if (update.report) setReport(update.report);
          if (update.error) setError(update.error);
          break;
        }
        // Wait for server-side progress events, not timed status polling.
        try {
          update = await rpc.call("wait-worktree-audit", {
            id: update.id,
            revision: update.revision,
          });
        } catch (error) {
          if (mounted.current) setJob(null);
          throw error;
        }
      }
    });
  }

  return {
    report,
    job,
    error,
    busy,
    loading,
    start,
    removal,
    previewingId,
    retainedCommitRef,
    closeRemoval: () => setRemoval(null),
    previewRemoval: async (item: WorktreeAuditItem) => {
      setPreviewingId(item.id);
      await run(async () => {
        const plan = await (await getRpc()).call("preview-audit-removal", { id: item.id });
        if (mounted.current) setRemoval(plan);
      });
      if (mounted.current) setPreviewingId(null);
    },
    remove: async (
      confirmedPath: string,
      includeIgnored: boolean,
      force: boolean,
    ): Promise<boolean> => {
      if (!removal) return false;
      let removed = false;
      await run(async () => {
        const result = await (
          await getRpc()
        ).call("remove-audit-worktree", {
          id: removal.item.id,
          fingerprint: removal.item.fingerprint,
          confirmedPath,
          includeIgnored,
          force,
        });
        removed = true;
        if (mounted.current) {
          setRetainedCommitRef(result.retainedCommitRef);
          setReport(
            (previous) =>
              result.report ??
              (previous
                ? {
                    ...previous,
                    items: previous.items.filter((item) => item.id !== removal.item.id),
                  }
                : null),
          );
          if (result.warning) setError(result.warning);
        }
        try {
          await onRemoved();
        } catch (error) {
          if (mounted.current) setError(t("audit.refreshFailed", { error: String(error) }));
        }
      });
      if (mounted.current) setRemoval(null);
      return removed;
    },
    cancel: () =>
      run(async () => {
        if (job) await (await getRpc()).call("cancel-worktree-audit", { id: job.id });
      }),
    ignore: (item: WorktreeAuditItem) =>
      run(async () => {
        const next = await (
          await getRpc()
        ).call("ignore-worktree-audit", {
          id: item.id,
          fingerprint: item.fingerprint,
          ignored: !item.ignored,
        });
        if (mounted.current) setReport(next);
      }),
    open: (item: WorktreeAuditItem) =>
      run(async () => {
        await (
          await getRpc()
        ).call("open-audit-worktree", { id: item.id, fingerprint: item.fingerprint });
      }),
  };
}
