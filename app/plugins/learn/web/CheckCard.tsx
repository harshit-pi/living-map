import { useState } from "react";

import { ArgueBox, SmallBtn } from "./BuildCanvas.tsx";
import { MARK, WAIT_TITLE, type Here } from "./view.ts";
import {
  orderStops,
  SURES,
  type LinkView,
  type Mark,
  type StepView,
  type Sure,
} from "../shared.ts";

const SURE_WORD: Record<Sure, string> = {
  guess: "guess",
  fairly: "fairly",
  sure: "sure",
};

export function HowSure({
  value,
  onPick,
}: {
  value: Sure | null;
  onPick: (s: Sure) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted">
      How sure?
      {SURES.map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className={`rounded-full border px-2 py-0.5 ${value === s ? "border-primary bg-primary-soft text-primary-strong" : "border-line-strong text-body hover:border-primary"}`}
        >
          {SURE_WORD[s]}
        </button>
      ))}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// The check card beside a build: counts and places from the server's check,
// never the fix; the hint ladder after a first try; Show one link; how sure
// you are; and Argue for a link Claude's model does not have.
export function CheckCard({ here, st }: { here: Here; st: StepView }) {
  const { act, busy } = here;
  const step = st.step;
  const c = st.check;
  const [asking, setAsking] = useState(false);
  const shownKeys = st.links.filter((l) => l.given).length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
          {/* the try the card shows: the first check is try 1 */}
          Check{st.checks ? ` · try ${st.checks}` : ""}
        </div>
        {c?.keyOnly && (
          <span className="text-[11px] text-muted">key links only</span>
        )}
      </div>

      {!c ? (
        <p className="text-[12.5px] leading-snug text-muted">
          Build it from memory, then check. The check marks each link at once;
          hints open after your first check.
        </p>
      ) : (
        <>
          {/* the counts and marks are of the build as it was checked */}
          {st.changed && (
            <div className="text-[11.5px] text-muted">
              Your build changed since this check: check again to mark it.
            </div>
          )}
          <Counts st={st} />
        </>
      )}

      <CheckFindings here={here} st={st} />

      {st.hints.length > 0 && (
        <div className="space-y-1 border-t border-line pt-2">
          {st.hints.map((h, i) => (
            <div key={i} className="text-[12px] leading-snug text-body">
              <span className="font-medium text-hint-strong">
                Hint · {h.rung === 1 ? "where" : h.rung === 2 ? "ask" : "ghost"}
                :
              </span>{" "}
              {h.text}
            </div>
          ))}
        </div>
      )}

      {c && (
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
          <SmallBtn
            disabled={!st.canHint}
            title="Where, then a question, then the link drawn dashed. Instant."
            onClick={() => void act("hint", { step })}
          >
            Hint
          </SmallBtn>
          <SmallBtn
            disabled={!st.canHint}
            title={
              st.hintOn === "place"
                ? "Puts one part where it goes; it counts as shown"
                : "Draws one link for you; it counts as shown"
            }
            onClick={() => void act("showLink", { step })}
          >
            {st.hintOn === "place" ? "Show one place" : "Show one link"}
          </SmallBtn>
          {!st.reviewing && !st.recall && (
            <SmallBtn
              title="Shows the whole model as long as you want, then you rebuild it at L1. It counts as shown."
              onClick={() => void act("showModel", { step })}
            >
              Show the model
            </SmallBtn>
          )}
        </div>
      )}
      {shownKeys > 0 && st.help > 0 && (
        <div className="text-[11px] text-muted">
          Dashed links were drawn for you.
        </div>
      )}

      <div className="space-y-2 border-t border-line pt-2">
        <HowSure
          value={st.sure}
          onPick={(sure) => void act("sure", { step, sure })}
        />
        <button
          onClick={() => {
            setAsking(false);
            void act("check", { step });
          }}
          disabled={!st.placed.length}
          className="w-full rounded-lg bg-primary py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
        >
          {c ? "Check again" : "Check"}
        </button>
        {!c && !st.reviewing && !st.recall && (
          <button
            onClick={() => setAsking((v) => !v)}
            className="w-full text-[11.5px] text-muted hover:text-ink"
          >
            Stuck before you start?
          </button>
        )}
        {asking && (
          <div className="rounded-lg bg-panel px-2.5 py-1.5 text-[12px] leading-snug text-muted">
            Try one link first: a wrong try teaches more than a hint before it.
            If it is all gone,{" "}
            <button
              onClick={() => void act("showModel", { step })}
              className="text-primary-strong hover:underline"
            >
              peek at the worked case
            </button>{" "}
            (it counts as shown).
          </div>
        )}
      </div>
      {busy && (
        <div className="text-[11px] text-faint" title={WAIT_TITLE}>
          Checking and hints never wait on Claude.
        </div>
      )}
    </div>
  );
}

