// Starts Living Map for the living-map skill, if it is not running already,
// detached from the conversation that asked: the server outlives it, so a map
// opened from one conversation stays up for the next one and every browser.
//
//   node skill/start.ts     (PORT moves it; the log is ~/.living-map/server.log)

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4317);
const HOME = process.env.LIVING_MAP_HOME
  ? path.resolve(process.env.LIVING_MAP_HOME)
  : path.join(os.homedir(), ".living-map");
const LOG = path.join(HOME, "server.log");

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/health`);
    return ((await r.json()) as { app?: string }).app === "living-map";
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], log: number) {
  const r = spawnSync(cmd, args, {
    cwd: APP_DIR,
    stdio: ["ignore", log, log],
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`\`${cmd} ${args.join(" ")}\` failed; see ${LOG}`);
    process.exit(1);
  }
}

if (await healthy()) {
  console.log(`Living Map is running on http://localhost:${PORT}/`);
  process.exit(0);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 23 || (major === 23 && minor < 6)) {
  console.error(
    `Living Map needs Node 23.6 or newer; this is ${process.versions.node}.`,
  );
  process.exit(1);
}

fs.mkdirSync(HOME, { recursive: true });
const log = fs.openSync(LOG, "a");
if (!fs.existsSync(path.join(APP_DIR, "node_modules"))) run("npm", ["ci"], log);
run("npm", ["run", "build"], log);

// its own process group, with nothing tied to this one: ending the
// conversation that ran this does not end the server
const server = spawn(
  process.execPath,
  [path.join(APP_DIR, "server", "launcher.ts")],
  {
    cwd: APP_DIR,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(PORT) },
  },
);
server.unref();

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await healthy()) {
    console.log(`Living Map started on http://localhost:${PORT}/`);
    process.exit(0);
  }
}
console.error(`Living Map did not start; the end of ${LOG}:`);
console.error(fs.readFileSync(LOG, "utf8").split("\n").slice(-20).join("\n"));
process.exit(1);
