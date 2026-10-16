// Where things live and the few numbers that shape a move.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.PORT ?? 4317);
export const HOME = path.join(os.homedir(), ".living-map");
export const MAPS_DIR = path.join(HOME, "maps");
export const CURRENT_FILE = path.join(HOME, "current.txt");
// the folder the model works in (it may read files there when you ask it to)
export const MODEL_CWD =
  process.env.LIVING_MAP_CWD ?? path.join(HOME, "workspace");
export const PROVIDER = process.env.LIVING_MAP_PROVIDER;
export const DEBUG = !!process.env.LM_DEBUG;
// the built browser app
export const STATIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);

// messages of a thread sent with each move: enough context, flat input as you go
export const HISTORY = 14;

for (const d of [MAPS_DIR, MODEL_CWD]) fs.mkdirSync(d, { recursive: true });
