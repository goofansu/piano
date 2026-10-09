import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "@/lib/storage";

export type ConversationDetail = "everything" | "messages";
const KEY = "piano:conversation-detail";
const normalize = (value: string | null): ConversationDetail => value === "messages" ? "messages" : "everything";
let detail = normalize(readStorage(KEY));
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    detail = normalize(readStorage(KEY));
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function setDetail(value: ConversationDetail) {
  detail = value;
  writeStorage(KEY, value);
  notify();
}

/** A display preference only: the authoritative transcript stays intact. */
export function useConversationDetail() {
  const value = useSyncExternalStore(subscribe, () => detail, () => "everything" as const);
  return [value, setDetail] as const;
}
