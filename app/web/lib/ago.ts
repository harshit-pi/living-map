// How long ago, in the words the maps list uses ("5 min ago", "yesterday").
export function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// About how long a review of `steps` due steps takes: a step's rebuild took
// two or three minutes. One rule for the Start screen and the map, which
// said "about 2 min" and "about 3 minutes" for the same review.
export const reviewMinutes = (steps: number) => Math.max(1, steps) * 2;
