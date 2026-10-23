// Your Claude Code conversations, as Claude Code keeps them on disk: one JSONL
// file per conversation under ~/.claude/projects/<folder for its cwd>/. A map
// linked to one resumes it (forked, never written to) on every move, so the
// model works the canvas knowing everything said there.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Conversation } from "./types.ts";

export const claudeHome = () =>
  process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");

const isId = (id: string) => /^[\w-]{1,80}$/.test(id);

// Claude Code names a project's folder after its cwd, every other character a dash
export const projectFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

// the file a conversation is kept in, wherever its project folder is
export function conversationFile(
  id: string,
  home = claudeHome(),
): string | null {
  if (!isId(id)) return null;
  const projects = path.join(home, "projects");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(projects, d, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// changes whenever the conversation does: a process started on an older
// version of it would answer without what was said since
export function conversationStamp(file: string | undefined): string {
  if (!file) return "";
  try {
    const s = fs.statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "";
  }
}

// The cwd it started in (where `--resume` finds it) and a title: the
// conversation's own if it has one, else its first words.
function describe(file: string): { cwd: string; title: string } | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let cwd = "";
  let first = "";
  let named = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof d.cwd === "string") cwd = d.cwd;
    if (d.type === "custom-title" && typeof d.customTitle === "string")
      named = d.customTitle;
    if (!named && d.type === "summary" && typeof d.summary === "string")
      named = d.summary;
    if (!first && d.type === "user" && !d.isSidechain) {
      const c = d.message?.content;
      const words =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? (c.find((b: { type?: string }) => b?.type === "text")?.text ?? "")
            : "";
      // reminders and command output the app adds are not what you said
      if (words && !words.trimStart().startsWith("<")) first = words;
    }
  }
  if (!cwd) return null;
  const title = (named || first).replace(/\s+/g, " ").trim();
  return {
    cwd,
    title: title.length > 80 ? `${title.slice(0, 80).trimEnd()}…` : title,
  };
}

// The conversation the skill names (its id), or else the newest one in the
// folder it runs in.
export function findConversation(
  hint: { id?: string; cwd?: string },
  home = claudeHome(),
): Conversation | null {
  let file = hint.id ? conversationFile(hint.id, home) : null;
  if (!file && hint.cwd) {
    const dir = path.join(home, "projects", projectFolder(hint.cwd));
    try {
      file =
        fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl") && isId(f.slice(0, -6)))
          .map((f) => path.join(dir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ??
        null;
    } catch {
      file = null;
    }
  }
  if (!file) return null;
  const about = describe(file);
  if (!about) return null;
  return { id: path.basename(file, ".jsonl"), file, ...about };
}
