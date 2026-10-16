// Keeping a copy up to date: compare the running checkout with the latest
// GitHub release, and on request pull it, install, build and restart.
//
//   check:  GitHub's latest release ── git fetch ──► commits behind? ──► banner
//   update: stop moves ► git pull --rebase ► npm ci ► npm run build ► restart

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { APP_DIR, RESTART_CODE, UNDER_LAUNCHER } from "./config.ts";
import type { UpdateInfo, UpdateStep } from "../shared/model.ts";

export type Run = (
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs?: number,
) => Promise<string>;

const run: Run = (cmd, args, cwd = APP_DIR, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err)
          reject(
            new Error(
              (stderr || stdout || err.message)
                .trim()
                .split("\n")
                .slice(-4)
                .join("\n"),
            ),
          );
        else resolve(stdout.trim());
      },
    );
  });

// owner/name of the GitHub repository, from package.json's "repository"
export function repoSlug(pkg: {
  repository?: { url?: string } | string;
}): string | null {
  const url =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const m = url?.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"),
);
const SLUG = repoSlug(pkg);

export type Release = {
  tag_name: string;
  body?: string;
  html_url: string;
  published_at: string;
};

async function latestRelease(): Promise<Release | null> {
  if (!SLUG) return null;
  const r = await fetch(
    `https://api.github.com/repos/${SLUG}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "living-map",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (r.status === 404) return null; // no release published yet
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return (await r.json()) as Release;
}

// Why a one-click update cannot run in this checkout, or "" when it can.
async function blocker(git: Run): Promise<string> {
  try {
    await git("git", ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return "This copy is not a git checkout, so it cannot update itself. Download the latest release from GitHub.";
  }
  const branch = await git("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main")
    return `This copy is on the branch "${branch}"; updates run on main.`;
  const changed = await git("git", [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (changed)
    return "This copy has local changes. Commit or stash them, then update.";
  return "";
}

let cached: { at: number; info: UpdateInfo } | null = null;
const FRESH_MS = 30 * 60_000;

export async function checkForUpdate({
  force = false,
  git = run,
  release = latestRelease,
}: {
  force?: boolean;
  git?: Run;
  release?: () => Promise<Release | null>;
} = {}): Promise<UpdateInfo> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.info;
  const sha = await git("git", ["rev-parse", "HEAD"]).catch(() => "");
  const reason = sha
    ? await blocker(git)
    : "This copy is not a git checkout, so it cannot update itself.";
  let latest: UpdateInfo["latest"] = null;
  let behind = 0;
  try {
    const rel = await release();
    if (rel) {
      latest = {
        version: rel.tag_name,
        notes: rel.body ?? "",
        url: rel.html_url,
        publishedAt: rel.published_at,
      };
      if (sha) {
        await git(
          "git",
          ["fetch", "--quiet", "--tags", "origin"],
          APP_DIR,
          30_000,
        );
        behind = Number(
          await git("git", ["rev-list", "--count", `HEAD..${rel.tag_name}`]),
        );
      }
    }
  } catch {
    // offline, or GitHub unreachable: report no update rather than fail
  }
  const version = sha
    ? await git("git", ["describe", "--tags", "--always"]).catch(() =>
        sha.slice(0, 7),
      )
    : String(pkg.version ?? "");
  const info: UpdateInfo = {
    current: { version, sha },
    latest,
    available: behind > 0,
    behind,
    canUpdate: !reason,
    reason,
    restarts: UNDER_LAUNCHER,
  };
  cached = { at: Date.now(), info };
  return info;
}

let updating = false;

// Pull, install, build, then restart (under the launcher). Each step is
// reported as it runs. A failed pull is rolled back, so the copy is never left
// half-rebased.
export async function runUpdate(
  report: (s: UpdateStep) => void,
  {
    beforeRestart,
    git = run,
  }: { beforeRestart: () => Promise<void>; git?: Run },
): Promise<{ ok: boolean; error?: string }> {
  if (updating) return { ok: false, error: "An update is already running." };
  updating = true;
  const step = async (name: string, work: () => Promise<unknown>) => {
    report({ step: name, state: "running" });
    try {
      await work();
      report({ step: name, state: "done" });
    } catch (e) {
      report({ step: name, state: "failed", message: (e as Error).message });
      throw e;
    }
  };
  try {
    const reason = await blocker(git);
    if (reason) throw new Error(reason);
    await step("Stopping Claude's current move", beforeRestart);
    await step("Getting the new version", async () => {
      try {
        await git(
          "git",
          ["pull", "--rebase", "origin", "main"],
          APP_DIR,
          120_000,
        );
      } catch (e) {
        await git("git", ["rebase", "--abort"]).catch(() => {});
        throw e;
      }
    });
    await step("Installing what it needs", () =>
      git("npm", ["ci", "--no-audit", "--no-fund"], APP_DIR, 600_000),
    );
    await step("Building the app", () =>
      git("npm", ["run", "build"], APP_DIR, 300_000),
    );
    cached = null;
    if (UNDER_LAUNCHER) {
      report({ step: "Restarting", state: "running" });
      setTimeout(() => process.exit(RESTART_CODE), 300);
    } else {
      report({
        step: "Restart Living Map to finish",
        state: "done",
        message: "Stop it in its terminal and run npm start again.",
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    updating = false;
  }
}
