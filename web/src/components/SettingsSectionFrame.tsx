import { type LucideIcon, PlugIcon, RadiusIcon, ServerIcon } from "lucide-react";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SettingsSectionIconName } from "@/lib/routes";

const ICONS: Record<SettingsSectionIconName, LucideIcon> = {
  plug: PlugIcon,
  radius: RadiusIcon,
  server: ServerIcon,
};

/** A Settings section's icon, as navigation and the command palette show it. */
export function SettingsSectionIcon({ icon }: { icon: SettingsSectionIconName }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

/**
 * One Settings section: the header with its actions, a scrolling column of content, and the
 * section's dialogs.
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
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
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
