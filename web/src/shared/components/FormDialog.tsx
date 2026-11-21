import { type ComponentProps, useState } from "react";
import { Dialog, DialogContent } from "@/shared/components/PianoDialog";
import { ApiError } from "@/shared/transport/api";

export function FormDialog({
  open = true,
  busy = false,
  close,
  ...content
}: Omit<ComponentProps<typeof DialogContent>, "showCloseButton"> & {
  open?: boolean;
  busy?: boolean;
  close: () => void;
}) {
  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <DialogContent {...content} showCloseButton={!busy} />
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
