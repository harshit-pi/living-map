// What Explore puts in NodePanel's two slots: the buttons a node gets (an
// option is chosen through the Choose… sheet, a question is settled, a want
// is weighted) and the lines under its summary (an option's case against and
// its history, a want's marks across the options, a question's answer).

import { useState, type MouseEvent as ClickEvent, type ReactNode } from "react";

import { Btn, MarkText, NameLeft, WAIT_TITLE } from "./ui.tsx";
import { anchorOf, PAID, useDecide, type Here } from "./view.ts";
import type { MapNode, NodeAction } from "../../../shared/model.ts";
import { More, type MoreSection } from "../../../web/components/More.tsx";
import {
  cellKey,
  SURVIVES_WORD,
  tooLong,
  WEIGHT_HEAD,
  WEIGHT_WORD,
  WEIGHTS,
  type BoardView,
  type ColumnView,
  type ExploreView,
  type RowView,
} from "../shared.ts";

function columnOf(view: ExploreView, id: string) {
  for (const b of Object.values(view.boards)) {
    const col = [...b.columns, ...b.aside].find((c) => c.id === id);
    if (col) return { board: b, col };
  }
  return null;
}

function rowOf(
  view: ExploreView,
  id: string,
): { board: BoardView; row: RowView } | null {
  for (const b of Object.values(view.boards)) {
    const row = [...b.groups.flatMap((g) => g.rows), ...b.suggestions].find(
      (r) => r.id === id,
    );
    if (row) return { board: b, row };
  }
  return null;
}

const SURE = [50, 70, 90];

const shapeOf = (view: ExploreView, q: string | null) =>
  q
    ? (view.boards[q]?.shape ??
      view.questions.find((p) => p.id === q)?.shape ??
      "open")
    : "open";

// A panel's buttons: the first two in the row, the rest behind one ⋯ (each
// a menu item). `primary` marks the panel's one next action, which then owns
// the screen's one filled button.
type Act = {
  label: string;
  // a menu item has no button to anchor on, so no event: an Act that needs
  // one (Choose…) is always among the first two
  onClick: (e?: ClickEvent<HTMLButtonElement>) => void;
  primary?: boolean;
  busy?: boolean;
  title?: string;
};

function Row({
  acts,
  more = [],
  before,
  after,
}: {
  acts: (Act | false | null | undefined)[];
  // already put away by the caller (a lean and its how sure)
  more?: MoreSection[];
  before?: ReactNode;
  after?: ReactNode;
}) {
  const all = acts.filter((a): a is Act => !!a);
  const shown = all.slice(0, 2);
  const rest = all.slice(2);
  const sections: MoreSection[] = [
    ...more,
    {
      items: rest.map((a) => ({
        label: a.label,
        title: a.busy ? WAIT_TITLE : a.title,
        disabled: a.busy,
        onClick: () => a.onClick(),
      })),
    },
  ];
  return (
    <>
      {before}
      {shown.map((a) => (
        <Btn
          key={a.label}
          primary={a.primary}
          lead={a.primary}
          busy={a.busy}
          title={a.title}
          onClick={a.onClick}
        >
          {a.label}
        </Btn>
      ))}
      <More sections={sections} left />
      {after}
    </>
  );
}

export function PanelActions({ here, node }: { here: Here; node: MapNode }) {
  const { view, ws, busy } = here;
  // the busy guard, as the board's own actions have it (view's guardedAct)
  const core = (type: NodeAction) => {
    if (busy && PAID.has(type)) return;
    void ws.run({ type, nodeId: node.id });
  };
  const explain: Act | false = !node.detail && {
    label: "Explain",
    busy,
    onClick: () => core("explain"),
  };
  if (node.dropped)
    return (
      <Row
        acts={[{ label: "Restore", onClick: () => core("restore") }, explain]}
      />
    );

  if (node.kind === "option")
    return (
      <OptionActions key={node.id} here={here} node={node} explain={explain} />
    );

  if (node.kind === "question")
    return (
      <QuestionActions
        key={node.id}
        here={here}
        node={node}
        explain={explain}
      />
    );

  const want = rowOf(view, node.id);
  if (want)
    return (
      <WantActions
        key={node.id}
        here={here}
        node={node}
        board={want.board}
        row={want.row}
        explain={explain}
      />
    );

  return (
    <Row
      acts={[
        { label: "Challenge", busy, onClick: () => core("challenge") },
        explain,
        { label: "Set aside", onClick: () => core("drop") },
      ]}
    />
  );
}

