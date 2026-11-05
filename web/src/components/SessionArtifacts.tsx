import { ExternalLinkIcon, ShapesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { artifactsMenu } from "@/lib/artifactsMenu";
import { sessionArtifacts } from "@/lib/sessionArtifacts";
import type { AppState } from "@/store";

/**
 * The session header's Artifacts control: its icon and how many Radius artifacts the session
 * published, left out until there is one. It opens a menu of their titles, newest first; each opens
 * its artifact in a new tab. The palette's Artifacts command opens the same menu.
 */
export function ArtifactsMenu({ state }: { state: AppState }) {
  const artifacts = sessionArtifacts(state.session?.messages ?? [], state.session?.state.artifacts);
  const [open, setOpen] = useState(false);
  useEffect(() => artifactsMenu.subscribe(() => setOpen(true)), []);
  if (!artifacts.length) return null;
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <PianoButton
              data-artifacts-trigger
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-ink-2 pointer-coarse:h-11"
            >
              <ShapesIcon aria-hidden />
              <span className="sr-only">Artifacts:</span>
              <span className="text-xs tabular-nums">{artifacts.length}</span>
            </PianoButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Artifacts</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-(--radix-dropdown-menu-content-available-height) w-80 overflow-y-auto"
      >
        <DropdownMenuGroup>
          {artifacts.map((artifact) => (
            <DropdownMenuItem key={artifact.id} asChild>
              <a href={artifact.url} target="_blank" rel="noopener noreferrer" title={artifact.url}>
                <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
                <ExternalLinkIcon aria-hidden className="text-ink-3" />
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
