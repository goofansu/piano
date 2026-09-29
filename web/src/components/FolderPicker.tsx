import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, CheckIcon, FolderIcon, FolderPlusIcon, GitBranchIcon, HomeIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { DirListing } from "@shared/wire";
import { abbrevHome } from "@/lib/format";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
  initialPath?: string;
}

const LAST_KEY = "piano.pickerPath";
const MAX_VISIBLE = 500;

/**
 * Directory picker in the style of Shelley's: one path input is the whole model.
 * A trailing slash browses inside that directory; text after the last slash filters
 * the listing by prefix. Enter selects the directory being typed.
 */
export function FolderPicker({ open, onOpenChange, onPick, initialPath }: Props) {
  const [input, setInput] = useState("");
  const [dir, setDir] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const cache = useRef(new Map<string, DirListing>());
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { dirPath, prefix } = useMemo(() => parseInput(input), [input]);

  useEffect(() => {
    if (!open) return;
    let start = initialPath || "";
    if (!start) {
      try {
        start = localStorage.getItem(LAST_KEY) || "";
      } catch {
        /* ignore */
      }
    }
    setInput(start ? withSlash(start) : "~/");
    setCreating(false);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, initialPath]);

  // Load whatever directory the input currently points at.
  useEffect(() => {
    if (!open) return;
    const key = dirPath || "~";
    const cached = cache.current.get(key);
    if (cached) {
      setDir(cached);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    fetch(`/api/ls?path=${encodeURIComponent(key)}`)
      .then((r) => r.json() as Promise<DirListing | { error: string }>)
      .then((d) => {
        if (mine !== seq.current) return;
        if ("error" in d) {
          setError(d.error);
          setDir(null);
        } else {
          cache.current.set(key, d);
          cache.current.set(d.path, d);
          setDir(d);
          setError(null);
        }
      })
      .catch((e) => mine === seq.current && setError(String(e)))
      .finally(() => mine === seq.current && setLoading(false));
  }, [open, dirPath]);

  const entries = useMemo(() => {
    const all = dir?.entries ?? [];
    return prefix ? all.filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase())) : all;
  }, [dir, prefix]);
  const visible = entries.slice(0, MAX_VISIBLE);
  const hidden = entries.length - visible.length;

  const goTo = (path: string) => setInput(withSlash(path));
  const selected = dir && !prefix ? dir.path : dir ? dir.path : "";

  const select = () => {
    const path = input.endsWith("/") ? dirPath || dir?.path : entries.length === 1 && prefix ? entries[0].path : dir?.path;
    if (!path) return;
    try {
      localStorage.setItem(LAST_KEY, path);
    } catch {
      /* ignore */
    }
    onPick(path);
    onOpenChange(false);
  };

  const createFolder = async () => {
    const name = newName.trim();
    if (!name || !dir) return;
    if (/[\\/]/.test(name)) {
      toast.error("Folder name cannot contain slashes");
      return;
    }
    const r = await fetch("/api/mkdir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: `${dir.path}/${name}` }) });
    const d = (await r.json()) as { path?: string; error?: string };
    if (d.error || !d.path) {
      toast.error(d.error ?? "Could not create folder");
      return;
    }
    cache.current.delete(dir.path);
    cache.current.delete(dirPath || "~");
    setCreating(false);
    setNewName("");
    goTo(d.path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a directory</DialogTitle>
        </DialogHeader>

        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              select();
            }
          }}
          placeholder="/path/to/directory"
          spellCheck={false}
          className="font-mono text-sm"
        />

        {dir && (
          <div className="flex items-center gap-2 rounded-md bg-fill px-2.5 py-1.5 font-mono text-sm">
            <span className="min-w-0 truncate">
              {abbrevHome(dir.path, dir.home)}
              {prefix && <span className="text-ink-3">/{prefix}*</span>}
            </span>
            {dir.gitSubject && (
              <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-ink-2" title={dir.gitSubject}>
                <GitBranchIcon className="size-3 shrink-0" /> <span className="truncate">{dir.gitSubject}</span>
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {dir && dir.path !== dir.home && (
            <Button type="button" variant="outline" size="sm" onClick={() => goTo(dir.home)}>
              <HomeIcon className="size-3.5" /> Home
            </Button>
          )}
          {dir?.gitRoot && dir.gitRoot !== dir.path && (
            <Button type="button" variant="outline" size="sm" onClick={() => goTo(dir.gitRoot as string)}>
              <GitBranchIcon className="size-3.5" /> Git root <span className="font-mono text-ink-2">{abbrevHome(dir.gitRoot, dir.home)}</span>
            </Button>
          )}
        </div>

        {error && <div className="text-sm text-err">{error}</div>}

        <div className="h-56 shrink-0 overflow-y-auto rounded-md border border-line bg-surface-1">
          {loading && !dir && <p className="p-4 text-sm text-ink-2">Loading</p>}
          {dir?.parent && (
            <button type="button" onClick={() => goTo(dir.parent as string)} className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm outline-none hover:bg-fill-hover focus-visible:bg-fill-hover">
              <ArrowLeftIcon className="size-4 text-ink-2" /> <span className="font-mono">..</span>
            </button>
          )}
          {visible.map((e) => (
            <button type="button" key={e.path} onClick={() => goTo(e.path)} className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm outline-none hover:bg-fill-hover focus-visible:bg-fill-hover">
              <FolderIcon className={cn("size-4 shrink-0", e.gitSubject ? "text-brand" : "text-ink-3")} />
              <span className="min-w-0 flex-1 truncate">
                {prefix ? (
                  <>
                    <strong>{e.name.slice(0, prefix.length)}</strong>
                    {e.name.slice(prefix.length)}
                  </>
                ) : (
                  e.name
                )}
              </span>
              {e.gitSubject && <span className="max-w-[45%] truncate text-ink-3" title={e.gitSubject}>{e.gitSubject}</span>}
            </button>
          ))}
          {creating && dir && (
            <form
              className="flex items-center gap-2 px-3 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                void createFolder();
              }}
            >
              <FolderPlusIcon className="size-4 text-ink-2" />
              <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New folder name" className="h-8 font-mono text-sm" aria-label="New folder name" />
              <Button type="submit" size="icon-xs" aria-label="Create" disabled={!newName.trim()}><CheckIcon /></Button>
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setCreating(false)}><XIcon /></Button>
            </form>
          )}
          {hidden > 0 && <p className="px-3 py-2 text-sm text-ink-3">{hidden.toLocaleString()} more. Type to filter.</p>}
          {dir && entries.length === 0 && !creating && (
            <p className="p-4 text-center text-sm text-ink-2">{prefix ? "No matching directories" : "No subdirectories"}</p>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button type="button" variant="ghost" size="sm" disabled={!dir || creating} onClick={() => setCreating(true)}>
            <FolderPlusIcon /> New folder
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" disabled={!dir || loading} onClick={select}>Use this directory</Button>
          </div>
        </DialogFooter>
        <span className="sr-only">{selected}</span>
      </DialogContent>
    </Dialog>
  );
}

function withSlash(p: string): string {
  return p === "/" ? "/" : p.endsWith("/") ? p : `${p}/`;
}

function parseInput(path: string): { dirPath: string; prefix: string } {
  if (!path) return { dirPath: "", prefix: "" };
  if (path.endsWith("/")) return { dirPath: path.slice(0, -1) || "/", prefix: "" };
  const i = path.lastIndexOf("/");
  if (i === -1) return { dirPath: "", prefix: path };
  if (i === 0) return { dirPath: "/", prefix: path.slice(1) };
  return { dirPath: path.slice(0, i), prefix: path.slice(i + 1) };
}
