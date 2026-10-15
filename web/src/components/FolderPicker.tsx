import { cn } from "cn";
import {
  ArrowUpIcon,
  CheckIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  HomeIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { abbrevHome } from "@/lib/format";
import { listRow } from "@/lib/styles";
import { useFolderBrowser } from "@/lib/useFolderBrowser";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
  initialPath?: string;
}

/**
 * Directory picker in the style of Shelley's: one path input is the whole model
 * (`@/lib/folderPath`), browsed by `@/lib/folderBrowser`. Enter selects the directory being typed.
 */
export function FolderPicker({ open, onOpenChange, onPick, initialPath }: Props) {
  const browser = useFolderBrowser(open, initialPath);
  const { input, prefix, dir, error, loading, mutating, ready, creating, goTo } = browser;
  const { matches, visible, hidden } = browser;
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const selected = dir?.path ?? "";

  const select = () => {
    const path = browser.pick();
    if (path === undefined) return;
    onPick(path);
    onOpenChange(false);
  };

  const createFolder = async () => {
    if ((await browser.createFolder(newName)) === "created") setNewName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
        </DialogHeader>

        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => browser.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              select();
            }
          }}
          placeholder="/path/to/folder"
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          className="font-mono text-sm"
        />

        {dir && (
          <div className="flex items-center gap-2 rounded-md bg-fill px-2.5 py-1.5 font-mono text-sm">
            <span className="min-w-0 truncate">
              {abbrevHome(dir.path, dir.home)}
              {prefix && <span className="text-ink-3">/{prefix}*</span>}
            </span>
            {dir.gitSubject && (
              <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-ink-2">
                <GitBranchIcon className="size-3 shrink-0" />{" "}
                <span className="truncate">{dir.gitSubject}</span>
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {dir && dir.path !== dir.home && (
            <Button type="button" variant="outline" size="sm" onClick={() => goTo(dir.home)}>
              <HomeIcon /> Home
            </Button>
          )}
          {dir?.gitRoot && dir.gitRoot !== dir.path && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goTo(dir.gitRoot as string)}
            >
              <GitBranchIcon /> Git root{" "}
              <span className="font-mono text-ink-2">{abbrevHome(dir.gitRoot, dir.home)}</span>
            </Button>
          )}
        </div>

        {error && (
          <Alert variant="destructive" className="animate-in fade-in-0 slide-in-from-top-1">
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}

        <ScrollArea className="h-56 shrink-0 rounded-md border border-line bg-surface-1">
          {/* Each listing fades in, so stepping through directories reads as one surface changing. */}
          <div key={dir?.path ?? "loading"} className="animate-in fade-in-0 duration-200">
            {loading && !dir && (
              <div className="flex flex-col gap-2 p-3" aria-busy>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            )}
            {dir?.parent && (
              <button
                type="button"
                onClick={() => goTo(dir.parent as string)}
                className={cn(listRow, "h-9 px-3")}
              >
                <ArrowUpIcon className="size-4 text-ink-2" /> <span className="font-mono">..</span>
              </button>
            )}
            {visible.map((e) => (
              <button
                type="button"
                key={e.path}
                onClick={() => goTo(e.path)}
                className={cn(listRow, "h-9 px-3")}
              >
                <FolderIcon
                  className={cn("size-4 shrink-0", e.gitSubject ? "text-brand" : "text-ink-3")}
                />
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
                {e.gitSubject && (
                  <span className="max-w-[45%] truncate text-ink-3">{e.gitSubject}</span>
                )}
              </button>
            ))}
            {creating && dir && (
              <form
                className="flex animate-in items-center gap-2 px-3 py-1 fade-in-0 slide-in-from-top-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createFolder();
                }}
              >
                <FolderPlusIcon className="size-4 text-ink-2" />
                <Input
                  autoFocus
                  value={newName}
                  disabled={mutating}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New folder name"
                  className="h-8 font-mono text-sm"
                  aria-label="New folder name"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                />
                <Button
                  type="submit"
                  size="icon-xs"
                  aria-label="Create"
                  disabled={!ready || !newName.trim()}
                >
                  <CheckIcon />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Cancel"
                  onClick={browser.cancelCreating}
                >
                  <XIcon />
                </Button>
              </form>
            )}
            {hidden > 0 && (
              <p className="px-3 py-2 text-sm text-ink-3">
                {hidden.toLocaleString()} more. Type to filter.
              </p>
            )}
            {dir && matches.length === 0 && !creating && (
              <Empty className="p-6 md:p-6">
                <EmptyHeader>
                  <EmptyDescription>
                    {prefix ? "No matching folders" : "No subfolders"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready || creating}
            onClick={browser.startCreating}
          >
            <FolderPlusIcon /> New folder
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!ready} onClick={select}>
              Use this folder
            </Button>
          </div>
        </DialogFooter>
        <span className="sr-only">{selected}</span>
      </DialogContent>
    </Dialog>
  );
}
