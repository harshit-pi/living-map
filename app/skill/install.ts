// The living-map skill, for your own Claude Code: it starts this app, links
// the conversation it is used in, and opens the map beside it. `npm run skill`
// installs it in ~/.claude/skills; a server that starts with it installed
// writes it again, so an update reaches it too.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(APP_DIR, "skill", "SKILL.md");
// marks a file this app wrote, so one you made yourself is never replaced
const MARK = "living-map-skill:";

export const skillFile = () =>
  path.join(
    process.env.CLAUDE_CONFIG_DIR
      ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
      : path.join(os.homedir(), ".claude"),
    "skills",
    "living-map",
    "SKILL.md",
  );

export function skillText(port: number | string): string {
  return fs
    .readFileSync(TEMPLATE, "utf8")
    .replaceAll("{{APP_DIR}}", APP_DIR)
    .replaceAll("{{PORT}}", String(port));
}

// write it: always when asked (`force`), else only over a copy this app wrote
export function installSkill(
  port: number | string,
  { force = false, file = skillFile() } = {},
): "installed" | "updated" | "unchanged" | "skipped" {
  const text = skillText(port);
  let old: string | null;
  try {
    old = fs.readFileSync(file, "utf8");
  } catch {
    old = null;
  }
  if (old === text) return "unchanged";
  if (!force && (old === null || !old.includes(MARK))) return "skipped";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return old === null ? "installed" : "updated";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = installSkill(process.env.PORT ?? 4317, { force: true });
  console.log(
    `${r === "unchanged" ? "Already installed" : r === "updated" ? "Updated" : "Installed"}: ${skillFile()}\nIn any Claude Code conversation, say "/living-map" (or "map this") to open a map of it.`,
  );
}
