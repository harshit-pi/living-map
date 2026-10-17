// The opening move: what you typed or pasted, and what the model is asked to draw.

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

// Learn's first move; a plugin's mode writes its own (ServerPlugin.start)
export function startAction(title: string): string {
  return `start. The learner wants to understand: "${title}". Create the root question (the topic, parent null) and 3-5 steps under it in learning order. Then build the TOPIC DIAGRAM in the form that fits this topic best: the skeleton of the subject, with the 2-3 parts the learner should discover first as blanks. No solution. In the map block write the diagram op FIRST, then the root and the steps, so the picture appears before the path.`;
}
