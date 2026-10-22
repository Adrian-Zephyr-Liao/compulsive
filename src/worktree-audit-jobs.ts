import { randomUUID } from "node:crypto";

import { CompulsiveError } from "./errors.js";
import type { RepositoryManager } from "./types.js";
import type { WorktreeAuditJob } from "./worktree-audit-types.js";

export function createWorktreeAuditJobs(manager: RepositoryManager) {
  const jobs = new Map<
    string,
    { state: WorktreeAuditJob; controller: AbortController; listeners: Set<() => void> }
  >();
  function get(id: string) {
    const job = jobs.get(id);
    if (!job) throw new CompulsiveError("INVALID_INPUT", "Unknown worktree audit job.");
    return job;
  }
  return {
    start(): WorktreeAuditJob {
      const running = [...jobs.values()].find(({ state }) => state.status === "running");
      if (running) return { ...running.state };
      for (const [id, job] of jobs)
        if (jobs.size >= 8 && job.state.status !== "running") jobs.delete(id);
      const controller = new AbortController();
      const job = {
        state: {
          id: randomUUID(),
          revision: 0,
          status: "running",
          completed: 0,
          total: 0,
          report: null,
          error: null,
        } as WorktreeAuditJob,
        controller,
        listeners: new Set<() => void>(),
      };
      function update() {
        job.state.revision++;
        for (const listener of job.listeners) listener();
        job.listeners.clear();
      }
      jobs.set(job.state.id, job);
      void manager
        .auditWorktrees({
          signal: controller.signal,
          onProgress(completed, total) {
            Object.assign(job.state, { completed, total });
            update();
          },
        })
        .then(
          (report) => {
            Object.assign(job.state, {
              report,
              status: report.cancelled ? "cancelled" : "completed",
            });
            update();
          },
          (error: unknown) => {
            Object.assign(job.state, { status: "failed", error: String(error) });
            update();
          },
        );
      return { ...job.state };
    },
    async wait(id: string, revision: number): Promise<WorktreeAuditJob> {
      const job = get(id);
      if (job.state.revision <= revision && job.state.status === "running") {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            job.listeners.delete(done);
            resolve();
          };
          const timer = setTimeout(done, 25_000);
          job.listeners.add(done);
        });
      }
      return { ...job.state };
    },
    cancel(id: string): WorktreeAuditJob {
      const job = get(id);
      job.controller.abort();
      return { ...job.state };
    },
  };
}
