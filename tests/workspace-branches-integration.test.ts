import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

const execFileAsync = promisify(execFile);
type Fixture = Awaited<ReturnType<typeof createWorkspaceFixture>>;
async function prepareReference(base: Fixture) {
  const { path: selectedMainPath, repository: selectedMainRepository } =
    await base.remote("selected-main");
  const cloned = await base.manager.cloneWorkspace({
    name: "cloned",
    repositoryIds: [selectedMainRepository.id],
    referenceRepositoryIds: [selectedMainRepository.id],
  });
  return {
    manager: base.manager,
    selectedMainPath,
    selectedMainRepository,
    cloned,
    clonedMainPath: join(cloned.absolutePath, selectedMainRepository.name),
    sandbox: base.sandbox,
  };
}
async function preparePromoted(base: Fixture) {
  const scenario = await prepareReference(base);
  const { manager, cloned, selectedMainRepository, clonedMainPath, selectedMainPath } = scenario;
  await manager.promoteWorkspaceReference({
    workspaceId: cloned.id,
    repositoryId: selectedMainRepository.id,
    branch: "feat/promoted-reference",
  });
  await base.git(clonedMainPath, "push", "-q", "origin", "HEAD:refs/heads/feat/promoted-reference");
  await base.commit(selectedMainPath, "upstream.txt", "new upstream commit\n");
  await base.git(selectedMainPath, "push", "-q", "origin", "main");
  return scenario;
}
async function preparePushed(base: Fixture) {
  const scenario = await preparePromoted(base);
  const { manager, cloned, selectedMainRepository, clonedMainPath } = scenario;
  await manager.rebaseWorkspaceMember({
    workspaceId: cloned.id,
    repositoryId: selectedMainRepository.id,
  });
  await base.commit(clonedMainPath, "feature.txt", "feature commit\n");
  await manager.pushWorkspaceMember({
    workspaceId: cloned.id,
    repositoryId: selectedMainRepository.id,
  });
  await manager.getWorkspaceStatus(cloned.id);
  return scenario;
}

