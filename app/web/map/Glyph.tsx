// An item's mark. The flag, the boxes and the check are drawn: as text they
// come from a symbol font that renders them far smaller than the letters
// beside them.
const DRAWN: Record<string, React.ReactNode> = {
  "⚑": (
    <>
      <path d="M4 14.5V2" />
      <path d="M4 2.75h8l-2 3 2 3H4" fill="currentColor" />
    </>
  ),
  "✓": <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  "☐": <rect x="2.5" y="2.5" width="11" height="11" rx="2" />,
};

export function Glyph({ g }: { g: string }) {
  const drawn = DRAWN[g];
  if (!drawn) return <>{g}</>;
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block h-3.5 w-3.5 align-[-2px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawn}
    </svg>
  );
}
