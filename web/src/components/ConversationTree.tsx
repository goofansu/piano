import type { ConversationDetail, ConversationEntry, SessionActionResult, ConversationTree as Tree } from "@shared/wire";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** Command supplies keyboard selection; this is an outline, not an editable ARIA tree. */
function outline(entries: readonly ConversationEntry[], technical: boolean, search: string, bookmarks: boolean) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const children = new Map<string | null, ConversationEntry[]>();
  for (const entry of entries) {
    const parent = entry.parentId && byId.has(entry.parentId) ? entry.parentId : null;
    children.set(parent, [...children.get(parent) ?? [], entry]);
  }
  const result: { entry: ConversationEntry; depth: number }[] = [];
  const seen = new Set<string>();
  const stack = [...children.get(null) ?? []].reverse().map(entry => ({ entry, depth: 0 }));
  while (stack.length) {
    const { entry, depth } = stack.pop()!;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const visible = technical || !entry.technical || !!entry.label;
    if (visible && (!bookmarks || !!entry.label) && `${entry.kind} ${entry.preview} ${entry.label ?? ""}`.toLowerCase().includes(search.toLowerCase())) result.push({ entry, depth });
    for (const child of [...children.get(entry.id) ?? []].reverse()) stack.push({ entry: child, depth: depth + (visible ? 1 : 0) });
  }
  return result;
}

