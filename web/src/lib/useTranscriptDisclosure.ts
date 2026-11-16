import { createContext, useContext, useState } from "react";

export const TranscriptDisclosures = createContext<Map<string, boolean> | null>(null);
export const TranscriptRowKey = createContext("");

export function useTranscriptDisclosure(key: string, initial = false) {
  const values = useContext(TranscriptDisclosures);
  const row = useContext(TranscriptRowKey);
  const id = `${row}:${key}`;
  const [open, setOpen] = useState(() => values?.get(id) ?? initial);
  return [
    open,
    (value: boolean | ((previous: boolean) => boolean)) => {
      const next = typeof value === "function" ? value(open) : value;
      values?.set(id, next);
      setOpen(next);
    },
  ] as const;
}
