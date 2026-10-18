export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  // off, and why (said on hover)
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="flex rounded-lg bg-panel p-0.5 text-[13px]" title={title}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          disabled={disabled && value !== v}
          className={`rounded-md px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50 ${value === v ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink disabled:hover:text-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
