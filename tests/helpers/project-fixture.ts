import { createWorkspaceFixture } from "./workspace-fixture.js";
import type { ProjectFileInput } from "../../src/project/paths.js";

export async function createProjectFixture() {
  const fixture = await createWorkspaceFixture();
  const remote = await fixture.remote("editor");
  const workspace = await fixture.manager.createWorkspace({ name: "editor" });
  const updated = await fixture.manager.addWorkspaceMember({
    workspaceId: workspace.id,
    repositoryId: remote.repository.id,
    mode: "worktree",
    branch: "feat/editor",
    createBranch: true,
  });
  const member = updated.members[0]!;
  if (member.mode !== "worktree") throw new Error("Expected a test worktree");
  return {
    ...fixture,
    repository: remote.repository,
    workspace: updated,
    root: member.worktreePath,
    input: (path = ""): ProjectFileInput => ({
      workspaceId: workspace.id,
      repositoryId: remote.repository.id,
      path,
    }),
  };
}
