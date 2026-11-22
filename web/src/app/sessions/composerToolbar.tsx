import { modelPickerEnabled, ModelSelect } from "@features/models/web/browser";
import type { ModelControl } from "@features/models/web/browser";
import type { EditorToolbar } from "@features/sessions/web/browser";
import { useDrafts } from "@features/sessions/web/browser";
import type { VoiceHints } from "@features/voice-input/contracts/voiceInput";
import { VoiceInputButton } from "@features/voice-input/web/browser";

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
