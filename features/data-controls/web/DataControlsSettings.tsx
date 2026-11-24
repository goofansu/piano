import { archiveConfirmation, createDataControls } from "@features/data-controls/web/dataControls";
import { ArchiveIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemDescription } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { PianoButton } from "@/shared/components/PianoButton";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { ListRow } from "@/shared/components/RowActions";
import {
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
} from "@/shared/components/SettingsSectionFrame";
import { toastNotify } from "@/shared/lib/toastNotify";
import type { Client } from "@/shared/state/client";
import { archivedSessionCatalog } from "@/shared/state/sessionCatalog";
import { type AppState, sessionKey } from "@/shared/state/state";

export function DataControlsSettings({ state, client }: { state: AppState; client: Client }) {
  const [controls] = useState(() => createDataControls({ client, notify: toastNotify }));
  useEffect(() => controls.start(), [controls]);
  const operation = useSyncExternalStore(controls.subscribe, controls.getState);
  const confirmation = archiveConfirmation(operation, state.connected);
  const busy = operation.request !== undefined;
  const archived = archivedSessionCatalog(state);
  return (
    <SettingsSectionFrame
      section="data-controls"
      dialogs={
        <RemovalDialog
          {...confirmation}
          description="Running and pinned sessions are kept. Transcripts are kept."
          action="Archive all"
          destructive={false}
          cancel={controls.cancel}
          confirm={controls.archive}
        />
      }
    >
      <SettingsGroup id="data-controls-sessions" title="Sessions">
        <SettingsList>
          <ListRow
            title="Archive all sessions"
            actions={
              <PianoButton
                variant="outline"
                size="sm"
                disabled={!state.connected || busy}
                onClick={controls.open}
              >
                {operation.request?.kind === "count" && <Spinner data-icon="inline-start" />}
                Archive all
              </PianoButton>
            }
          />
        </SettingsList>
        {operation.countFailed && (
          <SettingsLoadFailure
            title="Could not load session count"
            retrying={operation.request?.kind === "count"}
            retry={controls.open}
          />
        )}
      </SettingsGroup>
      <SettingsGroup id="data-controls-archived" title="Archived sessions">
        {archived.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArchiveIcon />
              </EmptyMedia>
              <EmptyTitle>No archived sessions yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <SettingsList>
            {archived.map((session) => {
              const pending =
                operation.request?.kind === "unarchive" &&
                sessionKey(operation.request) === sessionKey(session);
              return (
                <ListRow
                  key={sessionKey(session)}
                  title={session.label}
                  titleClassName="block w-full min-w-0 line-clamp-none wrap-anywhere"
                  actions={
                    <PianoButton
                      variant="outline"
                      size="sm"
                      disabled={!state.connected || busy}
                      onClick={() => controls.unarchive(session)}
                    >
                      {pending && <Spinner data-icon="inline-start" />}
                      Unarchive
                    </PianoButton>
                  }
                >
                  <ItemDescription
                    className="truncate text-xs"
                    title={session.folderPath ?? session.cwd}
                  >
                    {session.folder}
                  </ItemDescription>
                </ListRow>
              );
            })}
          </SettingsList>
        )}
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
