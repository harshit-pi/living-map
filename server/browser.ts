// Opens a link in your default browser: how the page hands a map to a browser
// of yours, signed in there by a fresh one-time link (POST /api/open).

import { execFile } from "node:child_process";

export function openInBrowser(url: string): Promise<void> {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 10_000 }, (err) =>
      err ? reject(err) : resolve(),
    ),
  );
}