function WantActions({
  here,
  node,
  board,
  row,
  explain,
}: {
  here: Here;
  node: MapNode;
  board: BoardView;
  row: RowView;
  explain: Act | false;
}) {
  const { act } = here;
  const q = board.question;
  const [renaming, setRenaming] = useState(false);
  // its marks go with it, and only another Claude move brings them back:
  // with marks on it, Remove asks first
  const [removing, setRemoving] = useState(false);
  const marks = board.columns.filter(
    (c) => board.cells[cellKey(c.id, row.id)],
  ).length;
  const remove = () => void act("want", { q, id: row.id, remove: true });
  return (
    <Row
      before={
        // how much it matters: the chips stay in view, as the one place a
        // weight is set
        <span className="flex basis-full flex-wrap gap-1.5">
          {WEIGHTS.map((w) => (
            <button
              key={w}
              onClick={() => void act("want", { q, id: row.id, weight: w })}
              title={
                w === "must"
                  ? "Options that miss it are ruled out"
                  : "How much it matters"
              }
              className={`rounded-full border px-3 py-1 text-xs ${row.weight === w ? "border-ink bg-panel font-semibold text-ink" : "border-line-strong text-body hover:border-primary"}`}
            >
              {WEIGHT_HEAD[w]}
            </button>
          ))}
        </span>
      }
      acts={[
        row.suggested && {
          label: "Keep",
          primary: true,
          onClick: () => void act("want", { q, id: row.id, keep: true }),
        },
        row.suggested && {
          label: "Skip",
          onClick: () => void act("want", { q, id: row.id, keep: false }),
        },
        { label: "Rename", onClick: () => setRenaming(!renaming) },
        !row.suggested && {
          label: "Remove",
          onClick: () => (marks ? setRemoving(true) : remove()),
        },
        explain,
      ]}
      after={
        <>
          {removing && (
            <span className="flex basis-full flex-wrap items-center gap-1.5 text-xs text-body">
              Remove it and its {marks === 1 ? "mark" : `${marks} marks`}?
              <Btn onClick={remove}>Remove</Btn>
              <Btn onClick={() => setRemoving(false)}>Keep it</Btn>
            </span>
          )}
          {renaming && (
            <RenameForm
              initial={node.title}
              onSave={(title) => void act("want", { q, id: row.id, title })}
              onClose={() => setRenaming(false)}
            />
          )}
        </>
      }
    />
  );
}

// A name to change, in the panel: a want's, or an option you added
function RenameForm({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || tooLong(title)) return;
        onSave(title);
        onClose();
      }}
      className="flex basis-full flex-wrap gap-1.5"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:border-primary focus:outline-none"
      />
      <button
        type="submit"
        disabled={tooLong(title)}
        className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-body hover:border-primary disabled:opacity-40"
      >
        Rename
      </button>
      <span className="basis-full">
        <NameLeft text={title} existing />
      </span>
    </form>
  );
}

