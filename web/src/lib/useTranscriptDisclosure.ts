import { createContext, useContext, useState } from "react";

/** Disclosure state outlives a windowed row, but never its transcript. It is presentation only;
 * stable message/tool keys avoid coupling expansion to a DOM node or a recycled row index. */
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
