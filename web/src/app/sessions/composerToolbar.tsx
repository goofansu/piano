import { modelPickerEnabled } from "@features/models/web/modelPicker";
import { ModelSelect } from "@features/models/web/ModelSelect";
import type { ModelControl } from "@features/models/web/useModelChoice";
import type { EditorToolbar } from "@features/sessions/web/composer/DraftEditor";
import { useDrafts } from "@features/sessions/web/composer/useDrafts";
import type { VoiceHints } from "@features/voice-input/contracts/voiceInput";
import { VoiceInputButton } from "@features/voice-input/web/VoiceInputButton";

export function useComposerToolbar(
  control: ModelControl,
  place: VoiceHints | undefined,
): EditorToolbar {
  const drafts = useDrafts();
  return {
    pickerEnabled: modelPickerEnabled({
      disabled: false,
      catalog: control.models.catalog,
      canRefresh: !!control.models.refresh,
    }),
    renderModel: (props) => <ModelSelect {...props} control={control} />,
    renderVoice: (editor, disabled) => (
      <VoiceInputButton
        drafts={drafts}
        editor={editor}
        session={() => place ?? {}}
        disabled={disabled}
      />
    ),
  };
}
