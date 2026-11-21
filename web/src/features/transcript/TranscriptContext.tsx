import type { RenderMsg, ToolExecution } from "@shared/wire";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { createTranscriptProjector, type TranscriptProjection } from "./transcript";
import { createTranscriptViewport, type TranscriptViewport } from "./transcriptViewport";

const TranscriptContext = createContext<{
  projection: TranscriptProjection;
  messageCount: number;
} | null>(null);
const TranscriptViewportContext = createContext<TranscriptViewport | null>(null);

export function TranscriptProvider({
  messages,
  pending,
  tools,
  working = false,
  showTools = true,
  children,
}: {
  messages: readonly RenderMsg[];
  pending: RenderMsg | null;
  tools?: readonly ToolExecution[];
  working?: boolean;
  showTools?: boolean;
  children: ReactNode;
}) {
  const [viewport] = useState(createTranscriptViewport);
  const [project] = useState(createTranscriptProjector);
  const executions = useMemo(
    () => (tools?.length ? Object.fromEntries(tools.map((tool) => [tool.id, tool])) : undefined),
    [tools],
  );
  const projection = useMemo(
    () => project(messages, { pending, tools: executions, working, showTools }),
    [project, messages, pending, executions, working, showTools],
  );
  return (
    <TranscriptViewportContext value={viewport}>
      <TranscriptContext value={{ projection, messageCount: messages.length }}>
        {children}
      </TranscriptContext>
    </TranscriptViewportContext>
  );
}

export function useTranscript() {
  const transcript = useContext(TranscriptContext);
  if (!transcript) throw new Error("TranscriptProvider is required");
  return transcript;
}

export function useTranscriptViewport() {
  const viewport = useContext(TranscriptViewportContext);
  if (!viewport) throw new Error("TranscriptProvider is required");
  return viewport;
}

export function useTranscriptWheel() {
  return useTranscriptViewport().wheel;
}
