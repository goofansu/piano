import { cn } from "cn";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { isMac, keys } from "@/lib/keys";

/** A keyboard hint. On a Mac the symbols sit together in one key cap, as the menu bar writes them. */
export function Shortcut({ of, className, ...props }: { of: string[]; className?: string } & React.HTMLAttributes<HTMLElement>) {
  const labels = keys(...of);
  if (isMac) return <Kbd className={className} {...props}>{labels.join("")}</Kbd>;
  return (
    <KbdGroup className={className} {...props}>
      {labels.map((label) => <Kbd key={label}>{label}</Kbd>)}
    </KbdGroup>
  );
}

/** A tooltip line with its shortcut at the end. */
export function Hint({ children, of, className }: { children: React.ReactNode; of: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {children}
      <Shortcut of={of} />
    </span>
  );
}
