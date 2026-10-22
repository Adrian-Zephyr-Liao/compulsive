import type { MessageKey, Translate } from "../../app/i18n.js";

const labels: Record<string, MessageKey> = {
  "identity-changed": "audit.identityChanged",
  "missing-upstream": "audit.missingUpstream",
  "protected-path": "audit.protectedPath",
  submodules: "audit.submodules",
  referenced: "audit.referenced",
  unreferenced: "audit.unreferenced",
  external: "audit.external",
  missing: "audit.missing",
  unregistered: "audit.unregistered",
  dirty: "audit.dirty",
  untracked: "audit.untracked",
  "ignored-files": "audit.ignoredFiles",
  conflicts: "audit.conflicts",
  "in-progress": "audit.inProgress",
  unpublished: "audit.unpushed",
  "no-upstream": "audit.noUpstream",
  "detached-unprotected": "audit.detachedUnprotected",
  locked: "audit.lock",
  unknown: "audit.unknown",
  symlink: "audit.symlink",
};

export function auditLabel(value: string, t: Translate): string {
  const key = labels[value];
  return key ? t(key) : value;
}