function OptionActions({
  here,
  node,
  explain,
}: {
  here: Here;
  node: MapNode;
  explain: Act | false;
}) {
  const { view, ws, act, busy } = here;
  const [renaming, setRenaming] = useState(false);
  // the Decide sheet, once open, owns the screen's one filled button
  const [deciding] = useDecide(ws.map);
  const core = (type: NodeAction) => {
    if (busy && PAID.has(type)) return;
    void ws.run({ type, nodeId: node.id });
  };
  {
    const shape = shapeOf(view, node.parent);
    const chosen = node.status === "chosen";
    // set aside by a Choose (another option won): it can win instead, or
    // come back into the running; setting it aside again would only move it
    // to the drawer
    const chosenOver = node.status === "dropped";
    const found = columnOf(view, node.id);
    const q = node.parent;
    const lean = found?.board.lean;
    const leaning = lean?.option === node.id;
    // your lean, and how sure, kept from Claude: in the ⋯ (it was a toggle
    // on every column and a row of percentages on the stand line)
    const leanMore: MoreSection[] =
      shape === "choose" && !chosen && !chosenOver && q
        ? [
            {
              items: [
                {
                  label: "I lean to this",
                  on: leaning,
                  title: leaning
                    ? "Your lean (kept from Claude). Click to clear it"
                    : "Lean towards this one. Claude is not told",
                  onClick: () =>
                    void act("lean", { q, option: leaning ? null : node.id }),
                },
              ],
            },
            {
              head: "How sure?",
              items: leaning
                ? SURE.map((n) => ({
                    label: `${n}%`,
                    on: lean?.sure === n,
                    onClick: () =>
                      void act("lean", {
                        q,
                        option: node.id,
                        ...(lean?.sure === n ? {} : { sure: n }),
                      }),
                  }))
                : [],
            },
          ]
        : [];
    // Rename, on an option you added: Claude may not touch it, so a typo
    // or a long name stayed for good
    const yours = found?.col.by === "you" && !!q;
    return (
      <Row
        more={leanMore}
        acts={[
          chosen &&
            shape === "causes" && {
              label: "Unmark likely",
              title: "It goes back to a possible cause",
              onClick: () => core("restore"),
            },
          !chosen &&
            (shape === "choose"
              ? {
                  label: chosenOver ? "Choose this instead…" : "Choose…",
                  primary: !deciding,
                  onClick: (e) =>
                    e && here.choose(node.id, anchorOf(e.currentTarget)),
                }
              : {
                  label: shape === "causes" ? "Mark likely" : "Choose",
                  primary: true,
                  title:
                    shape === "causes"
                      ? "Mark this cause likely; the other causes stay open"
                      : undefined,
                  onClick: () => void act("commit", { option: node.id }),
                }),
          {
            label: found?.col.against ? "Case against again" : "Case against",
            busy,
            title: found?.col.against
              ? "Claude makes the case again; this one is kept as history"
              : "The strongest single reason it is the wrong choice",
            onClick: () => void act("against", { option: node.id }),
          },
          explain,
          { label: "Go deeper", busy, onClick: () => core("deeper") },
          yours && { label: "Rename", onClick: () => setRenaming(!renaming) },
          chosenOver
            ? {
                label: "Restore",
                title:
                  "Back in the running beside your choice: the question is open again",
                onClick: () => core("restore"),
              }
            : {
                label: "Set aside",
                title:
                  "Rule it out: it moves to the set-aside drawer and Claude stops raising it",
                onClick: () => core("drop"),
              },
        ]}
        after={
          renaming &&
          q && (
            <RenameForm
              initial={node.title}
              onSave={(title) => void act("option", { q, id: node.id, title })}
              onClose={() => setRenaming(false)}
            />
          )
        }
      />
    );
  }
}

function QuestionActions({
  here,
  node,
  explain,
}: {
  here: Here;
  node: MapNode;
  explain: Act | false;
}) {
  const { view, ws, act, busy } = here;
  const stand = view.stand[node.id];
  const [settling, setSettling] = useState(false);
  // your answer starts from what is already an answer: one given before, or
  // the options you chose or causes you marked likely. Claude's stand line
  // is often what would decide it, not an answer, so it is only the hint
  const given = view.questions.find((p) => p.id === node.id)?.answer?.text;
  const picked = Object.values(ws.map.nodes)
    .filter(
      (n) =>
        n.parent === node.id && n.kind === "option" && n.status === "chosen",
    )
    .map((n) => n.title)
    .join("; ");
  const [answer, setAnswer] = useState(given || picked);
  const core = (type: NodeAction) => {
    if (busy && PAID.has(type)) return;
    void ws.run({ type, nodeId: node.id });
  };
  const board = view.boards[node.id];
  return (
    <Row
      acts={[
        {
          label: "Settle…",
          primary: true,
          onClick: () => setSettling(!settling),
        },
        board?.shape === "choose" && {
          label: "Open its board",
          onClick: () => here.openBoard(node.id),
        },
        { label: "Go deeper", busy, onClick: () => core("deeper") },
        { label: "Challenge", busy, onClick: () => core("challenge") },
        explain,
        !!node.parent && { label: "Set aside", onClick: () => core("drop") },
      ]}
      after={
        settling && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!answer.trim()) return;
              void act("settle", { q: node.id, answer });
              setSettling(false);
            }}
            className="flex basis-full gap-1.5"
          >
            <textarea
              autoFocus
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                // Enter settles, as a one-line field would; Shift-Enter wraps
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                stand?.line ? `Claude: ${stand.line}` : "Your answer, in a line"
              }
              maxLength={240}
              className="min-w-0 flex-1 resize-none rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] leading-snug text-ink focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-body hover:border-primary"
            >
              Settle
            </button>
          </form>
        )
      }
    />
  );
}

const box =
  "mt-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] leading-snug";
const label = "text-[10px] font-semibold uppercase tracking-wide text-muted";

