/**
 * The page's one live read of which OAuth providers Pi is signed in to. Settings, Radius and the
 * Share command all show this value, so they never disagree. It reads while the socket is
 * connected: on (re)connect, on focus, every 30 seconds, and whenever the server invalidates
 * catalogs, which it does after any sign-in or sign-out, including another tab's or Pi's own.
 * A sign-in or sign-out made here is a mutation, so a read that started before it cannot
 * overwrite its result. Nothing here depends on React.
 */
import type { OAuthProvider, ServerMessage } from "@shared/wire";
import {
  createObservation,
  type ObservationEnvironment,
  type ObservationState,
} from "./observation.ts";

export type ProviderAccountsState = ObservationState<readonly OAuthProvider[]>;

/** The connection to follow; the page's `Client` is one. */
export interface ProviderAccountsSource {
  getState: () => { connected: boolean };
  subscribe: (listener: () => void) => () => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export interface ProviderAccountsOptions {
  load: (signal: AbortSignal) => Promise<readonly OAuthProvider[]>;
  /** Resolves once Pi has removed the provider's credentials. */
  logout: (provider: string) => Promise<void>;
  environment?: ObservationEnvironment;
}

export interface ProviderAccounts {
  getState: () => ProviderAccountsState;
  subscribe: (listener: () => void) => () => void;
  /** Reads while `source` is connected; returns the stop function. */
  follow: (source: ProviderAccountsSource) => () => void;
  refresh: () => Promise<readonly OAuthProvider[] | undefined>;
  /** Reads the result of a sign-in that just succeeded. */
  signedIn: () => Promise<readonly OAuthProvider[] | undefined>;
  /** Signs out of `provider`, then reads the result; rejects if Pi did not sign out. */
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
      // Becoming connected again reads afresh; while disconnected the last value stays.
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
        // Pi confirmed the sign-out, so a failed read still knows this much.
        return load(signal).catch(() =>
          previous?.map((account) =>
            account.id === provider ? { ...account, signedIn: false } : account,
          ),
        );
      }),
  };
}

/** Whether Share can publish: connected, read and signed in to Radius; no MCP or model gate. */
export const signedInToRadius = (state: ProviderAccountsState, connected: boolean) =>
  connected &&
  !state.error &&
  !!state.value?.some((provider) => provider.id === "radius" && provider.signedIn);
