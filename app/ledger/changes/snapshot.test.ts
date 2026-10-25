// Live snapshots: a shadow repository per work tree, never your own .git;
// secrets, binaries and big files stay out; two snapshots compare into the
// same statements the readers give, with turn evidence.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { compare, gitEnv, shadowFor, snapshot } from "./snapshot.ts";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
    env: gitEnv(),
  }).toString();

function repo() {
  const root = tmp("lm-repo-");
  sh(root, "init", "-q");
  fs.mkdirSync(path.join(root, "app/server"), { recursive: true });
  fs.mkdirSync(path.join(root, "app/layer"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { express: "^5.0.0" } }),
  );
  fs.writeFileSync(
    path.join(root, "app/server/index.ts"),
    'import express from "express";\n',
  );
  fs.writeFileSync(
    path.join(root, "app/layer/core.ts"),
    "export const x = 1;\n",
  );
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
  sh(root, "add", "-A");
  sh(
    root,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "-m",
    "init",
  );
  return root;
}

test("no shadow outside a git work tree", () => {
  assert.equal(shadowFor(tmp("lm-home-"), tmp("lm-plain-")), null);
});

test("two snapshots compare into statements, and your own repo is untouched", () => {
  const home = tmp("lm-home-");
  const root = repo();
  const indexAt = fs.statSync(path.join(root, ".git/index")).mtimeMs;
  const s = shadowFor(home, path.join(root, "app"))!;
  assert.equal(s.root, fs.realpathSync(root));
  const a = snapshot(s, "before turn 1")!;

  fs.writeFileSync(
    path.join(root, "app/server/index.ts"),
    'import express from "express";\nimport { x } from "../layer/core.ts";\n',
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { express: "^5.0.0", zod: "^4.0.0" } }),
  );
  fs.writeFileSync(path.join(root, ".env"), "API_KEY=sk-live-123\n");
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(1_100_000));
  fs.mkdirSync(path.join(root, "ignored"));
  fs.writeFileSync(path.join(root, "ignored/a.ts"), 'import "fs";\n');
  const b = snapshot(s, "after turn 1")!;

  const r = compare(s, a, b, 1);
  const texts = r.statements.map((x) => `${x.op} ${x.kind} ${x.key}`);
  assert.ok(
    texts.some(
      (t) =>
        t.startsWith("added import-edge") &&
        t.includes("app/server") &&
        t.includes("app/layer"),
    ),
    texts.join("\n"),
  );
  assert.ok(
    texts.some((t) => t.startsWith("added dependency") && t.includes("zod")),
    texts.join("\n"),
  );
  assert.ok(r.statements.every((x) => x.evidence.every((e) => e.turn === 1)));
  const copied = execFileSync(
    "git",
    [`--git-dir=${s.gitDir}`, "ls-tree", "-r", "--name-only", b],
    { env: gitEnv() },
  ).toString();
  assert.doesNotMatch(copied, /\.env|big\.txt|ignored\//);
  // nothing staged in your index, which keeps its time
  assert.equal(sh(root, "diff", "--cached", "--name-only"), "");
  assert.equal(fs.statSync(path.join(root, ".git/index")).mtimeMs, indexAt);
});

test("a git hook's GIT_INDEX_FILE never reaches your own index", () => {
  const home = tmp("lm-home-");
  const root = repo();
  const index = path.join(root, ".git/index");
  const before = fs.readFileSync(index);
  fs.writeFileSync(
    path.join(root, "app/layer/core.ts"),
    "export const x = 2;\n",
  );
  const was = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = index;
  try {
    const s = shadowFor(home, path.join(root, "app"))!;
    assert.ok(snapshot(s, "inside a hook"));
  } finally {
    if (was === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = was;
  }
  assert.ok(fs.readFileSync(index).equals(before));
});

test("a turn that changes only unreadable files gives no statements, and says which changed", () => {
  const home = tmp("lm-home-");
  const root = repo();
  const s = shadowFor(home, root)!;
  const a = snapshot(s, "a")!;
  fs.writeFileSync(path.join(root, "README.md"), "# hi\n");
  const b = snapshot(s, "b")!;
  const r = compare(s, a, b);
  assert.deepEqual(r.statements, []);
  assert.deepEqual(r.changed, [
    { file: "README.md", status: "A", readable: false },
  ]);
});
