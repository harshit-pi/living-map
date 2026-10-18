import { useEffect, useState } from "react";

import { ArgueBox } from "./BuildCanvas.tsx";
import { MARK, notYet, passRule, type Here } from "./view.ts";
import {
  placingIsAnswer,
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
  ask = "How sure?",
}: {
  value: Sure | null;
  onPick: (s: Sure) => void;
  // what it asks: beside a build, what you are to be sure of ("How sure?"
  // under Check read as sure about what)
  ask?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
      <span className="whitespace-nowrap">{ask}</span>
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

// true once `ms` have gone by since `key` was last new (a step, a try)
function useLater(ms: number, key: string): boolean {
  const [at, setAt] = useState({ key, done: false });
  if (at.key !== key) setAt({ key, done: false });
  useEffect(() => {
    const t = setTimeout(() => setAt({ key, done: true }), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return at.key === key && at.done;
}

const STUCK_MS = 20_000;

// The check card beside a build. Its buttons are at the top, Check first
// and Hint beside it, in the same places every time (swapped as the fill
// moved, the button under the pointer changed meaning). Filled: nothing
// before you have done anything (the canvas is the task then, and a filled
// Check over an empty build read as "check now"); then Check; after a check
// that did not pass, Hint while the build is as it was checked, then Check
// again once you change it; nothing while an argue box is open (it owns the
// filled button). Under it, how sure you are (once you have drawn a link),
// the one line the check says, the hints you took, and what it found. Show
// one link and Show the model are in the card's More.
export function CheckCard({ here, st }: { here: Here; st: StepView }) {
  const { act } = here;
  const step = st.step;
  const c = st.check;
  const own = st.links.filter((l) => !l.given).length;
  const [arguing, setArguing] = useState<string | null>(null);
  // a first try with nothing drawn for a while: a way out before the first
  // check, which is when hints open (not in a review or a rebuild, which
  // are from memory, nor after Show the model: that rebuild is no first try)
  const fresh =
    !c &&
    own === 0 &&
    st.checks === 0 &&
    !st.viaModel &&
    !st.reviewing &&
    !st.recall &&
    !st.onCase;
  const idle = useLater(STUCK_MS, `${step}:${st.checks}`);
  // where placing the parts is part of the task, a part placed is a start
  const placing = st.help >= 2 || (st.help === 1 && placingIsAnswer(st.frame));
  const begun =
    !!c ||
    own > 0 ||
    (placing &&
      (st.frame.kind === "free"
        ? st.placed.length > 0
        : st.placed.some((p) => p.slot)));
  const hintFirst = !!c && !c.pass && !st.changed && st.canHint;
  const checkBtn = (primary: boolean) => (
    <button
      key="check"
      data-primary={primary || undefined}
      onClick={() => void act("check", { step })}
      disabled={!st.placed.length}
      className={`flex-1 rounded-lg py-1.5 text-sm font-medium disabled:opacity-40 ${primary ? "bg-primary text-on-primary hover:bg-primary-strong" : "border border-line-strong bg-surface text-body hover:border-primary"}`}
    >
      {c ? "Check again" : "Check"}
    </button>
  );
  const hintBtn = (primary: boolean) => (
    <button
      key="hint"
      data-primary={primary || undefined}
      disabled={!st.canHint}
      title="Where to look, then a question, then the link drawn dotted"
      onClick={() => void act("hint", { step })}
      className={`flex-1 rounded-lg py-1.5 text-sm font-medium disabled:opacity-40 ${primary ? "bg-primary text-on-primary hover:bg-primary-strong" : "border border-line-strong bg-surface text-body hover:border-primary"}`}
    >
      Hint
    </button>
  );

  return (
    <div className="space-y-3">
      {/* the buttons come first and stay put: under the findings, an
          argued link's verdict moved them, and a click meant for Hint
          landed on Check again */}
      <div className="flex gap-1.5">
        {checkBtn(begun && !hintFirst && !arguing)}
        {c && st.canHint && hintBtn(hintFirst && !arguing)}
      </div>
      {fresh && idle && (
        <button
          onClick={() => void act("showModel", { step })}
          title="Try one link first: a wrong try teaches more than a hint. Peeking counts as shown."
          className="w-full text-[11.5px] text-muted hover:text-ink"
        >
          Stuck? Peek at the example
        </button>
      )}
      {/* optional, and never waited for: asked once there is a link to be
          sure of, and before the first check (after it, you are fixing
          what the check found; what you said is kept) */}
      {own > 0 && !c && (
        <HowSure
          ask="Sure of your links?"
          value={st.sure}
          onPick={(sure) => void act("sure", { step, sure })}
        />
      )}

      {c && (
        <div className="space-y-2">
          {st.changed ? (
            <div className="text-[12px] text-muted">Changed: check again.</div>
          ) : (
            !c.pass && (
              <div
                title={passRule(st)}
                className="text-[13px] font-medium text-ink"
              >
                {notYet(st)}
              </div>
            )
          )}
          {st.hints.length > 0 && (
            <div className="space-y-1">
              {st.hints.map((h, i) => (
                <div key={i} className="text-[12px] leading-snug text-body">
                  <span className="font-medium text-hint-strong">Hint:</span>{" "}
                  {h.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <CheckFindings
        here={here}
        st={st}
        arguing={arguing}
        setArguing={setArguing}
      />
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
  arguing: heldArguing,
  setArguing: setHeldArguing,
}: {
  here: Here;
  st: StepView;
  passed?: boolean;
  // the link being argued for, held by the check card above, whose filled
  // button gives way to the argue box's Send
  arguing?: string | null;
  setArguing?: (id: string | null) => void;
}) {
  const { act } = here;
  const step = st.step;
  const c = st.check;
  const [ownArguing, setOwnArguing] = useState<string | null>(null);
  const arguing = setHeldArguing ? (heldArguing ?? null) : ownArguing;
  const setArguing = setHeldArguing ?? setOwnArguing;
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
  const argueFor = (link: LinkView, mark: Mark) => (
    <ArgueBox
      here={here}
      mark={mark}
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
      of("family").length > 0 ||
      c.refutes.length > 0 ||
      c.outOfOrder > 0 ||
      (c.loose ?? 0) > 0 ||
      c.slots.some((s) => !s.ok));
  const told = st.told > 0 && (
    <div className="text-[11.5px] leading-snug text-muted">
      A reply of Claude's named{" "}
      {st.told === 1 ? "a key link" : `${st.told} key links`} of this step:{" "}
      {/* "it counts as hinted" sat beside "Built · shown" */}
      {st.told === 1 ? "it no longer counts" : "they no longer count"} as by
      you.
    </div>
  );
  if (!c) return told || null;
  if (passed && !notable && !st.argued.length && !st.told) return null;

  return (
    <div className="space-y-3">
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
                  argueFor(l, "miscon")
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
                {arguing === m.link && argueFor(l, "extra")}
              </div>
            );
          })}
        </div>
      )}
      {/* the verbs are a closed list: a "~" may mean what Claude's verb
          means, and says so here (only the link editor offered it) */}
      {of("family").length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <div className="text-[11.5px] text-muted">
            The right pair, with another verb ({MARK.family.sym}). Mean the same
            thing by yours? Say what.
          </div>
          {of("family").map((m) => {
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
                {arguing === m.link && argueFor(l, "family")}
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
              {/* another verb on a link of Claude's says that link, from
                  the next check; any other accepted link is one of yours,
                  right, and never stands in for a key link */}
              {a.holds && a.pair && (
                <span className="text-muted">
                  {" "}
                  Check again: your verb counts for that link now.
                </span>
              )}
              {a.holds && !a.pair && c.keyRight < c.keys && (
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
