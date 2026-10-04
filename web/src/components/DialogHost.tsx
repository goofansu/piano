import { useEffect, useState } from "react";
import type { ClientMessage, Dialog as PiDialog } from "@shared/wire";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Extension dialogs (select / confirm / input / editor) raised by Pi; answered one at a time. */
export function DialogHost({ dialogs, send, connected }: { dialogs: PiDialog[]; send: (m: ClientMessage) => void; connected: boolean }) {
  const d = dialogs[0];
  return d ? <DialogView key={`${d.generation}/${d.id}`} d={d} more={dialogs.length - 1} send={send} connected={connected} /> : null;
}

function DialogView({ d, more, send, connected }: { d: PiDialog; more: number; send: (m: ClientMessage) => void; connected: boolean }) {
  const [value, setValue] = useState(d.prefill ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const disabled = submitted || !connected || now >= d.deadlineAt;
  const answer = (a: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
    if (disabled) return;
    setSubmitted(true);
    send({ _tag: "act", action: { _tag: "answer", id: d.id, generation: d.generation, ...a } });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && answer({ cancelled: true })}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{d.title || "Pi needs an answer"}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {d.message && <>{d.message}<br /></>}
            {d.deadlineKind === "pi-timeout" ? "Estimated Pi timeout" : "Host recovery cancellation"}: {Math.max(0, Math.ceil((d.deadlineAt - now) / 1000))}s remaining.
            {" "}<time dateTime={new Date(d.deadlineAt).toISOString()}>{new Date(d.deadlineAt).toLocaleTimeString()}</time>.
            {" "}Pi may have already closed this dialog; it sends no closure acknowledgement.
          </DialogDescription>
          {more > 0 && <p className="text-sm text-ink-3">{more} more {more === 1 ? "question" : "questions"} after this one.</p>}
        </DialogHeader>
        <fieldset disabled={disabled} className="contents">
        {d.method === "select" && (
          <div className="flex flex-col gap-2">
            {(d.options ?? []).map((o) => (
              <Button key={o} variant="outline" size="lg" className="justify-start font-normal" onClick={() => answer({ value: o })}>{o}</Button>
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
              {d.method !== "select" && <Button type="submit" form="pi-dialog-form">Send answer</Button>}
            </>
          )}
        </DialogFooter>
        </fieldset>
        <div className="flex items-center gap-3 border-t border-line pt-3 text-xs text-ink-2">
          <Button variant="outline" size="sm" disabled={!connected || submitted} onClick={() => {
            setSubmitted(true);
            send({ _tag: "act", action: { _tag: "abort" } });
          }}>Abort current</Button>
          <p>Cancels waiting dialogs and requests native abort. Pending queued input is not cleared.</p>
        </div>
        {submitted && <p role="status" className="text-sm text-ink-2">Waiting for the host’s resolution. Do not resend on reconnect.</p>}
      </DialogContent>
    </Dialog>
  );
}
