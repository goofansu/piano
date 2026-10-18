/**
 * The Radius section's sequencing: one live read of Pi's setup, polled while a web-search change
 * runs; the page's provider accounts beside it; one setup change at a time; and the toasts those
 * earn. A refresh the user asks for keeps the refresh icon turning for at least one turn and says
 * so once it lands, unless a web-search change will announce itself. Completing setup is announced
 * when the section settles, outranking the install that completed it. The section only renders
 * the state and calls these methods. Nothing here depends on React.
 */
import type { RadiusSetupAction, RadiusSetupState } from "@shared/radius";
import type { OAuthProvider } from "@shared/wire";
import {
  browserEnvironment,
  createObservation,
  type ObservationEnvironment,
} from "./observation.ts";
import type { ProviderAccounts } from "./providerAccounts.ts";
import {
  RADIUS_PROGRESS,
  type RadiusObservation,
  radiusAnnouncements,
} from "./radiusAnnouncements.ts";
import {
  type RadiusSetupView,
  type RadiusUninstall,
  radiusDoneMessage,
  radiusSetupView,
} from "./radiusSetupView.ts";
import { createSetupActions, type SetupActionsState } from "./setupActions.ts";

export type RadiusConfirmation = { kind: "sign-out" } | { kind: RadiusUninstall; key: string };

/** Reads Pi's setup, or changes it and returns the result. */
export type RadiusSetupApi = (
  change?: { action: RadiusSetupAction; removalKey?: string },
  options?: { signal?: AbortSignal },
) => Promise<RadiusSetupState>;

export interface RadiusSetupOptions {
  api: RadiusSetupApi;
  /** The page's shared provider accounts; Radius signs in and out through them. */
  accounts: Pick<ProviderAccounts, "getState" | "subscribe" | "refresh" | "signedIn" | "signOut">;
  /** Shows a success toast; `id` replaces the toast that shares it. */
  toast: (message: string, options?: { id: string }) => void;
  environment?: ObservationEnvironment;
  newKey?: () => string;
}

export interface RadiusSetupSnapshot
  extends Pick<SetupActionsState<RadiusConfirmation, string>, "confirmation" | "signIn"> {
  /** Both Pi's setup and the accounts have been read once; until then the section is a skeleton. */
  loaded: boolean;
  /** A read of the setup is in flight, or the first reads have not finished. */
  refreshing: boolean;
  providers: readonly OAuthProvider[];
  view: RadiusSetupView;
}

export interface RadiusSetup {
  getState: () => RadiusSetupSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads and follows changes; returns the stop function, which aborts reads. */
  start: () => () => void;
  /** Re-reads the accounts and the setup. */
  refresh: () => Promise<unknown>;
  /** The user's refresh: clears the last failure, spins at least one turn and confirms it landed. */
  refreshByHand: () => void;
  act: (action: RadiusSetupAction, removalKey?: string) => Promise<unknown>;
  signOut: () => Promise<unknown>;
  confirm: (confirmation: RadiusConfirmation) => void;
  /** Runs the removal being confirmed; does nothing once its dialog has closed. */
  confirmRemoval: () => void;
  cancel: () => void;
  openSignIn: () => void;
  /** Closes the sign-in dialog and re-reads, whether or not it signed in. */
  closeSignIn: () => void;
  /** Reads the result of a sign-in that just succeeded. */
  signedIn: () => void;
}

/** One turn of the refresh icon, so a fast refresh still reads as a refresh instead of a flicker. */
export const REFRESH_SPIN_MS = 600;
/** Setup toasts share an id, so finishing setup replaces the step's toast instead of stacking. */
export const SETUP_TOAST = "radius-setup";
export const INSTALL_POLL_MS = 1500;
const KEY = "radius";

