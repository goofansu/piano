import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createSignInAttempt,
  type SignInApi,
  type SignInAttempt,
  type SignInAttemptState,
} from "./signInAttempt.ts";

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