export function ConversationTree({ open, onOpenChange, workspaceId, sessionId, revision }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspaceId?: string; sessionId: string; revision: unknown;
}) {
  const [tree, setTree] = useState<Tree>();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [technical, setTechnical] = useState(false);
  const [bookmarks, setBookmarks] = useState(false);
  const [bookmarkForm, setBookmarkForm] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const bookmarkInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (bookmarkForm) bookmarkInput.current?.focus(); }, [bookmarkForm]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setBookmarkForm(false); }, [selected]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const url = `/api/session/history?${new URLSearchParams({ workspaceId: workspaceId ?? "", sessionId })}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(url, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const result = body as SessionActionResult;
      if (result._tag !== "conversation_tree" || result.tree.sessionId !== sessionId) throw new Error("History response did not match this session.");
      if (!controller.signal.aborted) setTree(result.tree);
    }).catch(error => { if (!controller.signal.aborted) { setError(String(error.message)); setTree(undefined); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, url, sessionId, refresh, revision]);

  useEffect(() => {
    setDetail(undefined); setDetailError("");
    if (!open || !selected) return;
    const controller = new AbortController();
    void fetch(`${url}&${new URLSearchParams({ entryId: selected })}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const result = body as SessionActionResult;
      if (result._tag !== "conversation_detail" || result.detail.sessionId !== sessionId || result.detail.entryId !== selected) throw new Error("Preview response did not match this entry.");
      if (!controller.signal.aborted) setDetail(result.detail);
    }).catch(error => { if (!controller.signal.aborted) setDetailError(String(error.message)); });
    return () => controller.abort();
  }, [open, selected, url, sessionId, refresh]);

  const showCurrent = () => {
    setSearch(""); setTechnical(true); setBookmarks(false);
    // cmdk selects the first newly mounted result after filters change. Restore
    // the requested position after that layout, not before the rows exist.
    requestAnimationFrame(() => {
      setSelected(tree?.leafId ?? "");
      requestAnimationFrame(() => list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    });
  };
  const rows = outline(tree?.entries ?? [], technical, search, bookmarks);
  const selectedEntry = tree?.entries.find(entry => entry.id === selected);
  const saveBookmark = async (value: string) => {
    if (!tree || !selected || saving) return;
    const requestId = crypto.randomUUID();
    setSaving(true); setMutationError("");
    try {
      // Do not cancel/replay an admitted mutation when the dialog closes.
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        _tag: "bookmark", requestId, entryId: selected, label: value, expected: tree.position,
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result._tag !== "bookmark" || result.requestId !== requestId || result.outcome !== "success" || result.tree?.sessionId !== sessionId) throw new Error(result.detail ?? "Bookmark result is uncertain. Refresh history before retrying.");
      if (mounted.current) { setTree(result.tree); setBookmarkForm(false); }
    } catch (error) { if (mounted.current) setMutationError(`${error instanceof Error ? error.message : String(error)} Refresh history before deciding whether to retry; a lost response does not undo a saved bookmark.`); }
    finally { if (mounted.current) { setSaving(false); setRefresh(r => r + 1); } }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
      <DialogHeader><DialogTitle>Conversation tree</DialogTitle><DialogDescription>Preview history without changing the conversation. Search labels and the first 280 characters of each entry.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={showCurrent} disabled={!tree?.leafId}>Show current position</Button>
        <Button variant="ghost" size="sm" onClick={() => setRefresh(r => r + 1)} disabled={loading}>Refresh</Button>
        <Field orientation="horizontal" className="w-auto"><Checkbox id="tree-bookmarks" checked={bookmarks} onCheckedChange={value => setBookmarks(value === true)} /><FieldLabel htmlFor="tree-bookmarks">Bookmarks</FieldLabel></Field>
        <Field orientation="horizontal" className="w-auto"><Checkbox id="tree-technical" checked={technical} onCheckedChange={value => setTechnical(value === true)} /><FieldLabel htmlFor="tree-technical">Technical entries</FieldLabel></Field>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading && !tree && <Skeleton className="h-24 w-full" />}
      {tree?.truncated && <p className="text-sm text-muted-foreground">Showing {tree.entries.length} of {tree.total} entries: recent history and the current position. Older entries are outside this search.</p>}
      {tree && !tree.leafId && <p className="text-sm text-muted-foreground">Current position: before the first entry.</p>}
      <div className="grid min-h-0 gap-4 overflow-auto md:grid-cols-2">
        <Command shouldFilter={false} value={selected} onValueChange={setSelected}>
          <CommandInput ref={input} value={search} onValueChange={setSearch} placeholder="Search history previews…" aria-label="Search history previews" />
          <CommandList ref={list} className="max-h-[35dvh] md:max-h-[55dvh]">
            <CommandEmpty>{loading ? "Loading history…" : "No matching entries."}</CommandEmpty>
            <CommandGroup>
              {rows.map(({ entry, depth }) => <CommandItem key={entry.id} value={entry.id} onSelect={() => setSelected(entry.id)}>
                <div className="flex min-w-0 flex-col gap-1" style={{ paddingInlineStart: Math.min(depth, 8) * 12 }}>
                  <span className="flex flex-wrap items-center gap-2"><span>{entry.kind}</span>{entry.id === tree?.leafId ? <Badge variant="secondary">Current position</Badge> : entry.onCurrentPath && <span className="text-xs text-muted-foreground">Current path</span>}{entry.label && <Badge variant="outline">{entry.label}</Badge>}</span>
                  <span className="line-clamp-2 break-all text-muted-foreground">{entry.preview}</span>
                </div>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
        <section aria-label="Entry preview" className="flex min-w-0 flex-col gap-2 overflow-auto md:max-h-[55dvh]">
          {selectedEntry && <>
            <Button variant="outline" size="sm" disabled={saving || !!tree?.bookmarkUnavailable} onClick={() => { setLabel(selectedEntry.label ?? ""); setBookmarkForm(true); }}>Bookmark</Button>
            {tree?.bookmarkUnavailable && <p className="text-sm text-muted-foreground">{tree.bookmarkUnavailable}</p>}
          </>}
          {bookmarkForm && <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void saveBookmark(label); }}>
            <Field><FieldLabel htmlFor="bookmark-label">Bookmark name</FieldLabel><Input ref={bookmarkInput} id="bookmark-label" aria-label="Bookmark name" value={label} onChange={event => setLabel(event.target.value)} maxLength={200} disabled={saving} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving || !label.trim()}>{saving ? "Saving…" : "Save bookmark"}</Button>
              {selectedEntry?.label && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveBookmark("")}>Remove bookmark</Button>}
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setBookmarkForm(false)}>Cancel</Button>
            </div>
          </form>}
          {mutationError && <Alert variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert>}
          {detailError ? <Alert variant="destructive"><AlertDescription>{detailError}</AlertDescription></Alert> : detail ? <>
            <pre className="whitespace-pre-wrap break-words text-sm">{detail.text}</pre>
            {(detail.truncated || detail.omittedImages > 0) && <p className="text-sm text-muted-foreground">{detail.truncated && "Preview limited to 32,000 characters. "}{detail.omittedImages > 0 && `${detail.omittedImages} image(s) omitted.`}</p>}
          </> : <p className="text-sm text-muted-foreground">{selected ? "Loading preview…" : "Choose an entry to preview."}</p>}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}