export function createRadiusSetup({
  api,
  accounts,
  toast,
  environment = browserEnvironment,
  newKey,
}: RadiusSetupOptions): RadiusSetup {
  let manual = false;
  let progress = RADIUS_PROGRESS;
  const announce = (observation: RadiusObservation) => {
    const next = radiusAnnouncements(progress, observation);
    progress = next.progress;
    if (next.message) toast(next.message, { id: SETUP_TOAST });
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      environment.setTimeout(resolve, ms);
    });

  const setup = createObservation<RadiusSetupState>({
    load: async (signal) => {
      const byHand = manual;
      manual = false;
      const [next] = await Promise.all([
        api(undefined, { signal }),
        byHand && wait(REFRESH_SPIN_MS),
      ]);
      if (signal.aborted) throw signal.reason;
      announce({ kind: "observed", installation: next.installation, manual: byHand });
      return next;
    },
    // A running web-search change is polled until it settles.
    interval: (value) => (value?.installation.status === "running" ? INSTALL_POLL_MS : undefined),
    environment,
  });

  const refresh = () => {
    void accounts.refresh();
    return setup.refresh();
  };
  // Signing in or out changes the usable models; the server invalidates every catalog itself.
  const actions = createSetupActions<RadiusConfirmation, string>({
    refresh: () => void refresh(),
    success: (text, id) => toast(text, id === "sign-out" ? undefined : { id: SETUP_TOAST }),
    newKey,
  });

  const listeners = new Set<() => void>();
  let sources: unknown[] = [];
  let snapshot: RadiusSetupSnapshot;
  const compute = (): RadiusSetupSnapshot => {
    const observed = setup.getState(),
      account = accounts.getState(),
      changes = actions.getState();
    // The account is the page's shared read; its background re-reads do not lock the steps.
    const refreshing =
      observed.loading ||
      (!observed.value && !observed.error) ||
      (!account.value && !account.error);
    const providers = account.value ?? [];
    return {
      loaded: !!observed.value && !!account.value,
      refreshing,
      providers,
      confirmation: changes.confirmation,
      signIn: changes.signIn,
      view: radiusSetupView({
        state: observed.value,
        providers,
        running: changes.running,
        refreshing,
        loadFailed: !!observed.failure || !!account.failure,
        actionError: changes.error,
      }),
    };
  };
  const update = () => {
    const next = [setup.getState(), accounts.getState(), actions.getState()];
    if (next.every((source, i) => source === sources[i])) return;
    sources = next;
    const previous = snapshot?.view;
    snapshot = compute();
    const { settled, configured } = snapshot.view;
    // Announce completion only when setup turns complete here, not each time a complete setup is opened.
    if (settled && (!previous?.settled || previous.configured !== configured))
      announce({ kind: "settled", configured });
    for (const listener of listeners) listener();
  };
  update();

  const act = (action: RadiusSetupAction, removalKey?: string) =>
    actions.run({
      id: action,
      run: () =>
        setup.mutate(async () => {
          const next = await api({ action, removalKey });
          announce({ kind: "observed", installation: next.installation });
          return next;
        }),
      done: radiusDoneMessage(action),
      fallback: "Could not complete setup. Refresh before retrying.",
    });

  return {
    getState: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const unsubscribe = [setup, accounts, actions].map((source) => source.subscribe(update));
      const stop = setup.start();
      setup.observe(KEY);
      update();
      return () => {
        stop();
        for (const off of unsubscribe) off();
      };
    },
    refresh,
    refreshByHand: () => {
      actions.clearError();
      manual = true;
      void refresh();
    },
    act,
    // Only acknowledge sign-out after Pi confirms credential removal.
    signOut: () =>
      actions.run({
        id: "sign-out",
        run: () => accounts.signOut("radius"),
        done: "Signed out of Radius.",
        fallback: "Could not sign out. Try again.",
      }),
    confirm: actions.confirm,
    confirmRemoval: () => {
      const { confirmation } = actions.getState();
      if (confirmation && confirmation.kind !== "sign-out")
        void act(confirmation.kind, confirmation.key);
    },
    cancel: actions.cancel,
    openSignIn: () => actions.openSignIn("radius"),
    closeSignIn: () => {
      actions.closeSignIn();
      void refresh();
    },
    signedIn: () => {
      void accounts.signedIn();
      void setup.refresh();
    },
  };
}
