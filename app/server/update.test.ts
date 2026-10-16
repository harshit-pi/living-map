// The updater with a scripted git and GitHub: no real repository or network.

import assert from "node:assert/strict";
import { test } from "vitest";

import { checkForUpdate, repoSlug, runUpdate, type Run } from "./update.ts";
import type { UpdateStep } from "../shared/model.ts";

// a fake git/npm: answers by command line, records what ran
function fakeGit(answers: Record<string, string | Error>) {
  const ran: string[] = [];
  const git: Run = async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    ran.push(line);
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    const a = key === undefined ? "" : answers[key];
    if (a instanceof Error) throw a;
    return a;
  };
  return { git, ran };
}

const CLEAN = {
  "git rev-parse --is-inside-work-tree": "true",
  "git rev-parse --abbrev-ref HEAD": "main",
  "git status --porcelain": "",
};

const release = async () => ({
  tag_name: "v0.1.30",
  body: "## What's Changed\n* Faster checks",
  html_url: "https://github.com/x/y/releases/tag/v0.1.30",
  published_at: "2026-10-16T12:00:00Z",
});

test("the repository is read from package.json", () => {
  assert.equal(
    repoSlug({
      repository: { url: "https://github.com/harshit-pi/living-map.git" },
    }),
    "harshit-pi/living-map",
  );
  assert.equal(repoSlug({ repository: "git@github.com:a/b.git" }), "a/b");
  assert.equal(repoSlug({}), null);
});

test("a copy behind the latest release is offered the update", async () => {
  const { git } = fakeGit({
    ...CLEAN,
    "git rev-parse HEAD": "abc123",
    "git rev-list --count": "3",
    "git describe": "v0.1.27",
  });
  const info = await checkForUpdate({ force: true, git, release });
  assert.equal(info.available, true);
  assert.equal(info.behind, 3);
  assert.equal(info.latest?.version, "v0.1.30");
  assert.equal(info.current.version, "v0.1.27");
  assert.equal(info.canUpdate, true);
});

test("an up-to-date copy, or one with local changes, is not updated", async () => {
  const same = fakeGit({
    ...CLEAN,
    "git rev-parse HEAD": "abc",
    "git rev-list --count": "0",
  });
  assert.equal(
    (await checkForUpdate({ force: true, git: same.git, release })).available,
    false,
  );
  const dirty = fakeGit({
    ...CLEAN,
    "git rev-parse HEAD": "abc",
    "git rev-list --count": "2",
    "git status --porcelain": " M app/web/App.tsx",
  });
  const info = await checkForUpdate({ force: true, git: dirty.git, release });
  assert.equal(info.canUpdate, false);
  assert.match(info.reason, /local changes/);
});

test("a lockfile rewritten by npm install does not block the update", async () => {
  const { git, ran } = fakeGit({
    ...CLEAN,
    "git status --porcelain": " M app/package-lock.json",
  });
  const r = await runUpdate(() => {}, { beforeRestart: async () => {}, git });
  assert.deepEqual(r, { ok: true });
  const reset = ran.indexOf("git checkout -- package-lock.json");
  assert.ok(reset >= 0 && reset < ran.indexOf("git pull --rebase origin main"));
});

test("being offline means no update, not an error", async () => {
  const { git } = fakeGit({ ...CLEAN, "git rev-parse HEAD": "abc" });
  const info = await checkForUpdate({
    force: true,
    git,
    release: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(info.available, false);
  assert.equal(info.latest, null);
});

test("an update pulls, installs and builds, reporting each step", async () => {
  const { git, ran } = fakeGit(CLEAN);
  const steps: UpdateStep[] = [];
  const r = await runUpdate((s) => steps.push(s), {
    beforeRestart: async () => {},
    git,
  });
  assert.deepEqual(r, { ok: true });
  assert.ok(ran.includes("git pull --rebase origin main"));
  assert.ok(ran.some((l) => l.startsWith("npm ci")));
  assert.ok(ran.includes("npm run build"));
  assert.deepEqual(
    steps.filter((s) => s.state === "done").map((s) => s.step),
    [
      "Stopping Claude's current move",
      "Getting the new version",
      "Installing what it needs",
      "Building the app",
      "Restart Living Map to finish",
    ],
  );
});

test("a pull that fails is rolled back and nothing is installed", async () => {
  const { git, ran } = fakeGit({
    ...CLEAN,
    "git pull": new Error("CONFLICT in app/web/App.tsx"),
  });
  const steps: UpdateStep[] = [];
  const r = await runUpdate((s) => steps.push(s), {
    beforeRestart: async () => {},
    git,
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /CONFLICT/);
  assert.ok(
    ran.includes("git rebase --abort"),
    "the half-done rebase is undone",
  );
  assert.ok(
    !ran.some((l) => l.startsWith("npm")),
    "nothing installed or built",
  );
  assert.equal(steps.at(-1)?.state, "failed");
});
