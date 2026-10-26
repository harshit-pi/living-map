// Where things live, and how the server is run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.PORT ?? 4317);
// where the map's store, token and settings live; LIVING_MAP_HOME moves it
// (e.g. a separate copy for testing that must not touch your own)
export const HOME = process.env.LIVING_MAP_HOME
  ? path.resolve(process.env.LIVING_MAP_HOME)
  : path.join(os.homedir(), ".living-map");
export const PROVIDER = process.env.LIVING_MAP_PROVIDER;
// the app folder (package.json, the browser build, the git checkout it lives in)
export const APP_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// the built browser app
export const STATIC_DIR = path.join(APP_DIR, "dist");
// set by the launcher (npm start), which restarts the server after an update
export const UNDER_LAUNCHER = process.env.LIVING_MAP_LAUNCHER === "1";
// the exit code that asks the launcher to start the server again
export const RESTART_CODE = 75;

fs.mkdirSync(HOME, { recursive: true });