// the frame's word for a slot
const slotWord = (st: StepView) =>
  st.frame.kind === "lanes"
    ? "lane"
    : st.frame.kind === "boxes"
      ? "box"
      : st.frame.kind === "axis"
        ? "tick"
        : "column";

// What the last check counted: links right, key links, what is missing or
// the wrong way, where the parts sit, and what a pass still needs.
function Counts({ st }: { st: StepView }) {
  const c = st.check!;
  const argued = c.argued ?? 0;
  const word = slotWord(st);
  const wrongSlots = c.slots.filter((s) => !s.ok).length;
  const loose = c.loose ?? 0;
  const order = orderStops(st.frame);
  return (
    <div className="space-y-1 text-[12.5px] leading-snug text-body">
      <div className="text-[14px] font-semibold text-ink">
        {c.right + c.given + argued} of {c.total + argued} links ✓
        {c.given > 0 && (
          <span className="ml-1 text-[11.5px] font-normal text-muted">
            ({c.given} given)
          </span>
        )}
      </div>
      <div>
        {c.keyRight} of {c.keys} key links
        {c.keyMissing > 0 &&
          ` · ${plural(c.keyMissing, "key link")} still missing`}
      </div>
      {c.missing > c.keyMissing && (
        <div>
          {plural(c.missing - c.keyMissing, "other link")} not drawn yet
        </div>
      )}
      {c.reversed > 0 && (
        <div>
          {plural(c.reversed, "link points", "links point")} the wrong way ↔
        </div>
      )}
      {c.family > 0 && (
        <div>
          {plural(c.family, "link has", "links have")} the right pair with a
          near verb ~
        </div>
      )}
      {wrongSlots > 0 && (
        <div>
          {st.frame.kind === "sort"
            ? `${plural(wrongSlots, "part is", "parts are")} not in the column Claude's model puts ${wrongSlots === 1 ? "it" : "them"} in ⚠`
            : `${plural(wrongSlots, "part is", "parts are")} not in the ${word} ${wrongSlots === 1 ? "it belongs" : "they belong"} in ⚠`}
        </div>
      )}
      {loose > 0 && (
        <div>
          {plural(loose, "part is", "parts are")} not in a {word} yet
        </div>
      )}
      {c.outOfOrder > 0 && (
        <div>{plural(c.outOfOrder, "pair")} out of order along the axis</div>
      )}
      {/* what a pass needs, so a card full of ✓ that has not passed
          says why (with 3 other links, 70% is all 3) */}
      {!c.pass && (
        <div className="mt-1 rounded-lg bg-panel px-2 py-1 text-[12px] text-muted">
          Not passed yet. A pass needs every key link
          {c.restNeed > 0
            ? `, and ${c.restNeed} of the ${c.rest} other links (you have ${c.restGot})`
            : ""}
          {order
            ? ", with every part on a tick, in order"
            : st.frame.kind !== "free"
              ? `, with every part in a ${word}`
              : ""}
          .
          {!order &&
            wrongSlots > 0 &&
            ` Which ${word} a part sits in is marked, but does not stop a pass.`}
        </div>
      )}
    </div>
  );
}

