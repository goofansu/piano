import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createSignInAttempt,
  type SignInApi,
  type SignInAttempt,
  type SignInAttemptState,
} from "./signInAttempt.ts";

/**
 * One sign-in attempt for a dialog, opened when it mounts and polled while `open`; closing stops
 * polling and keeps the attempt. `api` and `provider` are fixed for the dialog's lifetime
 * (`ProviderLoginDialog` keys it per opening); `signedIn` and `close` may change between renders.
 */
export function useSignInAttempt({
  api,
  provider,
  open,
  signedIn,
  close,
}: {
  api: SignInApi;
  provider: string;
  open: boolean;
  signedIn: () => void;
  close: () => void;
}): SignInAttempt & SignInAttemptState {
  const latest = useRef({ signedIn, close });
  latest.current = { signedIn, close };
  const [attempt] = useState(() =>
    createSignInAttempt({
      api,
      provider,
      signedIn: () => latest.current.signedIn(),
      close: () => latest.current.close(),
    }),
  );
  useEffect(() => (open ? attempt.start() : undefined), [attempt, open]);
  const state = useSyncExternalStore(attempt.subscribe, attempt.getState);
  return { ...attempt, ...state };
}
