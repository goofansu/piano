import { useModelCatalog, useModelChoice } from "@features/models/web/browser";
import { Composer, type ComposerProps } from "@features/sessions/web/browser";
import type { VoiceHints } from "@features/voice-input/contracts/voiceInput";
import { useComposerToolbar } from "./composerToolbar";
export function SessionComposer(
  props: Omit<ComposerProps, "toolbar" | "choice" | "catalog"> & { place?: VoiceHints },
) {
  const { session: t, actionsDisabled, send: sendCommand, place, ...rest } = props;
  const directoryModels = useModelCatalog(t?.cwd);
  const models = actionsDisabled ? { ...directoryModels, refresh: undefined } : directoryModels;
  const { catalog } = models;
  const choice = useModelChoice(
    models,
    {
      kind: "session",
      cwd: t?.cwd,
      sessionId: t?.sessionId,
      hosted: !!t?.hosted,
      model: t?.state.model,
      thinkingLevel: t?.state.thinkingLevel,
    },
    (action) => sendCommand({ _tag: "act", action }),
    !actionsDisabled,
  );
  const toolbar = useComposerToolbar(choice, place);
  return (
    <Composer
      {...rest}
      session={t}
      actionsDisabled={actionsDisabled}
      send={sendCommand}
      catalog={catalog}
      choice={choice}
      toolbar={toolbar}
    />
  );
}
