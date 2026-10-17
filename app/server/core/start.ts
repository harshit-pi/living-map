// The opening move: what you typed or pasted, as a title and source material.
// Each mode writes its own first move (ServerPlugin.start).

// Lines a problem page adds around the problem itself (LeetCode and similar).
const CHROME =
  /^(solved|attempted|easy|medium|hard|topics|companies|premium lock icon|hint|hints?|accepted|submissions?|acceptance rate.*|seen this question in a real interview before\?.*|\d+(\.\d+)?[km]?)$/i;

// A pasted problem page becomes a short title plus the full text as source
// material, so nothing past the first line is lost.
export function splitStart(text: unknown): { title: string; source: string } {
  const raw = String(text ?? "")
    .replace(/\r/g, "")
    .trim();
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !CHROME.test(l));
  let title = lines[0] ?? "Untitled";
  if (title.length > 100)
    title = `${title.slice(0, 100).replace(/\s+\S*$/, "")}…`;
  const rest = lines.join("\n");
  return {
    title,
    source: rest.length > title.length + 20 ? rest.slice(0, 6000) : "",
  };
}
