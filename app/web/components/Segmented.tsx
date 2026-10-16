export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-cl-panel p-0.5 text-[13px]">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 ${value === v ? "bg-white text-cl-ink shadow-xs" : "text-cl-mute hover:text-cl-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
