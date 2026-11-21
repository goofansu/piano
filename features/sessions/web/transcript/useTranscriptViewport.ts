import {
  createTranscriptViewport,
  type TranscriptViewport,
} from "@features/sessions/web/transcript/transcriptViewport";
import { createContext, useContext, useState } from "react";

export const TranscriptViewportContext = createContext<TranscriptViewport | null>(null);

export function useNewTranscriptViewport(): TranscriptViewport {
  const [viewport] = useState(() => createTranscriptViewport());
  return viewport;
}

export function useTranscriptViewport(): TranscriptViewport | null {
  return useContext(TranscriptViewportContext);
}
