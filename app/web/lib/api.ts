import { useCallback, useEffect, useState } from "react";

import { api } from "./session.ts";
import type { UpdateInfo } from "../../shared/model.ts";

// Is a newer release out? Asked when the page opens and every half hour;
// refresh() asks GitHub again now.
export function useUpdate(): {
  info: UpdateInfo | null;
  refresh: () => Promise<UpdateInfo | null>;
} {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      api("/api/update")
        .then((r) => r.json() as Promise<UpdateInfo>)
        .then((i) => {
          if (live) setInfo(i);
        })
        .catch(() => {});
    ask();
    const t = setInterval(ask, 30 * 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const i = (await (
        await api("/api/update?refresh=1")
      ).json()) as UpdateInfo;
      setInfo(i);
      return i;
    } catch {
      return null;
    }
  }, []);
  return { info, refresh };
}
