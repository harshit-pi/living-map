// The Living Map mark and wordmark, drawn in the brand colours from brand.css.

import { MARK_PATHS } from "../lib/mark.ts";

export function Mark({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d={MARK_PATHS.route}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="0.5 3.2"
        style={{ stroke: "var(--color-muted)" }}
      />
      {MARK_PATHS.stops.map((s) => (
        <circle
          key={s.cx}
          {...s}
          r={2.6}
          strokeWidth={1.8}
          style={{ fill: "var(--color-surface)", stroke: "var(--color-ink)" }}
        />
      ))}
      <circle
        {...MARK_PATHS.here}
        r={3.4}
        style={{ fill: "var(--color-primary)" }}
      />
    </svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} />
      <span
        className="font-semibold tracking-tight text-ink"
        style={{ fontSize: size * 0.72 }}
      >
        Living Map
      </span>
    </span>
  );
}
