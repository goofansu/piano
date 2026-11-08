import { useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

/** A secret field's draft over a secret the server may already hold but never sends back. */
export interface SavedSecret {
  /** Whether the server holds a secret for this field. */
  readonly saved: boolean;
  readonly value: string;
  /** Remove was chosen: the save clears the saved secret. */
  readonly cleared: boolean;
  readonly type: (value: string) => void;
  readonly toggleRemove: () => void;
  /** What a save sends: undefined keeps the saved secret, a string replaces it, null removes it. */
  readonly change: string | null | undefined;
}

export function useSavedSecret(saved: boolean): SavedSecret {
  const [value, setValue] = useState("");
  const [cleared, setCleared] = useState(false);
  return {
    saved,
    value,
    cleared,
    type: (next) => {
      setValue(next);
      setCleared(false);
    },
    toggleRemove: () => setCleared(!cleared),
    change: cleared ? null : value || undefined,
  };
}

/**
 * A saved secret shows as a masked placeholder: blank keeps it, typing replaces it, Remove clears
 * it on save and Keep undoes that before saving.
 */
export function SavedSecretInput({
  secret,
  id,
  noun,
  placeholder,
  maxLength,
  disabled,
  invalid,
}: {
  secret: SavedSecret;
  id: string;
  /** Names the secret in the screen-reader description: "A token is saved; blank keeps it." */
  noun: string;
  /** Shown when nothing is saved, or the saved secret is being removed. */
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const masked = secret.saved && !secret.cleared;
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type="password"
        autoComplete="new-password"
        maxLength={maxLength}
        value={secret.value}
        disabled={disabled}
        aria-invalid={invalid}
        placeholder={masked ? "••••••••••••••••" : placeholder}
        aria-description={masked ? `A ${noun} is saved; blank keeps it.` : undefined}
        onChange={(e) => secret.type(e.target.value)}
      />
      {secret.saved && !secret.value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="button" disabled={disabled} onClick={secret.toggleRemove}>
            {secret.cleared ? "Keep" : "Remove"}
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
