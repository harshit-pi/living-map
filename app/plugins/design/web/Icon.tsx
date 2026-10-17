import { KINDS, type KindId } from "../shared.ts";

// a component kind's icon, drawn in the current text colour
export function Icon({ kind, size = 18 }: { kind: KindId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={KINDS[kind].icon}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
