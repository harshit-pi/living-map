import { useRef, useState } from "react";

import { PART_DRAG } from "./BuildCanvas.tsx";
import { nextSpot } from "./frame.ts";
import { slotWord, type Here } from "./view.ts";
import type { StepView } from "../shared.ts";

// The parts not yet placed and the verbs this frame takes. Click a part to
// place it, or drag it where it goes. At L3 there are no names to pick from:
// you type each part, and the server matches it (its accepted names, then
// spelling) or offers "did you mean" from Claude's own labels.
export function Tray({ here, st }: { here: Here; st: StepView }) {
  const { act } = here;
  const [text, setText] = useState("");
  const step = st.step;
  // The spots sent for parts the server has not sent back yet, until it
  // does (or refuses): one is back when a part sits on its spot, or when
  // as many parts are placed as there would be with it (a part dragged
  // off its spot at once). The next spot was worked out from the parts on
  // screen, which lag a click by a round trip: two parts clicked (or two
  // names typed) one straight after the other were sent the same spot, and
  // one sat on top of the other.
  const flying = useRef<
    { x: number; y: number; slot?: string; count: number }[]
  >([]);
  const spot = () => {
    flying.current = flying.current.filter(
      (f) =>
        st.placed.length < f.count &&
        !st.placed.some((p) => p.x === f.x && p.y === f.y),
    );
    const next = nextSpot(
      st.frame,
      [...st.placed, ...flying.current],
      st.placed.length + st.trayCount,
    );
    const sent = {
      ...next,
      count: st.placed.length + flying.current.length + 1,
    };
    flying.current.push(sent);
    return {
      spot: next,
      // a part the server did not place frees its spot at once
      done: (r: { ok?: boolean; error?: string }) => {
        if (r.error || r.ok === false)
          flying.current = flying.current.filter((f) => f !== sent);
      },
    };
  };
  const typing = st.help === 3;
  const loose =
    st.frame.kind === "free" ? 0 : st.placed.filter((p) => !p.slot).length;

  // The box empties at Enter, so the next name typed straight after it is
  // a name of its own (kept until the reply, the two ran together: "real
  // returnpurchasing power"); a name that matched nothing comes back to be
  // corrected, unless you have typed on since.
  const clear = (sent: string) => setText((cur) => (cur === sent ? "" : cur));
  const send = async () => {
    const sent = text;
    const t = sent.trim();
    if (!t) return;
    setText("");
    const at = spot();
    const r = await act("type", { step, text: t, ...at.spot });
    at.done(r);
    if (!r.ok) setText((cur) => (cur === "" ? sent : cur));
  };

  return (
    <aside className="flex max-h-[132px] w-full shrink-0 flex-col overflow-y-auto border-b border-line bg-canvas px-3 py-2 xl:max-h-none xl:w-[160px] xl:border-r xl:border-b-0 xl:py-3 2xl:w-[176px]">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        Parts
      </div>
      {st.trayCount === 0 ? (
        // all on the canvas is not all placed: "all placed" sat beside
        // seven parts still in "Not in a column yet"
        <div className="mt-1 text-[12px] text-muted">
          {loose > 0
            ? `all on the canvas · ${loose} still to put in a ${slotWord(st.frame)}`
            : "all placed"}
        </div>
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
                          const sent = text;
                          const at = spot();
                          void act("pick", { step, label, ...at.spot }).then(
                            (r) => {
                              at.done(r);
                              if (!r.error) clear(sent);
                            },
                          );
                        }}
                        title="Counts as hinted for this part"
                        className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-left text-body hover:border-primary"
                      >
                        <span data-content>{label}</span>?
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
                  const at = spot();
                  void act("place", { step, part: p.id, ...at.spot }).then(
                    at.done,
                  );
                }}
                title={p.role}
                className="w-full cursor-grab rounded-lg border border-line-strong bg-surface px-2 py-1 text-left hover:border-primary active:cursor-grabbing"
              >
                <span
                  className="block text-[12.5px] font-medium text-ink"
                  data-content
                >
                  {p.label}
                </span>
                {p.role && (
                  <span
                    className="block text-[10.5px] leading-snug text-muted"
                    data-content
                  >
                    {p.role}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* no legend of the verbs: they are in the picker that opens when
          you link two parts, the one place they are used */}
    </aside>
  );
}
