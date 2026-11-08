import { cn } from "cn";
import {
  AlertCircleIcon,
  ExternalLinkIcon,
  type LucideIcon,
  PlugIcon,
  RadiusIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareSlashIcon,
  WebhookIcon,
} from "lucide-react";
import { PaneBody, PaneHeader } from "@/components/Pane";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { SettingsSectionIconName } from "@/lib/routes";
import type { SettingsLoadView } from "@/lib/settingsLoadView";

const ICONS: Record<SettingsSectionIconName, LucideIcon> = {
  plug: PlugIcon,
  radius: RadiusIcon,
  server: ServerIcon,
  skill: SparklesIcon,
  prompt: SquareSlashIcon,
  webhook: WebhookIcon,
  preferences: SlidersHorizontalIcon,
};

/** A Settings section's icon, as navigation and the command palette show it. */
export function SettingsSectionIcon({
  icon,
  ...props
}: {
  icon: SettingsSectionIconName;
  /** A Button's leading or trailing icon, which sets its padding. */
  "data-icon"?: "inline-start" | "inline-end";
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
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
      <PaneHeader actions={actions}>
        <h1 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h1>
      </PaneHeader>
      <PaneBody>
        <section
          id={sectionId}
          aria-labelledby={titleId}
          className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6"
        >
          {children}
        </section>
      </PaneBody>
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
 * lists are. Rows are `Item`s with `settingsRow`. Each row's hairline is its own bottom border:
 * `Item` draws a transparent border on every side, which a `divide-*` colour cannot win against.
 */
export function SettingsList({
  className,
  ...props
}: React.ComponentProps<"div"> & { children: React.ReactNode }) {
  return (
    // Its rows are shadcn Items (divs), which a <ul> cannot hold; the role names the list.
    <div
      role="list"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-line",
        "*:border-x-0 *:border-t-0 *:border-b *:border-b-line *:last:border-b-0",
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

/**
 * A section whose facts could not be read: what failed, and Retry, which turns while a read is in
 * flight. A failed first read shows it in place of the loading placeholder, a failed re-read above
 * the rows already read (see `settingsLoadView`); a change's failure is a toast instead.
 */
export function SettingsLoadFailure({
  title,
  retrying,
  retry,
}: {
  /** "Could not load …", naming what the section lists. */
  title: string;
  retrying: boolean;
  retry: () => void;
}) {
  return (
    <Alert
      variant="destructive"
      className="flex items-center gap-2.5 [&>svg]:shrink-0 [&>svg]:translate-y-0"
    >
      <AlertCircleIcon />
      <AlertTitle className="min-w-0 flex-1">{title}</AlertTitle>
      {/* Keep Retry in flow so its height and busy width contribute to the alert's layout. */}
      <Button variant="outline" size="sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
        {retrying && <Spinner data-icon="inline-start" />}
        Retry
      </Button>
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
 * A section's load as `settingsLoadView` decides it: placeholder rows, the failure with Retry,
 * the empty line, or the rows `children` draws from the value read, below the failure when a
 * re-read failed. `noun` names what the section lists ("webhooks") in all three lines.
 */
export function SettingsLoadState<T>({
  view,
  noun,
  retry,
  skeletonRows = 2,
  emptyIcon: EmptyIcon,
  children,
}: {
  view: SettingsLoadView<T>;
  noun: string;
  retry: () => void;
  skeletonRows?: number;
  /** The section's icon on its empty line; needed only where the value can list nothing. */
  emptyIcon?: LucideIcon;
  children: (value: T) => React.ReactNode;
}) {
  return (
    <>
      {view.failure && (
        <SettingsLoadFailure
          title={`Could not load ${noun}`}
          retrying={view.retrying}
          retry={retry}
        />
      )}
      {view.body === "loading" ? (
        <SettingsSkeleton label={`Loading ${noun}…`} className="flex flex-col gap-2">
          {Array.from({ length: skeletonRows }, (_, row) => (
            <Skeleton key={row} className="h-14 w-full rounded-lg" />
          ))}
        </SettingsSkeleton>
      ) : view.body === "empty" ? (
        <Empty className="py-8">
          <EmptyHeader>
            {EmptyIcon && (
              <EmptyMedia variant="icon">
                <EmptyIcon />
              </EmptyMedia>
            )}
            <EmptyTitle>{`No ${noun} yet`}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : view.body === "rows" ? (
        children(view.value)
      ) : null}
    </>
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
