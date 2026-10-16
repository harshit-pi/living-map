import { useEffect, useState } from "react";

import type { MapDoc } from "../../shared/model.ts";
import type { Stream } from "../lib/live.ts";

const SHOW_MS = 9000;

// The model's caption for a main-conversation move: live while it writes, then
// a few seconds on screen. Messages already there when a map opens are not shown.
export function useCaption(map: MapDoc | null, busy: boolean, stream: Stream) {
  const len = map?.chat.length ?? 0;
  const last = map?.chat[len - 1];
  // how long the conversation was when this map came into view
  const [base, setBase] = useState<{ id: string; len: number } | null>(null);
  if (map && base?.id !== map.id) setBase({ id: map.id, len });
  // the message length at which the caption was dismissed or timed out
  const [hiddenAt, setHiddenAt] = useState(-1);

  const fresh =
    !!base &&
    base.id === map?.id &&
    len > base.len &&
    hiddenAt !== len &&
    (last?.role === "claude" || last?.role === "system");

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setHiddenAt(len), SHOW_MS);
    return () => clearTimeout(t);
  }, [fresh, len]);

  const live = busy && stream.threadId === null;
  return {
    text: live ? stream.text : fresh ? (last?.text ?? "") : "",
    live,
    clear: () => setHiddenAt(len),
  };
}
