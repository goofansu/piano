import { type ComponentProps, useState } from "react";
import { Dialog, DialogContent } from "@/components/PianoDialog";
import { ApiError } from "@/lib/api";

/**
 * A dialog that holds a form, deciding how it is dismissed so a half-filled form is never lost to a
 * stray click: an outside click never closes it (Escape, the close control and Cancel do), and while
 * `busy` nothing closes it and the close control hides.
 */
export function FormDialog({
  open = true,
  busy = false,
  close,
  ...content
}: Omit<ComponentProps<typeof DialogContent>, "showCloseButton" | "onInteractOutside"> & {
  open?: boolean;
  busy?: boolean;
  close: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <DialogContent
        {...content}
        showCloseButton={!busy}
        onInteractOutside={(event) => event.preventDefault()}
      />
    </Dialog>
  );
}

/**
 * Where a form dialog shows its save's refusal: under the field the server named, when it is one of
 * `fields`, else below the form. `scope` keeps a refusal to the part of the form that sent it (a tab),
 * so switching parts does not carry it over. `error` is the refusal's text, as the actions keep it.
 */
export function useFieldRefusal<F extends string>(fields: readonly F[], error: string | undefined) {
  const [refusal, setRefusal] = useState<{ field: F | undefined; scope?: string }>();
  return {
    /** Records the field `cause` names and rethrows it, as a save's `.catch`. */
    record: (cause: unknown, scope?: string): never => {
      const named = cause instanceof ApiError ? cause.field : undefined;
      setRefusal({ field: fields.find((field) => field === named), scope });
      throw cause;
    },
    /** The refusal to show at `field`; `undefined` asks for the one below the form. */
    at: (field: F | undefined, scope?: string) =>
      error && refusal && refusal.field === field && refusal.scope === scope ? error : undefined,
  };
}
