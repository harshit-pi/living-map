// What Explore puts in NodePanel's two slots: the buttons a node gets (an
// option is chosen through the Choose… sheet, a question is settled, a want
// is weighted) and the lines under its summary (an option's case against and
// its history, a want's marks across the options, a question's answer).

import { useState, type ReactNode } from "react";

import { Btn, MarkText, NameLeft } from "./ui.tsx";
import { anchorOf, PAID, type Here } from "./view.ts";
import type { MapNode, NodeAction } from "../../../shared/model.ts";
import {
  cellKey,
  tooLong,
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

const shapeOf = (view: ExploreView, q: string | null) =>
  q
    ? (view.boards[q]?.shape ??
      view.questions.find((p) => p.id === q)?.shape ??
      "open")
    : "open";

export function PanelActions({ here, node }: { here: Here; node: MapNode }) {
  const { view, ws, act, busy } = here;
  // the busy guard, as the board's own actions have it (view's guardedAct)
  const core = (type: NodeAction) => {
    if (busy && PAID.has(type)) return;
    void ws.run({ type, nodeId: node.id });
  };
  const explain = !node.detail && (
    <Btn busy={busy} onClick={() => core("explain")}>
      Explain
    </Btn>
  );
  if (node.dropped)
    return (
      <>
        <Btn onClick={() => core("restore")}>Restore</Btn>
        {explain}
      </>
    );

  if (node.kind === "option") {
    const shape = shapeOf(view, node.parent);
    const chosen = node.status === "chosen";
    // set aside by a Choose (another option won): it can win instead, or
    // come back into the running; setting it aside again would only move it
    // to the drawer
    const chosenOver = node.status === "dropped";
    return (
      <>
        {chosen && shape === "causes" && (
          <Btn
            onClick={() => core("restore")}
            title="It goes back to a possible cause"
          >
            Unmark likely
          </Btn>
        )}
        {!chosen &&
          (shape === "choose" ? (
            <Btn
              primary
              onClick={(e) => here.choose(node.id, anchorOf(e.currentTarget))}
            >
              {chosenOver ? "Choose this instead…" : "Choose…"}
            </Btn>
          ) : (
            <Btn
              primary
              onClick={() => void act("commit", { option: node.id })}
              title={
                shape === "causes"
                  ? "Mark this cause likely; the other causes stay open"
                  : undefined
              }
            >
              {shape === "causes" ? "Mark likely" : "Choose"}
            </Btn>
          ))}
        <Btn
          busy={busy}
          onClick={() => void act("against", { option: node.id })}
          title="The strongest single reason it is the wrong choice"
        >
          Case against
        </Btn>
        {explain}
        <Btn busy={busy} onClick={() => core("deeper")}>
          Go deeper
        </Btn>
        <OptionRename key={node.id} here={here} node={node} />
        {chosenOver ? (
          <Btn
            onClick={() => core("restore")}
            title="Back in the running beside your choice: the question is open again"
          >
            Restore
          </Btn>
        ) : (
          <Btn
            onClick={() => core("drop")}
            title="Rule it out: it moves to the set-aside drawer and Claude stops raising it"
          >
            Set aside
          </Btn>
        )}
      </>
    );
  }

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
    <>
      <Btn busy={busy} onClick={() => core("challenge")}>
        Challenge
      </Btn>
      {explain}
      <Btn onClick={() => core("drop")}>Set aside</Btn>
    </>
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
  explain: ReactNode;
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
    <>
      {row.suggested && (
        <>
          <Btn
            primary
            onClick={() => void act("want", { q, id: row.id, keep: true })}
          >
            Keep
          </Btn>
          <Btn onClick={() => void act("want", { q, id: row.id, keep: false })}>
            Skip
          </Btn>
        </>
      )}
      {WEIGHTS.map((w) => (
        <button
          key={w}
          onClick={() => void act("want", { q, id: row.id, weight: w })}
          title="How much it matters"
          className={`rounded-full border px-3 py-1 text-xs ${row.weight === w ? "border-ink bg-panel font-semibold text-ink" : "border-line-strong text-body hover:border-primary"}`}
        >
          {WEIGHT_WORD[w].toLowerCase()}
        </button>
      ))}
      <Btn onClick={() => setRenaming(!renaming)}>Rename</Btn>
      {!row.suggested &&
        (removing ? (
          <span className="flex basis-full flex-wrap items-center gap-1.5 text-xs text-body">
            Remove it and its {marks === 1 ? "mark" : `${marks} marks`}?
            <Btn onClick={remove}>Remove</Btn>
            <Btn onClick={() => setRemoving(false)}>Keep it</Btn>
          </span>
        ) : (
          <Btn onClick={() => (marks ? setRemoving(true) : remove())}>
            Remove
          </Btn>
        ))}
      {explain}
      {renaming && (
        <RenameForm
          initial={node.title}
          onSave={(title) => void act("want", { q, id: row.id, title })}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
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
        className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
      >
        Rename
      </button>
      <span className="basis-full">
        <NameLeft text={title} />
      </span>
    </form>
  );
}

// Rename, on an option you added: Claude may not touch it, so a typo or a
// long name stayed for good
function OptionRename({ here, node }: { here: Here; node: MapNode }) {
  const [renaming, setRenaming] = useState(false);
  const found = columnOf(here.view, node.id);
  if (!found || found.col.by !== "you" || !node.parent) return null;
  const q = node.parent;
  return (
    <>
      <Btn onClick={() => setRenaming(!renaming)}>Rename</Btn>
      {renaming && (
        <RenameForm
          initial={node.title}
          onSave={(title) => void here.act("option", { q, id: node.id, title })}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  );
}

function QuestionActions({
  here,
  node,
  explain,
}: {
  here: Here;
  node: MapNode;
  explain: ReactNode;
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
    <>
      <Btn primary onClick={() => setSettling(!settling)}>
        Settle…
      </Btn>
      {board?.shape === "choose" && (
        <Btn onClick={() => here.openBoard(node.id)}>Open its board</Btn>
      )}
      <Btn busy={busy} onClick={() => core("deeper")}>
        Go deeper
      </Btn>
      <Btn busy={busy} onClick={() => core("challenge")}>
        Challenge
      </Btn>
      {explain}
      {node.parent && <Btn onClick={() => core("drop")}>Set aside</Btn>}
      {settling && (
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
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary hover:bg-primary-strong"
          >
            Settle
          </button>
        </form>
      )}
    </>
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
      <div className="text-ink">{col.against.text}</div>
      <div className="text-muted">survives: {col.against.survives}</div>
      {col.was.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5 text-muted">
          <div className={label}>Was</div>
          {col.was.map((a, i) => (
            <div key={i}>
              {a.text}{" "}
              <span className="text-faint">(survives: {a.survives})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PanelExtra({ here, node }: { here: Here; node: MapNode }) {
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
                  {sc.guess && <span className="text-hint-strong"> guess</span>}
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
