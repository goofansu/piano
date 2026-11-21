import type { OAuthProvider, ServerMessage } from "@shared/wire";
import {
  createObservation,
  type ObservationEnvironment,
  type ObservationState,
} from "../../../web/src/shared/lib/observation.ts";

export type ProviderAccountsState = ObservationState<readonly OAuthProvider[]>;

export interface ProviderAccountsSource {
  getState: () => { connected: boolean };
  subscribe: (listener: () => void) => () => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export interface ProviderAccountsOptions {
  load: (signal: AbortSignal) => Promise<readonly OAuthProvider[]>;
  logout: (provider: string) => Promise<void>;
  environment?: ObservationEnvironment;
}

export interface ProviderAccounts {
  getState: () => ProviderAccountsState;
  subscribe: (listener: () => void) => () => void;
  follow: (source: ProviderAccountsSource) => () => void;
  refresh: () => Promise<readonly OAuthProvider[] | undefined>;
  signedIn: () => Promise<readonly OAuthProvider[] | undefined>;
  signOut: (provider: string) => Promise<readonly OAuthProvider[] | undefined>;
}

const KEY = "provider-accounts";
const POLL_MS = 30_000;

export function createProviderAccounts({
  load,
  logout,
  environment,
}: ProviderAccountsOptions): ProviderAccounts {
  const observation = createObservation<readonly OAuthProvider[]>({
    load: (signal) => load(signal),
    interval: () => POLL_MS,
    focus: true,
    environment,
  });
  return {
    getState: observation.getState,
    subscribe: observation.subscribe,
    follow: (source) => {
      const stop = observation.start();
      const connection = () => observation.observe(KEY, source.getState().connected);
      connection();
      const unsubscribe = source.subscribe(connection);
      const unlisten = source.listen((message) => {
        if (message._tag === "catalogs_invalidated") observation.refreshSoon(0);
      });
      return () => {
        unlisten();
        unsubscribe();
        stop();
      };
    },
    refresh: observation.refresh,
    signedIn: () => observation.mutate((signal) => load(signal)),
    signOut: (provider) =>
      observation.mutate(async (signal, previous) => {
        await logout(provider);
        return load(signal).catch(() =>
          previous?.map((account) =>
            account.id === provider ? { ...account, signedIn: false } : account,
          ),
        );
      }),
  };
}
