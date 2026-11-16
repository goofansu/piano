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

export type RadiusSetupApi = (
  change?: { action: RadiusSetupAction; removalKey?: string },
  options?: { signal?: AbortSignal },
) => Promise<RadiusSetupState>;

export interface RadiusSetupOptions {
  api: RadiusSetupApi;
  accounts: Pick<ProviderAccounts, "getState" | "subscribe" | "refresh" | "signedIn" | "signOut">;
  toast: (message: string, options?: { id: string }) => void;
  failure?: (message: string) => void;
  environment?: ObservationEnvironment;
  newKey?: () => string;
}

export interface RadiusSetupSnapshot extends Pick<
  SetupActionsState<RadiusConfirmation, string>,
  "confirmation" | "signIn"
> {
  loaded: boolean;
  refreshing: boolean;
  providers: readonly OAuthProvider[];
  view: RadiusSetupView;
}

export interface RadiusSetup {
  getState: () => RadiusSetupSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  refresh: () => Promise<unknown>;
  refreshByHand: () => void;
  act: (action: RadiusSetupAction, removalKey?: string) => Promise<unknown>;
  signOut: () => Promise<unknown>;
  confirm: (confirmation: RadiusConfirmation) => void;
  confirmRemoval: () => void;
  cancel: () => void;
  openSignIn: () => void;
  closeSignIn: () => void;
  signedIn: () => void;
}

export const REFRESH_SPIN_MS = 600;
export const SETUP_TOAST = "radius-setup";
export const INSTALL_POLL_MS = 1500;
const KEY = "radius";

export function createRadiusSetup({
  api,
  accounts,
  toast,
  failure,
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
    interval: (value) => (value?.installation.status === "running" ? INSTALL_POLL_MS : undefined),
    environment,
  });

  const refresh = () => {
    void accounts.refresh();
    return setup.refresh();
  };
  const actions = createSetupActions<RadiusConfirmation, string>({
    refresh: () => void refresh(),
    success: (text, id) => toast(text, id === "sign-out" ? undefined : { id: SETUP_TOAST }),
    failure,
    newKey,
  });

  const listeners = new Set<() => void>();
  let sources: unknown[] = [];
  let snapshot: RadiusSetupSnapshot;
  const compute = (): RadiusSetupSnapshot => {
    const observed = setup.getState(),
      account = accounts.getState(),
      changes = actions.getState();
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
      fallback: "Could not complete setup.",
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
      manual = true;
      void refresh();
    },
    act,
    signOut: () =>
      actions.run({
        id: "sign-out",
        run: () => accounts.signOut("radius"),
        done: "Signed out of Radius",
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
