import { createContext, useContext, useState } from "react";
import { createTranscriptViewport, type TranscriptViewport } from "@/lib/transcriptViewport";

/** The session view's transcript viewport, shared by the transcript and its jump list. */
export const TranscriptViewportContext = createContext<TranscriptViewport | null>(null);

/** A viewport that lives as long as the calling component. */
export function useNewTranscriptViewport(): TranscriptViewport {
  const [viewport] = useState(() => createTranscriptViewport());
  return viewport;
}

/** The surrounding transcript's viewport; `null` outside a session view. */
export function useTranscriptViewport(): TranscriptViewport | null {
  return useContext(TranscriptViewportContext);
}
