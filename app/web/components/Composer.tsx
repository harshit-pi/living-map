import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Choice, Settings } from "../../shared/model.ts";
import { useProvider } from "../lib/api.ts";

function Picker({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: Choice[];
  onChange: (v: string) => void;
  title: string;
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // gives up width before the send button does on a narrow window
      className="min-w-0 cursor-pointer truncate rounded-lg border-0 bg-transparent py-1 pl-2 pr-6 text-[12.5px] text-muted hover:bg-panel focus:ring-0"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export type ComposerHandle = { focus: () => void };

// The one place text goes in, styled like Claude's: chips on top, the model and
// effort pickers below. Used full-width in Text, floating in Visual, and in a
// node's thread.
export const Composer = forwardRef<
  ComposerHandle,
  {
    busy: boolean;
    settings: Settings;
    onSettings: (s: Partial<Settings>) => void;
    onSend: (text: string) => void;
    placeholder: string;
    chips?: ReactNode;
    rows?: number;
    compact?: boolean;
    onStop?: () => void;
    code?: boolean;
    // the model and effort pickers behind one ⚙: two selects of words most
    // people never change, beside every box
    foldSettings?: boolean;
    autoFocus?: boolean;
  }
>(function Composer(
  {
    busy,
    settings,
    onSettings,
    onSend,
    placeholder,
    chips,
    rows = 2,
    compact,
    onStop,
    code,
    foldSettings,
    autoFocus,
  },
  ref,
) {
  const [text, setText] = useState("");
  const [gear, setGear] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const { models, efforts } = useProvider();
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="rounded-2xl border border-line-strong bg-surface shadow-xs focus-within:border-primary">
      {chips && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">{chips}</div>
      )}
      <textarea
        ref={input}
        value={text}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // code keeps Enter for new lines; ⌘↩ or Ctrl↩ sends
          if (
            e.key === "Enter" &&
            (code ? e.metaKey || e.ctrlKey : !e.shiftKey)
          ) {
            e.preventDefault();
            send();
          }
          if (code && e.key === "Tab") {
            e.preventDefault();
            setText((t) => t + "  ");
          }
        }}
        spellCheck={!code}
        className={`block w-full resize-none border-0 bg-transparent px-4 pt-3 text-ink outline-hidden placeholder:text-faint focus:ring-0 ${code ? "font-mono text-[13px] leading-relaxed" : compact ? "text-[14px]" : "text-[15px]"}`}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        {code && (
          <span className="pl-2 text-[11px] text-faint">
            ⌘↩ to send · any language or pseudocode
          </span>
        )}
        <div className="flex-1" />
        {!compact && foldSettings && (
          <button
            onClick={() => setGear((v) => !v)}
            title="Model and effort"
            aria-label="Model and effort"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] hover:bg-panel ${gear ? "text-ink" : "text-muted"}`}
          >
            ⚙
          </button>
        )}
        {!compact && (!foldSettings || gear) && (
          <Picker
            title="Model"
            value={settings.model}
            options={models}
            onChange={(model) => onSettings({ model })}
          />
        )}
        {!compact && (!foldSettings || gear) && (
          <Picker
            title="Reasoning effort"
            value={settings.effort}
            options={efforts}
            onChange={(effort) => onSettings({ effort })}
          />
        )}
        {busy && onStop && !text.trim() ? (
          <button
            onClick={onStop}
            title="Stop Claude"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-on-primary hover:bg-ink"
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-surface" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!text.trim()}
            title={busy ? "Send (runs when Claude finishes)" : "Send"}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary hover:bg-primary-strong disabled:opacity-40"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
});

export function Chip({
  children,
  onRemove,
  tone = "plain",
}: {
  children: ReactNode;
  onRemove?: () => void;
  tone?: "plain" | "accent";
}) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ${tone === "accent" ? "bg-primary-soft text-primary-strong ring-primary-line" : "bg-panel text-body ring-line"}`}
    >
      {children}
      {onRemove && (
        <button className="ml-1 text-faint hover:text-ink" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
