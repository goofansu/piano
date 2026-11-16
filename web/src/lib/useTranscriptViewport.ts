import { createContext, useContext, useState } from "react";
import { createTranscriptViewport, type TranscriptViewport } from "@/lib/transcriptViewport";

export const TranscriptViewportContext = createContext<TranscriptViewport | null>(null);

export function useNewTranscriptViewport(): TranscriptViewport {
  const [viewport] = useState(() => createTranscriptViewport());
  return viewport;
}

export function useTranscriptViewport(): TranscriptViewport | null {
  return useContext(TranscriptViewportContext);
}
