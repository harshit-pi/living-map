// After the choice: how it could fail (Claude's pre-mortem, and yours), the
// assumptions it rests on with the first sign each one broke, and the next
// steps. Claude writes them in the wrap turn after you choose; you mark what
// held, tick what is done, and add your own.

import { useState } from "react";

import { Btn } from "./ui.tsx";
import type { Here } from "./view.ts";
import type { BoardView } from "../shared.ts";

const field =
  "w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-[12.5px] text-ink focus:border-primary focus:outline-none";
const head =
  "mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted";

export function AfterChoice({ here, board }: { here: Here; board: BoardView }) {
  const c = board.commit;
  const q = board.question;
  const [assume, setAssume] = useState({ text: "", breaksIf: "" });
  const [step, setStep] = useState({ when: "", do: "" });
  if (!c) return null;
  const working = here.ws.live.working;
  const writing =
    !!working &&
    working.nodeId === c.option &&
    /pre-mortem/i.test(working.label);
  const empty =
    !c.premortem.claude.length &&
    !board.assumptions.length &&
    !board.steps.length;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink">
          After the choice
        </h3>
        {c.sure !== undefined && (
          <span className="text-xs text-muted">You were {c.sure}% sure.</span>
        )}
        {writing ? (
          <span className="flex items-center gap-1.5 text-xs text-primary-strong">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            Claude is writing how it could fail…
          </span>
        ) : (
          empty && (
            <Btn
              small
              primary
              busy={here.busy}
              onClick={() => void here.act("wrap", { q })}
            >
              Write the pre-mortem ▸
            </Btn>
          )
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className={head}>If it failed, why?</div>
          <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-[12.5px] leading-snug text-body">
            {c.premortem.claude.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
          <label className="block text-xs text-muted">
            yours:
            <input
              // the server's text is the start value; a new one replaces it
              key={c.premortem.you ?? ""}
              defaultValue={c.premortem.you ?? ""}
              placeholder="…optional"
              maxLength={240}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const text = e.currentTarget.value.trim();
                if (text !== (c.premortem.you ?? ""))
                  void here.act("premortem", { q, text });
              }}
              className={`mt-1 ${field}`}
            />
          </label>
        </div>
        <div>
          <div className={head}>Assumptions</div>
          <ul className="mb-2 space-y-2">
            {board.assumptions.map((a) => (
              <li key={a.id} className="text-[12.5px] leading-snug">
                <div className="text-ink">
                  {a.status === "broken"
                    ? "✕ "
                    : a.status === "holds"
                      ? "✓ "
                      : "▲ "}
                  {a.text}
                  {a.by === "you" && (
                    <span className="ml-1 text-[10.5px] font-semibold">
                      you
                    </span>
                  )}
                </div>
                {a.breaksIf && (
                  <div className="text-muted">breaks if: {a.breaksIf}</div>
                )}
                <div className="mt-0.5 flex items-center gap-1 text-xs">
                  {(["holds", "broken"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() =>
                        void here.act("assume", {
                          q,
                          id: a.id,
                          status: a.status === st ? "untested" : st,
                        })
                      }
                      className={`rounded-full border px-2 py-0.5 ${a.status === st ? (st === "broken" ? "border-danger bg-danger-soft text-danger-strong" : "border-success bg-success-soft text-success-strong") : "border-line-strong text-body hover:border-primary"}`}
                    >
                      {st === "holds" ? "holds" : "broke"}
                    </button>
                  ))}
                  {a.status === "untested" && (
                    <span className="text-faint">untested</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!assume.text.trim()) return;
              void here.act("assume", { q, ...assume });
              setAssume({ text: "", breaksIf: "" });
            }}
            className="space-y-1"
          >
            <input
              value={assume.text}
              onChange={(e) => setAssume({ ...assume, text: e.target.value })}
              placeholder="+ an assumption of yours"
              maxLength={120}
              className={field}
            />
            {assume.text && (
              <input
                value={assume.breaksIf}
                onChange={(e) =>
                  setAssume({ ...assume, breaksIf: e.target.value })
                }
                placeholder="breaks if… (the first sign you would see)"
                maxLength={120}
                className={field}
              />
            )}
            {assume.text && (
              <button
                type="submit"
                className="rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-medium text-on-primary hover:bg-primary-strong"
              >
                Add
              </button>
            )}
          </form>
        </div>
        <div>
          <div className={head}>Next steps</div>
          <ul className="mb-2 space-y-1">
            {board.steps.map((s) => (
              <li key={s.id}>
                <label className="flex items-start gap-1.5 text-[12.5px] leading-snug text-body">
                  <input
                    type="checkbox"
                    checked={!!s.done}
                    onChange={(e) =>
                      void here.act("step", {
                        q,
                        id: s.id,
                        done: e.target.checked,
                      })
                    }
                    className="mt-0.5"
                  />
                  <span className={s.done ? "text-muted line-through" : ""}>
                    {s.when && <>{s.when} → </>}
                    {s.do}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!step.do.trim()) return;
              void here.act("step", { q, ...step });
              setStep({ when: "", do: "" });
            }}
            className="space-y-1"
          >
            <input
              value={step.do}
              onChange={(e) => setStep({ ...step, do: e.target.value })}
              placeholder="+ step"
              maxLength={100}
              className={field}
            />
            {step.do && (
              <input
                value={step.when}
                onChange={(e) => setStep({ ...step, when: e.target.value })}
                placeholder="when… (optional)"
                maxLength={90}
                className={field}
              />
            )}
            {step.do && (
              <button
                type="submit"
                className="rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-medium text-on-primary hover:bg-primary-strong"
              >
                Add
              </button>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
