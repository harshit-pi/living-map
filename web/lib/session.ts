import { useEffect, useState } from "react";

// The page's token for the local API (see server/auth.ts). The page signs in
// once through the one-time link the skill opens, which sets a cookie; the
// token itself is then asked for here and sent on every request, since a
// cookie alone never allows a write.

let token: Promise<string | null> | null = null;

export function sessionToken(): Promise<string | null> {
  token ??= fetch("/api/session")
    .then(async (r) =>
      r.ok ? (((await r.json()) as { token?: string }).token ?? null) : null,
    )
    .catch(() => null);
  return token;
}

// fetch, with the token
export async function api(url: string, init: RequestInit = {}) {
  const t = await sessionToken();
  const headers = new Headers(init.headers);
  if (t) headers.set("X-LM-Token", t);
  return fetch(url, { ...init, headers });
}

// signed in (true), not (false), or not known yet (null)
export function useSignedIn(): boolean | null {
  const [signed, setSigned] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void sessionToken().then((t) => {
      if (live) setSigned(!!t);
    });
    return () => {
      live = false;
    };
  }, []);
  return signed;
}
