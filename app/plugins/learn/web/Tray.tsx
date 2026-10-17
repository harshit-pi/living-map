import { useState } from "react";

import { PART_DRAG } from "./BuildCanvas.tsx";
import { nextSpot } from "./frame.ts";
import type { Here } from "./view.ts";
import { FAMILIES, familyOf, type Family, type StepView } from "../shared.ts";

// The parts not yet placed and the verbs this frame takes. Click a part to
// place it, or drag it where it goes. At L3 there are no names to pick from:
// you type each part, and the server matches it (its accepted names, then
// spelling) or offers "did you mean" from Claude's own labels.
export function Tray({ here, st }: { here: Here; st: StepView }) {
  const { act } = here;
  const [text, setText] = useState("");
  const step = st.step;
  const spot = () => nextSpot(st.frame, st.placed);
  const typing = st.help === 3;

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const r = await act("type", { step, text: t, ...spot() });
    if (r.ok) setText("");
  };

  return (
    <aside className="flex max-h-[132px] w-full shrink-0 flex-col overflow-y-auto border-b border-line bg-canvas px-3 py-2 xl:max-h-none xl:w-[160px] xl:border-r xl:border-b-0 xl:py-3 2xl:w-[176px]">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        Parts
      </div>
      {st.trayCount === 0 ? (
        <div className="mt-1 text-[12px] text-muted">all placed</div>
      ) : typing ? (
        <div className="mt-1">
          <div className="text-[12px] text-muted">
            {st.trayCount} {st.trayCount === 1 ? "part" : "parts"} to name. Type
            one:
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="a part's name ⏎"
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-1 text-[12.5px] outline-hidden focus:border-primary"
          />
          {st.typed && st.typed.text && (
            <div className="mt-1.5 rounded-lg bg-panel px-2 py-1.5 text-[12px]">
              {st.typed.suggest.length ? (
                <>
                  <div className="text-muted">
                    “{st.typed.text}”: did you mean
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {st.typed.suggest.map((label) => (
                      <button
                        key={label}
                        onClick={() => {
                          void act("pick", { step, label, ...spot() }).then(
                            (r) => {
                              if (!r.error) setText("");
                            },
                          );
                        }}
                        title="Counts as hinted for this part"
                        className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-left text-body hover:border-primary"
                      >
                        {label}?
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-muted">
                  “{st.typed.text}” is not one of the parts. Try another name.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1 xl:block xl:space-y-1">
          {st.tray.map((p) => (
            <li key={p.id}>
              <button
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PART_DRAG, p.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => {
                  void act("place", { step, part: p.id, ...spot() });
                }}
                title={p.role}
                className="w-full cursor-grab rounded-lg border border-line-strong bg-surface px-2 py-1 text-left hover:border-primary active:cursor-grabbing"
              >
                <span className="block text-[12.5px] font-medium text-ink">
                  {p.label}
                </span>
                {p.role && (
                  <span className="block text-[10.5px] leading-snug text-muted">
                    {p.role}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* a narrow window keeps the room for the parts: the verbs are in the
          picker too */}
      <div className="mt-4 hidden text-[10px] font-semibold tracking-wide text-faint uppercase xl:block">
        Link verbs
      </div>
      <div className="mt-1 hidden space-y-1.5 xl:block">
        {(Object.keys(FAMILIES) as Family[])
          .filter((f) => st.verbs.some((v) => familyOf(v) === f))
          .map((f) => (
            <div key={f}>
              <div className="text-[10px] text-faint">{f}</div>
              <div className="text-[12px] leading-snug text-body">
                {st.verbs.filter((v) => familyOf(v) === f).join(" · ")}
              </div>
            </div>
          ))}
      </div>
    </aside>
  );
}
