import { useCallback, useEffect, useState } from "react";

import type {
  Action,
  ActionResult,
  MapSummary,
  ProviderInfo,
  Settings,
  UpdateInfo,
} from "../../shared/model.ts";

export async function act(
  action: Action,
  settings: Settings,
): Promise<ActionResult> {
  try {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, settings }),
    });
    return (await r.json()) as ActionResult;
  } catch {
    return { error: "Could not reach the Living Map server. Is it running?" };
  }
}

// Saved maps, newest first; fetched again whenever `when` changes.
export function useMaps(when: unknown): MapSummary[] {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/maps")
      .then((r) => r.json() as Promise<MapSummary[]>)
      .then((m) => {
        if (live) setMaps(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [when]);
  return maps;
}

// The model behind the canvas and the choices its pickers offer, asked once.
let providerInfo: Promise<ProviderInfo> | null = null;
const FALLBACK: ProviderInfo = {
  name: "",
  models: [{ id: "", label: "Default model" }],
  efforts: [{ id: "", label: "Default effort" }],
};

export function useProvider(): ProviderInfo {
  const [info, setInfo] = useState<ProviderInfo>(FALLBACK);
  useEffect(() => {
    providerInfo ??= fetch("/api/provider")
      .then((r) => r.json() as Promise<ProviderInfo>)
      .catch(() => FALLBACK);
    let live = true;
    void providerInfo.then((i) => {
      if (live) setInfo(i);
    });
    return () => {
      live = false;
    };
  }, []);
  return info;
}

// Is a newer release out? Asked when the app opens and every half hour;
// refresh() asks GitHub again right away.
export function useUpdate(): {
  info: UpdateInfo | null;
  refresh: () => Promise<UpdateInfo | null>;
} {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      fetch("/api/update")
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
        await fetch("/api/update?refresh=1")
      ).json()) as UpdateInfo;
      setInfo(i);
      return i;
    } catch {
      return null;
    }
  }, []);
  return { info, refresh };
}
