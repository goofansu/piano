import { useEffect, useState } from "react";
import type { ClientMessage, Dialog as PiDialog } from "@shared/wire";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Extension dialogs (select / confirm / input / editor) raised by pi; answered one at a time. */
export function DialogHost({ dialogs, send }: { dialogs: PiDialog[]; send: (m: ClientMessage) => void }) {
  const d = dialogs[0];
  const [value, setValue] = useState("");
  useEffect(() => setValue(d?.prefill ?? ""), [d?.id, d?.prefill]);
  if (!d) return null;

  const answer = (a: { value?: string; confirmed?: boolean; cancelled?: boolean }) =>
    send({ _tag: "act", action: { _tag: "answer", id: d.id, ...a } });

  return (
    <Dialog open onOpenChange={(open) => !open && answer({ cancelled: true })}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            pi asks · {d.method}{dialogs.length > 1 ? ` · ${dialogs.length - 1} more` : ""}
          </div>
          <DialogTitle>{d.title || "pi needs input"}</DialogTitle>
          {d.message && <DialogDescription className="whitespace-pre-wrap">{d.message}</DialogDescription>}
        </DialogHeader>
        {d.method === "select" && (
          <div className="flex flex-col gap-2">
            {(d.options ?? []).map((o) => (
              <Button key={o} variant="outline" className="justify-start" onClick={() => answer({ value: o })}>{o}</Button>
            ))}
          </div>
        )}
        {(d.method === "input" || d.method === "editor") && (
          <form
            id="pi-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              answer({ value });
            }}
          >
            {d.method === "editor" ? (
              <Textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={d.placeholder} className="min-h-40 font-mono text-sm" />
            ) : (
              <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={d.placeholder} />
            )}
          </form>
        )}
        <DialogFooter>
          {d.method === "confirm" ? (
            <>
              <Button variant="outline" onClick={() => answer({ confirmed: false })}>No</Button>
              <Button onClick={() => answer({ confirmed: true })}>Yes</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => answer({ cancelled: true })}>Cancel</Button>
              {d.method !== "select" && <Button type="submit" form="pi-dialog-form">OK</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