// What the check found beyond the counts: a mix-up's refutation (and I
// think it holds), the reason a link points the other way, links not in
// Claude's model (Argue for it), the verdicts on what you argued, and a
// reply of Claude's that named a key link. `passed`: shown once the build
// passed, beside the Why, with the counts: a passing check went straight to
// the Why, and none of this was ever seen.
export function CheckFindings({
  here,
  st,
  passed = false,
}: {
  here: Here;
  st: StepView;
  passed?: boolean;
}) {
  const { act } = here;
  const step = st.step;
  const c = st.check;
  const [arguing, setArguing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const labelOf = (id: string) =>
    st.placed.find((p) => p.id === id)?.label ?? "";
  const words = (id: string) => {
    const l = st.links.find((x) => x.id === id);
    return l ? `“${labelOf(l.from)}” ${l.rel} “${labelOf(l.to)}”` : "";
  };
  // the last check's marks on links still on the canvas: one you deleted
  // since has nothing left to name
  const of = (m: Mark) =>
    c?.marks.filter(
      (x) => x.mark === m && st.links.some((l) => l.id === x.link),
    ) ?? [];
  const argueFor = (link: LinkView, mixup: boolean) => (
    <ArgueBox
      here={here}
      mixup={mixup}
      link={link}
      text={text}
      setText={setText}
      onSend={() => {
        void act("argue", { step, link: link.id, text }).then((r) => {
          if (!r.error) setArguing(null);
        });
      }}
    />
  );
  const notable =
    !!c &&
    (of("miscon").length > 0 ||
      of("reversed").some((m) => m.note) ||
      of("extra").length > 0 ||
      c.refutes.length > 0 ||
      c.outOfOrder > 0 ||
      (c.loose ?? 0) > 0 ||
      c.slots.some((s) => !s.ok));
  const told = st.told > 0 && (
    <div className="text-[11.5px] leading-snug text-muted">
      A reply of Claude's named{" "}
      {st.told === 1 ? "a key link" : `${st.told} key links`} of this step:{" "}
      {st.told === 1 ? "it counts" : "they count"} as hinted.
    </div>
  );
  if (!c) return told || null;
  if (passed && !notable && !st.argued.length && !st.told) return null;

  return (
    <div className="space-y-3">
      {passed && (
        <>
          <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
            Check · try {st.checks} · passed
          </div>
          <Counts st={st} />
        </>
      )}

      {/* what the server found, with the reason only once you drew it */}
      {(of("miscon").length > 0 || of("reversed").some((m) => m.note)) && (
        <div className="space-y-1.5 border-t border-line pt-2">
          {of("miscon").map((m) => {
            const l = st.links.find((x) => x.id === m.link)!;
            return (
              <div key={m.link} className="text-[12px] leading-snug">
                <span className="font-medium text-danger-strong">
                  {MARK.miscon.sym} {words(m.link)}:
                </span>{" "}
                <span className="text-body">{m.refute}</span>
                {/* the pattern can be wider than the mix-up: say why it holds */}
                {arguing !== m.link ? (
                  <button
                    onClick={() => {
                      setArguing(m.link);
                      setText("");
                    }}
                    className="ml-1 text-[11.5px] text-primary-strong hover:underline"
                  >
                    I think it holds
                  </button>
                ) : (
                  argueFor(l, true)
                )}
              </div>
            );
          })}
          {of("reversed")
            .filter((m) => m.note)
            .map((m) => (
              <div key={m.link} className="text-[12px] leading-snug">
                <span className="font-medium text-warning-strong">
                  {MARK.reversed.sym} {words(m.link)}:
                </span>{" "}
                <span className="text-body">{m.note}</span>
              </div>
            ))}
        </div>
      )}
      {c.refutes.length > 0 && (
        <div className="rounded-lg bg-hint-soft px-2.5 py-1.5 text-[12px] leading-snug text-hint-strong">
          Last time you were sure of a link that did not hold.{" "}
          {c.refutes.join(" ")}
        </div>
      )}

      {of("extra").length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <div className="text-[11.5px] text-muted">
            Not in Claude's model ({MARK.extra.sym}). That is not wrong.
          </div>
          {of("extra").map((m) => {
            const l = st.links.find((x) => x.id === m.link);
            if (!l) return null;
            return (
              <div key={m.link} className="text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body">{words(m.link)}</span>
                  {arguing !== m.link && (
                    <button
                      onClick={() => {
                        setArguing(m.link);
                        setText("");
                      }}
                      className="shrink-0 text-[11.5px] text-primary-strong hover:underline"
                    >
                      Argue for it
                    </button>
                  )}
                </div>
                {arguing === m.link && argueFor(l, false)}
              </div>
            );
          })}
        </div>
      )}
      {st.argued.length > 0 && (
        <div className="space-y-1 border-t border-line pt-2">
          {st.argued.map((a, i) => (
            <div key={i} className="text-[12px] leading-snug">
              <span
                className={
                  a.holds ? "text-success-strong" : "text-warning-strong"
                }
              >
                {a.holds ? "✓ It holds:" : "Not here:"}
              </span>{" "}
              “{labelOf(a.from)}” {a.rel} “{labelOf(a.to)}”.{" "}
              <span className="text-muted">{a.say}</span>
              {/* an accepted link is one of yours, right; it never stands
                  in for a key link, which the card still counts missing */}
              {a.holds && c.keyRight < c.keys && (
                <span className="text-muted">
                  {" "}
                  It counts as a right link of yours, not as a key link: a key
                  link is still missing.
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {told}
    </div>
  );
}
