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

export function ArtifactsMenu({ state }: { state: AppState }) {
  const artifacts = sessionArtifacts(state.session?.messages ?? [], state.session?.state.artifacts);
  const [open, setOpen] = useState(false);
  useEffect(() => artifactsMenu.subscribe(() => setOpen(true)), []);
  if (!artifacts.length) return null;
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <PianoButton
                  data-artifacts-trigger
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-ink-2 pointer-coarse:h-11"
                />
              }
            >
              <ShapesIcon aria-hidden />
              <span className="sr-only">Artifacts:</span>
              <span className="text-xs tabular-nums">{artifacts.length}</span>
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Artifacts</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          {artifacts.map((artifact) => (
            <DropdownMenuItem
              key={artifact.id}
              render={
                <a
                  href={artifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={artifact.url}
                />
              }
            >
              <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
              <ExternalLinkIcon aria-hidden className="text-ink-3" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