describe("workspace branch lifecycle", () => {
  let base: Fixture;
  let scenario: Awaited<ReturnType<typeof prepareReference>>;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
  });
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);
  describe("reference checkout", () => {
    beforeEach(async () => {
      scenario = await prepareReference(base);
    }, 30_000);
    it("fast-forwards development on the default branch without arming a force push", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath, sandbox } = scenario;
      const input = { workspaceId: cloned.id, repositoryId: selectedMainRepository.id };
      await manager.promoteWorkspaceReference({ ...input, branch: "main" });
      const writer = join(sandbox, "main-writer");
      await base.git(
        sandbox,
        "clone",
        "-q",
        `file://${join(sandbox, "selected-main.git")}`,
        writer,
      );
      await base.commit(writer, "main-writer.txt");
      await base.git(writer, "push", "-q", "origin", "main");
      const remoteHead = (await base.git(writer, "rev-parse", "HEAD")).stdout;
      await manager.rebaseWorkspaceMember(input);
      expect((await base.git(clonedMainPath, "rev-parse", "HEAD")).stdout).toBe(remoteHead);
      expect(
        (await manager.searchWorkspaces()).find((workspace) => workspace.id === cloned.id)!
          .members[0],
      ).not.toHaveProperty("forcePushBase");
    }, 20000);
    it("updates references and promotes dirty reference code without inventing an upstream", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath, selectedMainPath } =
        scenario;
      await writeFile(join(selectedMainPath, "reference-update.txt"), "reference update\n");
      await execFileAsync("git", ["-C", selectedMainPath, "add", "reference-update.txt"]);
      await execFileAsync("git", [
        "-C",
        selectedMainPath,
        "commit",
        "-q",
        "-m",
        "reference update",
      ]);
      await execFileAsync("git", ["-C", selectedMainPath, "push", "-q", "origin", "main"]);
      await manager.rebaseWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      });
      const [updatedReferenceHead, updatedRemoteMain, updatedReferenceBranch] = await Promise.all([
        execFileAsync("git", ["-C", clonedMainPath, "rev-parse", "HEAD"]),
        execFileAsync("git", ["-C", selectedMainPath, "rev-parse", "origin/main"]),
        execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
      ]);
      expect(updatedReferenceHead.stdout.trim()).toBe(updatedRemoteMain.stdout.trim());
      expect(updatedReferenceBranch.stdout.trim()).toBe("");

      await writeFile(join(clonedMainPath, "draft.txt"), "local draft\n");
      const referenceStatus = await manager.getWorkspaceStatus(cloned.id);
      expect(
        referenceStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
      ).toMatchObject({
        branch: "origin/main",
        detached: true,
        ahead: 0,
        behind: 0,
        changes: ["?? draft.txt"],
      });

      const promoted = await manager.promoteWorkspaceReference({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
        branch: "feat/promoted-reference",
      });
      expect(promoted.members[0]).toMatchObject({
        repositoryId: selectedMainRepository.id,
        branch: "feat/promoted-reference",
        mode: "worktree",
      });
      expect(promoted.members[0]).not.toHaveProperty("detached");
      const [promotedBranch, promotedUpstream] = await Promise.all([
        execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
        execFileAsync("git", [
          "-C",
          clonedMainPath,
          "for-each-ref",
          "--format=%(upstream:short)",
          "refs/heads/feat/promoted-reference",
        ]),
      ]);
      expect(promotedBranch.stdout.trim()).toBe("feat/promoted-reference");
      expect(promotedUpstream.stdout.trim()).toBe("");
      await execFileAsync("git", [
        "-C",
        clonedMainPath,
        "push",
        "-q",
        "origin",
        "HEAD:refs/heads/feat/promoted-reference",
      ]);

      await writeFile(join(selectedMainPath, "upstream.txt"), "new upstream commit\n");
      await execFileAsync("git", ["-C", selectedMainPath, "add", "upstream.txt"]);
      await execFileAsync("git", ["-C", selectedMainPath, "commit", "-q", "-m", "upstream"]);
      await execFileAsync("git", ["-C", selectedMainPath, "push", "-q", "origin", "main"]);
      const promotedStatus = await manager.getWorkspaceStatus(cloned.id, true);
      expect(
        promotedStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
      ).toMatchObject({
        branch: "feat/promoted-reference",
        detached: false,
        ahead: 0,
        behind: 1,
        mergedIntoDefault: false,
        changes: ["?? draft.txt"],
      });
      await expect(
        manager.convertWorkspaceToReference({
          workspaceId: cloned.id,
          repositoryId: selectedMainRepository.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await unlink(join(clonedMainPath, "draft.txt"));
    }, 20_000);
  });
  describe("unpublished development", () => {
    beforeEach(async () => {
      scenario = await preparePromoted(base);
    }, 30_000);
    it("rebases onto main and pushes to the same-name remote branch", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath } = scenario;
      await manager.rebaseWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      });
      await writeFile(join(clonedMainPath, "feature.txt"), "feature commit\n");
      await execFileAsync("git", ["-C", clonedMainPath, "add", "feature.txt"]);
      await execFileAsync("git", ["-C", clonedMainPath, "commit", "-q", "-m", "feature"]);
      const rebasedStatus = await manager.getWorkspaceStatus(cloned.id);
      const rebasedMemberStatus = rebasedStatus.members.find(
        (status) => status.repositoryId === selectedMainRepository.id,
      );
      expect(rebasedMemberStatus).toMatchObject({
        branch: "feat/promoted-reference",
        ahead: 1,
        behind: 0,
        upstream: "origin/feat/promoted-reference",
        unpushed: 2,
        mergedIntoDefault: false,
        changes: [],
      });
      await manager.pushWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      });
      const pushedStatus = await manager.getWorkspaceStatus(cloned.id);
      const pushedMemberStatus = pushedStatus.members.find(
        (status) => status.repositoryId === selectedMainRepository.id,
      );
      expect(pushedMemberStatus).toMatchObject({
        upstream: "origin/feat/promoted-reference",
        unpushed: 0,
        mergedIntoDefault: false,
      });
      expect(pushedMemberStatus?.developmentTip).toBeTruthy();
    }, 20_000);
  });
  describe("published development", () => {
    beforeEach(async () => {
      scenario = await preparePushed(base);
    }, 30_000);
    it("requires explicit leased force pushing after a rebase", async () => {
      const { manager, cloned, selectedMainRepository, selectedMainPath } = scenario;
      await writeFile(join(selectedMainPath, "post-push-main.txt"), "post push main\n");
      await execFileAsync("git", ["-C", selectedMainPath, "add", "post-push-main.txt"]);
      await execFileAsync("git", ["-C", selectedMainPath, "commit", "-q", "-m", "post push main"]);
      await execFileAsync("git", ["-C", selectedMainPath, "push", "-q", "origin", "main"]);
      await manager.rebaseWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      });
      const forcePushStatus = await manager.getWorkspaceStatus(cloned.id);
      expect(
        forcePushStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
      ).toMatchObject({ forcePushRequired: true });
      await expect(
        manager.pushWorkspaceMember({
          workspaceId: cloned.id,
          repositoryId: selectedMainRepository.id,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("--force-with-lease"),
      });
      await manager.pushWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
        force: true,
      });
      const forcePushedStatus = await manager.getWorkspaceStatus(cloned.id);
      const forcePushedMemberStatus = forcePushedStatus.members.find(
        (status) => status.repositoryId === selectedMainRepository.id,
      );
      expect(forcePushedMemberStatus).toMatchObject({ unpushed: 0 });
      expect(forcePushedMemberStatus).not.toHaveProperty("forcePushRequired");
    }, 20_000);
    it("observes a real development tip before reporting it merged", async () => {
      const { manager, cloned, selectedMainRepository, selectedMainPath } = scenario;
      await execFileAsync("git", ["-C", selectedMainPath, "fetch", "-q", "origin"]);
      await execFileAsync("git", [
        "-C",
        selectedMainPath,
        "merge",
        "-q",
        "--no-ff",
        "origin/feat/promoted-reference",
        "-m",
        "merge feature",
      ]);
      await execFileAsync("git", ["-C", selectedMainPath, "push", "-q", "origin", "main"]);
      const mergedStatus = await manager.getWorkspaceStatus(cloned.id, true);
      expect(
        mergedStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
      ).toMatchObject({
        upstream: "origin/feat/promoted-reference",
        mergedIntoDefault: true,
      });
    }, 20_000);
    it("keeps the original force-push lease across repeated rebases and remote writers", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath, selectedMainPath, sandbox } =
        scenario;
      const input = { workspaceId: cloned.id, repositoryId: selectedMainRepository.id };
      const originalRemote = (
        await base.git(clonedMainPath, "rev-parse", "origin/feat/promoted-reference")
      ).stdout.trim();
      await base.commit(selectedMainPath, "main-next.txt");
      await base.git(selectedMainPath, "push", "-q", "origin", "main");
      await manager.rebaseWorkspaceMember(input);
      const writer = join(sandbox, "lease-writer");
      await base.git(
        sandbox,
        "clone",
        "-q",
        "--branch",
        "feat/promoted-reference",
        `file://${join(sandbox, "selected-main.git")}`,
        writer,
      );
      await base.commit(writer, "remote-next.txt");
      await base.git(writer, "push", "-q", "origin", "HEAD");
      const remoteHead = (await base.git(writer, "rev-parse", "HEAD")).stdout.trim();
      await manager.rebaseWorkspaceMember(input);
      const member = (await manager.searchWorkspaces()).find((w) => w.id === cloned.id)!
        .members[0]!;
      expect(member).toMatchObject({ forcePushBase: originalRemote });
      const unchanged = await manager.promoteWorkspaceReference({
        ...input,
        branch: "feat/promoted-reference",
      });
      expect(unchanged.members[0]).toMatchObject({ forcePushBase: originalRemote });
      await expect(manager.pushWorkspaceMember({ ...input, force: true })).rejects.toMatchObject({
        code: "GIT_FAILED",
      });
      expect(
        (await base.git(writer, "ls-remote", "origin", "refs/heads/feat/promoted-reference")).stdout
          .trim()
          .split("\t")[0],
      ).toBe(remoteHead);
    }, 20000);
    it("does not arm a force-push lease for remote commits the checkout never contained", async () => {
      const { manager, cloned, selectedMainRepository, sandbox } = scenario;
      const writer = join(sandbox, "unseen-remote-writer");
      await base.git(
        sandbox,
        "clone",
        "-q",
        "--branch",
        "feat/promoted-reference",
        `file://${join(sandbox, "selected-main.git")}`,
        writer,
      );
      await base.commit(writer, "unseen-remote.txt");
      await base.git(writer, "push", "-q", "origin", "HEAD");
      const remoteHead = (await base.git(writer, "rev-parse", "HEAD")).stdout.trim();
      await expect(
        manager.rebaseWorkspaceMember({
          workspaceId: cloned.id,
          repositoryId: selectedMainRepository.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await manager.searchWorkspaces()).find((workspace) => workspace.id === cloned.id)!
          .members[0],
      ).not.toHaveProperty("forcePushBase");
      expect(
        (await base.git(writer, "ls-remote", "origin", "refs/heads/feat/promoted-reference")).stdout
          .trim()
          .split("\t")[0],
      ).toBe(remoteHead);
    }, 20000);
    it("integrates a remote writer before pushing local development", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath, sandbox } = scenario;
      await writeFile(join(clonedMainPath, "local-next.txt"), "local next\n");
      await execFileAsync("git", ["-C", clonedMainPath, "add", "local-next.txt"]);
      await execFileAsync("git", ["-C", clonedMainPath, "commit", "-q", "-m", "local next"]);
      const remoteWriterPath = join(sandbox, "remote-writer");
      await execFileAsync("git", [
        "clone",
        "-q",
        "--branch",
        "feat/promoted-reference",
        `file://${join(sandbox, "selected-main.git")}`,
        remoteWriterPath,
      ]);
      await execFileAsync("git", ["-C", remoteWriterPath, "config", "user.name", "Remote Writer"]);
      await execFileAsync("git", [
        "-C",
        remoteWriterPath,
        "config",
        "user.email",
        "remote@example.com",
      ]);
      await writeFile(join(remoteWriterPath, "remote-next.txt"), "remote next\n");
      await execFileAsync("git", ["-C", remoteWriterPath, "add", "remote-next.txt"]);
      await execFileAsync("git", ["-C", remoteWriterPath, "commit", "-q", "-m", "remote next"]);
      await execFileAsync("git", ["-C", remoteWriterPath, "push", "-q", "origin", "HEAD"]);

      await expect(
        manager.pushWorkspaceMember({
          workspaceId: cloned.id,
          repositoryId: selectedMainRepository.id,
        }),
      ).resolves.toBeUndefined();
      const remoteAdvancedStatus = await manager.getWorkspaceStatus(cloned.id);
      expect(
        remoteAdvancedStatus.members.find(
          (status) => status.repositoryId === selectedMainRepository.id,
        ),
      ).toMatchObject({
        upstream: "origin/feat/promoted-reference",
        unpushed: 0,
      });
    }, 20_000);
    it("converts back to a reference and switches to existing local or remote branches", async () => {
      const { manager, cloned, selectedMainRepository, clonedMainPath, selectedMainPath } =
        scenario;
      const convertedBack = await manager.convertWorkspaceToReference({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      });
      expect(convertedBack.members[0]).toMatchObject({
        repositoryId: selectedMainRepository.id,
        branch: "origin/main",
        detached: true,
      });
      const [convertedBranch, preservedDevelopmentBranch] = await Promise.all([
        execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
        execFileAsync("git", [
          "-C",
          selectedMainPath,
          "show-ref",
          "--verify",
          "refs/heads/feat/promoted-reference",
        ]),
      ]);
      expect(convertedBranch.stdout.trim()).toBe("");
      expect(preservedDevelopmentBranch.stdout.trim()).not.toBe("");
      await execFileAsync("git", [
        "-C",
        selectedMainPath,
        "branch",
        "-D",
        "feat/promoted-reference",
      ]);

      const switchedToExistingMain = await manager.promoteWorkspaceReference({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
        branch: "main",
      });
      expect(switchedToExistingMain.members[0]).toMatchObject({
        branch: "main",
        mode: "worktree",
      });
      const existingMainStatus = await manager.getWorkspaceStatus(cloned.id);
      expect(
        existingMainStatus.members.find(
          (status) => status.repositoryId === selectedMainRepository.id,
        ),
      ).toMatchObject({
        branch: "main",
        defaultBranch: "origin/main",
        ahead: 0,
        behind: 0,
      });
      const switchedDevelopmentBranch = await manager.promoteWorkspaceReference({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
        branch: "feat/promoted-reference",
      });
      expect(switchedDevelopmentBranch.members[0]).toMatchObject({
        branch: "feat/promoted-reference",
        mode: "worktree",
      });
      await expect(
        execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
      ).resolves.toMatchObject({ stdout: "feat/promoted-reference\n" });
      await expect(
        execFileAsync("git", [
          "-C",
          clonedMainPath,
          "for-each-ref",
          "--format=%(upstream:short)",
          "refs/heads/feat/promoted-reference",
        ]),
      ).resolves.toMatchObject({ stdout: "origin/feat/promoted-reference\n" });
    }, 20_000);
  });
});
