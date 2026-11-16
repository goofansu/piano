import { LITERAL_SECRET_MAX } from "@shared/literalSecret";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/FormDialog";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSetupActions } from "@/lib/useSetupActions";

export function ApiKeyDialog({
  title,
  description,
  save,
  done,
  fallback,
  close,
  refresh,
}: {
  title: string;
  description: string;
  save: (key: string) => Promise<unknown>;
  done: string;
  fallback: string;
  close: () => void;
  refresh: () => void;
}) {
  const id = useId();
  const [key, setKey] = useState("");
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  return (
    <FormDialog busy={busy} close={close} className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !key.trim()) return;
          void actions.run({
            id: "save-key",
            run: async () => {
              await save(key.trim());
              setKey("");
              close();
            },
            done,
            fallback,
          });
        }}
      >
        <FieldGroup>
          <Field data-disabled={busy} data-invalid={!!actions.error || undefined}>
            <FieldLabel htmlFor={id}>API key</FieldLabel>
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={LITERAL_SECRET_MAX}
              required
              disabled={busy}
              aria-invalid={!!actions.error || undefined}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            {actions.error && <FieldError role="alert">{actions.error}</FieldError>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy && <Spinner data-icon="inline-start" />}
            Save
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}
