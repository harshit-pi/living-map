// What Claude is on, from its own task list, with no model: the calls it made
// to keep that list (the desktop app's update_plan and wrap_up, TodoWrite,
// TaskCreate and TaskUpdate) replayed in order. Read live, so the strip says
// what Claude is doing even mid-turn, and never guesses.

import type { Entry } from "./transcript.ts";

export type Step = { content: string; status: "pending" | "doing" | "done" };
export type Plan = { steps: Step[]; doing: string | null };

type Raw = Record<string, unknown>;
const obj = (x: unknown): Raw => (x && typeof x === "object" ? (x as Raw) : {});
const status = (s: unknown): Step["status"] =>
  s === "in_progress" ? "doing" : s === "completed" ? "done" : "pending";

export function planOf(path: Entry[]): Plan {
  let steps: Step[] = [];
  // the Task tools number their tasks in the order they were made
  let tasks = 0;
  const byTask = new Map<string, number>();
  for (const e of path)
    for (const call of e.plan ?? []) {
      const input = obj(call.input);
      const tool = call.tool.replace(/^.*__/, "");
      if (tool === "update_plan") {
        if (Array.isArray(input.items))
          steps = input.items.map((i) => ({
            content: String(obj(i).content ?? ""),
            status: status(obj(i).status),
          }));
        if (input.advance === true) {
          const at = steps.findIndex((s) => s.status === "doing");
          if (at >= 0) steps[at]!.status = "done";
          const next = steps.findIndex(
            (s, i) => i > at && s.status === "pending",
          );
          if (next >= 0) steps[next]!.status = "doing";
        }
        if (Array.isArray(input.done))
          for (const n of input.done)
            if (typeof n === "number" && steps[n - 1])
              steps[n - 1]!.status = "done";
        if (typeof input.start === "number" && steps[input.start - 1])
          steps[input.start - 1]!.status = "doing";
      } else if (tool === "wrap_up") {
        // a turn's wrap-up ticks off what is left of its list
        for (const s of steps) s.status = "done";
      } else if (tool === "TodoWrite" && Array.isArray(input.todos)) {
        steps = input.todos.map((t) => ({
          content: String(obj(t).activeForm ?? obj(t).content ?? ""),
          status: status(obj(t).status),
        }));
      } else if (tool === "TaskCreate") {
        byTask.set(String(++tasks), steps.length);
        steps.push({
          content: String(input.subject ?? input.description ?? ""),
          status: "pending",
        });
      } else if (tool === "TaskUpdate") {
        const at = byTask.get(String(input.taskId ?? ""));
        if (at !== undefined && steps[at] && typeof input.status === "string")
          steps[at]!.status = status(input.status);
      }
    }
  const doing = steps.filter((s) => s.status === "doing").at(-1)?.content;
  return { steps, doing: doing || null };
}
