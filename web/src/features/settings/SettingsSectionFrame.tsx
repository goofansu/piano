import { cn } from "cn";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ExternalLinkIcon,
  type LucideIcon,
  PlugIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareSlashIcon,
  WebhookIcon,
} from "lucide-react";
import { Children, isValidElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionIconName,
} from "@/features/navigation/routes";
import type { SettingsLoadView } from "@/features/settings/settingsLoadView";
import { PaneBody, PaneHeader } from "@/shared/components/Pane";

const ICONS: Record<SettingsSectionIconName, LucideIcon> = {
  plug: PlugIcon,
  server: ServerIcon,
  skill: SparklesIcon,
  prompt: SquareSlashIcon,
  webhook: WebhookIcon,
  preferences: SlidersHorizontalIcon,
  archive: ArchiveIcon,
};

export function SettingsSectionIcon({
  icon,
  ...props
}: {
  icon: SettingsSectionIconName;
  "data-icon"?: "inline-start" | "inline-end";
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}

export function SettingsSectionFrame({
  section,
  actions,
  dialogs,
  children,
}: {
  section: SettingsSection;
  actions?: React.ReactNode;
  dialogs?: React.ReactNode;
  children: React.ReactNode;
}) {
  const title = SETTINGS_SECTIONS.find((s) => s.id === section)?.label;
  const titleId = `settings-${section}-title`;
  return (
    <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader actions={actions}>
        <h1 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h1>
      </PaneHeader>
      <PaneBody>
        <section
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

export function SettingsGroup({
  id,
  title,
  actions,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
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

export function SettingsList({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { children: React.ReactNode }) {
  return (
    <div
      role="list"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-line",
        "*:border-b *:border-b-line *:last:border-b-0 *:*:border-0",
        className,
      )}
      {...props}
    >
      {Children.toArray(children).map((row) => (
        <div role="listitem" key={isValidElement(row) ? row.key : undefined}>
          {row}
        </div>
      ))}
    </div>
  );
}

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

export function SettingsLoadFailure({
  title,
  retrying,
  retry,
}: {
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
      <Button variant="outline" size="sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
        {retrying && <Spinner data-icon="inline-start" />}
        Retry
      </Button>
    </Alert>
  );
}

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