function AgainstLines({ col }: { col: ColumnView }) {
  if (!col.against) return null;
  return (
    <div className={box}>
      <div className={label}>Case against</div>
      <div className="text-ink" data-content>
        {col.against.text}
      </div>
      <div className="text-muted">{SURVIVES_WORD[col.against.survives]}</div>
      {col.was.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5 text-muted">
          <div className={label}>Was</div>
          {col.was.map((a, i) => (
            <div key={i}>
              {a.text}{" "}
              <span className="text-faint">
                ({SURVIVES_WORD[a.survives].toLowerCase()})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Next sent you here for what only you know: said where you answer it, and
// which cell it is about. The want panel opened bare, with the ask only in
// Next's hover title.
function TellHint({ here, node }: { here: Here; node: MapNode }) {
  const { view } = here;
  const nodes = here.ws.map.nodes;
  const gap = [
    view.next,
    ...Object.values(view.boards).map((b) => b.next),
  ].find((g) => g.kind === "tell" && (g.check ?? g.want) === node.id);
  if (!gap) return null;
  const option = gap.option ? nodes[gap.option]?.title : undefined;
  const want = gap.want ? nodes[gap.want]?.title : undefined;
  const cell =
    gap.option && gap.want
      ? view.boards[gap.q]?.cells[cellKey(gap.option, gap.want)]
      : undefined;
  return (
    <div className={box}>
      <div className={label}>Claude needs you here</div>
      <div className="text-ink">
        {gap.check
          ? `${gap.label}: say what you found in the thread below.`
          : `Claude can't tell “${option ?? "an option"}” on “${want ?? "this must"}” without you.`}
      </div>
      {cell?.note && <div className="text-body">Claude: “{cell.note}”</div>}
      {!gap.check && (
        <div className="mt-0.5 text-muted">
          Tell the thread below what you know (your setup, your numbers), or
          rate that cell yourself on the board.
        </div>
      )}
    </div>
  );
}

export function PanelExtra({ here, node }: { here: Here; node: MapNode }) {
  return (
    <>
      <TellHint here={here} node={node} />
      <PanelLines here={here} node={node} />
    </>
  );
}

function PanelLines({ here, node }: { here: Here; node: MapNode }) {
  const { view } = here;
  const nodes = here.ws.map.nodes;
  if (node.kind === "option") {
    const found = columnOf(view, node.id);
    if (!found) return null;
    const { board, col } = found;
    const why = board.commit?.option === node.id ? board.commit.why : "";
    return (
      <>
        {why && (
          <div className={box}>
            <div className={label}>Why you chose it</div>
            <div className="text-ink">“{why}”</div>
          </div>
        )}
        {col.takeaway && (
          <div className="mt-2 text-[12.5px] text-body">
            <span className="text-muted">A thread settled:</span> “
            {col.takeaway}”
          </div>
        )}
        <AgainstLines col={col} />
      </>
    );
  }
  if (node.kind === "question") {
    const answer = view.questions.find((p) => p.id === node.id)?.answer;
    if (!answer) return null;
    return (
      <div className={box}>
        <div className={label}>
          {answer.by === "you" ? "Your answer" : "Claude's answer"}
        </div>
        <div className="text-ink">{answer.text}</div>
      </div>
    );
  }
  // the check Claude said to run first, and what each result would mean
  const pick = view.questions.find((p) => p.runFirst?.id === node.id)?.runFirst;
  if (pick)
    return (
      <div className={box}>
        <div className={label}>Claude says run this first</div>
        <div className="text-ink">{pick.why}</div>
      </div>
    );
  const want = rowOf(view, node.id);
  if (!want) return null;
  const { board, row } = want;
  return (
    <div className={box}>
      <div className={label}>
        {row.suggested ? "Claude's suggestion" : WEIGHT_WORD[row.weight]} ·
        across the options
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {board.columns.map((c) => {
          const sc = board.cells[cellKey(c.id, row.id)];
          return (
            <li key={c.id} className="flex justify-between gap-2">
              {/* one line per option: a long name wrapped, and its second
                  line read as another option with no mark */}
              <span
                title={nodes[c.id]?.title ?? c.title}
                className={`min-w-0 truncate ${c.faded ? "text-muted line-through" : "text-body"}`}
              >
                {nodes[c.id]?.title ?? c.title}
              </span>
              {sc ? (
                <span className="shrink-0">
                  <MarkText mark={sc.mark} must={row.weight === "must"} />
                  {/* "can't tell" says it is unsure already: "can't tell
                      guess" read as two marks */}
                  {sc.guess && sc.mark !== "unknown" && (
                    <span
                      className="text-hint-strong"
                      title="No fact backs it yet"
                    >
                      {" "}
                      guess
                    </span>
                  )}
                  {sc.who === "you" && <span className="text-ink"> you</span>}
                </span>
              ) : (
                <span className="shrink-0 text-warning-strong">empty</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
