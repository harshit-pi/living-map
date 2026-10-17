// Explore's view options, shared by its header controls and its screen.

import { useSyncExternalStore } from "react";

// whether set-aside options and the facts under them are shown
let showDropped = true;
const listeners = new Set<() => void>();

export function useShowDropped(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => showDropped,
  );
  return [
    v,
    (next) => {
      showDropped = next;
      for (const cb of listeners) cb();
    },
  ];
}
