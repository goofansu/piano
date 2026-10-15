import { cn } from "cn";
import type { ComponentProps } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  Command as BaseCommand,
  CommandInput as BaseInput,
  CommandItem as BaseItem,
} from "@/components/ui/command";

export {
  CommandEmpty,
  CommandGroup,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

export function Command({ className, ...props }: ComponentProps<typeof BaseCommand>) {
  return (
    <BaseCommand
      {...props}
      className={cn(
        "[--command-row-height:2.25rem] pointer-coarse:[--command-row-height:2.75rem] **:data-[slot=input-group]:h-(--command-row-height)!",
        className,
      )}
    />
  );
}

export function CommandInput({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return <BaseInput {...props} className={cn("h-full py-0", className)} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof BaseItem>) {
  return (
    <BaseItem
      {...props}
      className={cn(
        "min-h-(--command-row-height) rounded-md transition-colors duration-(--dur-hover)",
        className,
      )}
    />
  );
}

/** Compose the dialog so it uses Piano's surfaces and equal input/item heights, not an upstream private Command. */
export function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  filter,
  ...props
}: ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  filter?: ComponentProps<typeof Command>["filter"];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          filter={filter}
          className="[--command-row-height:3rem] pointer-coarse:[--command-row-height:3rem] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-item]]:px-2 [&_[cmdk-item]>svg]:size-5"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
