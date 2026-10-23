import type { MapDoc } from "../../../shared/model.ts";
import { PLUGIN_ID, type ChatView } from "../shared.ts";

// the Chat state the server shows, if this map has any yet
export const viewOf = (map: MapDoc): ChatView | null =>
  (map.data?.[PLUGIN_ID] as ChatView | undefined) ?? null;
