import { type ComponentProps, useState } from "react";
import { Dialog, DialogContent } from "@/components/PianoDialog";
import { ApiError } from "@/lib/api";

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

export function useFieldRefusal<F extends string>(fields: readonly F[], error: string | undefined) {
  const [refusal, setRefusal] = useState<{ field: F | undefined; scope?: string }>();
  return {
    record: (cause: unknown, scope?: string): never => {
      const named = cause instanceof ApiError ? cause.field : undefined;
      setRefusal({ field: fields.find((field) => field === named), scope });
      throw cause;
    },
    at: (field: F | undefined, scope?: string) =>
      error && refusal && refusal.field === field && refusal.scope === scope ? error : undefined,
  };
}
