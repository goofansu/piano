import { useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export interface SavedSecret {
  readonly saved: boolean;
  readonly value: string;
  readonly cleared: boolean;
  readonly type: (value: string) => void;
  readonly toggleRemove: () => void;
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
  noun: string;
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
