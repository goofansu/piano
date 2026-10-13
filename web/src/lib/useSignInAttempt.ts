import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createSignInAttempt,
  type SignInApi,
  type SignInAttempt,
  type SignInAttemptState,
} from "./signInAttempt.ts";

/**
 * One sign-in attempt for a dialog, opened and polled while mounted. `api` and `provider` are
 * fixed for the dialog's lifetime (callers key it per attempt); `signedIn` and `close` may change
 * between renders.
 */
export function useSignInAttempt({
  api,
  provider,
  signedIn,
  close,
}: {
  api: SignInApi;
  provider: string;
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
  useEffect(() => attempt.start(), [attempt]);
  const state = useSyncExternalStore(attempt.subscribe, attempt.getState);
  return { ...attempt, ...state };
}
