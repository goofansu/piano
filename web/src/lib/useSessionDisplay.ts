import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "@/lib/storage";

export type SessionDisplay = "everything" | "messages";
export const SESSION_DISPLAYS = [
  { value: "everything", label: "Show everything" },
  { value: "messages", label: "Messages only" },
] as const satisfies readonly { value: SessionDisplay; label: string }[];
const KEY = "piano:session-display";
const normalize = (value: string | null): SessionDisplay => value === "messages" ? "messages" : "everything";
let display = normalize(readStorage(KEY));
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    display = normalize(readStorage(KEY));
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function setDisplay(value: SessionDisplay) {
  display = value;
  writeStorage(KEY, value);
  notify();
}

/** A display preference only: the authoritative transcript stays intact. */
export function useSessionDisplay() {
  const value = useSyncExternalStore(subscribe, () => display, () => "everything" as const);
  return [value, setDisplay] as const;
}
