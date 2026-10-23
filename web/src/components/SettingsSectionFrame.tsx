import { cn } from "cn";
import {
  ExternalLinkIcon,
  type LucideIcon,
  PlugIcon,
  RadiusIcon,
  ServerIcon,
  WebhookIcon,
} from "lucide-react";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SettingsSectionIconName } from "@/lib/routes";

const ICONS: Record<SettingsSectionIconName, LucideIcon> = {
  plug: PlugIcon,
  radius: RadiusIcon,
  server: ServerIcon,
  webhook: WebhookIcon,
};

/** A Settings section's icon, as navigation and the command palette show it. */
export function SettingsSectionIcon({ icon }: { icon: SettingsSectionIconName }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

/**
 * One Settings page: the header with its actions, a scrolling column of content, and the page's
 * dialogs. No intro line: the rows say what the page does.
 */
export function SettingsSectionFrame({
  title,
  titleId = "settings-section-title",
  sectionId,
  actions,
  dialogs,
  children,
}: {
  title: string;
  titleId?: string;
  sectionId?: string;
  actions?: React.ReactNode;
  dialogs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <SettingsHeader title={title} titleId={titleId}>
        {actions}
      </SettingsHeader>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <section
          id={sectionId}
          aria-labelledby={titleId}
          className="mx-auto flex max-w-2xl flex-col gap-6"
        >
          {children}
        </section>
      </div>
      {dialogs}
    </section>
  );
}

/** A titled group on a Settings page: its name and its rows. */
export function SettingsGroup({
  id,
  title,
  actions,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
  /** A control at the title's end, such as Refresh. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cn("flex flex-col gap-3", className)}>
      <div className="flex min-h-8 items-center gap-2">
        <h2
          id={`${id}-title`}
          className="flex min-w-0 flex-1 items-center gap-2 text-base font-medium"
        >
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Rows in one bordered list, split by hairlines rather than spaced as cards, as Linear's settings
 * lists are. Rows are `Item`s with `settingsRow`.
 */
export function SettingsList({
  className,
  ...props
}: React.ComponentProps<"div"> & { children: React.ReactNode }) {
  return (
    // Its rows are shadcn Items (divs), which a <ul> cannot hold; the role names the list.
    // biome-ignore lint/a11y/useSemanticElements: see above.
    <div
      role="list"
      className={cn(
        "flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line",
        className,
      )}
      {...props}
    />
  );
}

/** The classes an `Item` takes to sit in a `SettingsList`. */
export const settingsRow = "flex-nowrap rounded-none px-4 py-3";

/** A section's problem the user can act on. */
export function SettingsAlert({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Alert variant="destructive">
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Placeholder rows while a section's facts load; screen readers hear `label`. */
export function SettingsSkeleton({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * An outgoing link in Settings: opens in a new tab and always carries the external-link icon, so
 * leaving Piano is visible before the click. Pass `className` for color; size and weight inherit.
 */
export function SettingsExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 underline-offset-4 hover:underline", className)}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
