import { useEffect, useState } from "react";
import { ArrowUpIcon, FolderIcon, HomeIcon } from "lucide-react";
import { toast } from "sonner";
import type { DirListing } from "@shared/wire";
import { abbrevHome } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
}

/** Browsers cannot reveal absolute directory paths, so the picker browses the server's filesystem. */
export function FolderPicker({ open, onOpenChange, onPick }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [input, setInput] = useState("");

  const load = async (path: string) => {
    try {
      const r = await fetch(`/api/ls?path=${encodeURIComponent(path || "~")}`);
      const d = (await r.json()) as DirListing | { error: string };
      if ("error" in d) {
        toast.error(d.error);
        return;
      }
      setListing(d);
      setInput(d.path);
      try {
        localStorage.setItem("piano.pickerPath", d.path);
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    let start = "~";
    try {
      start = localStorage.getItem("piano.pickerPath") || "~";
    } catch {
      /* ignore */
    }
    void load(start);
  }, [open]);

  const crumbs = listing ? listing.path.split("/").filter(Boolean) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a project folder</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1 font-mono text-xs">
          <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => load("/")}>/</Button>
          {crumbs.map((seg, i) => {
            const path = `/${crumbs.slice(0, i + 1).join("/")}`;
            return (
              <span key={path} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                {i === crumbs.length - 1 ? <span className="px-1">{seg}</span> : <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => load(path)}>{seg}</Button>}
              </span>
            );
          })}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(input.trim());
          }}
        >
          <Button type="button" variant="outline" size="icon" aria-label="Home" onClick={() => load(listing?.home ?? "~")}><HomeIcon /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Up" disabled={!listing?.parent} onClick={() => listing?.parent && load(listing.parent)}><ArrowUpIcon /></Button>
          <Input value={input} onChange={(e) => setInput(e.target.value)} className="font-mono text-xs" placeholder="/absolute/path or ~/…" />
          <Button type="submit" variant="secondary">Go</Button>
        </form>
        <ScrollArea className="h-72 rounded-md border">
          {listing && listing.entries.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">No subfolders. Use this folder, or go up.</p>}
          {listing?.entries.map((e) => (
            <button
              type="button"
              key={e.path}
              onClick={() => load(e.path)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
            >
              <FolderIcon className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {e.git && <Badge variant="outline" className="h-4 px-1 text-[9px] text-emerald-600 dark:text-emerald-400">git</Badge>}
            </button>
          ))}
        </ScrollArea>
        <DialogFooter className="items-center sm:justify-between">
          <span className="truncate font-mono text-xs text-muted-foreground">{listing ? abbrevHome(listing.path, listing.home) : ""}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!listing}
              onClick={() => {
                if (!listing) return;
                onPick(listing.path);
                onOpenChange(false);
                toast(`Added ${abbrevHome(listing.path, listing.home)}`);
              }}
            >
              Use this folder
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
