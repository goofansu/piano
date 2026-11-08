/**
 * How a Settings page shows its load, one policy for every page: a failed first read shows the
 * failure in place of the loading placeholder; a failed re-read keeps what was read, usable, with
 * the failure above it, since the rows are still the last facts known and a change answers for
 * itself. The failure stays while Retry reads again, so it never flickers back to the placeholder.
 * Pure; `SettingsLoadState` renders it.
 */

export interface SettingsLoadInput<T> {
  /** The last value read; absent until the first read succeeds. */
  value: T | undefined;
  /** The last read's failure, kept while a re-read is in flight. */
  error: string | undefined;
  /** A read is in flight. */
  loading: boolean;
  /** Whether the value lists nothing; a page that is never empty leaves it out. */
  isEmpty?: (value: T) => boolean;
}

export type SettingsLoadView<T> = {
  /** Show the failure with Retry: in place of the placeholder, or above what was read. */
  failure: boolean;
  /** Retry is reading again. */
  retrying: boolean;
} & ({ body: "failure" | "loading" } | { body: "empty"; value: T } | { body: "rows"; value: T });

export function settingsLoadView<T>({
  value,
  error,
  loading,
  isEmpty,
}: SettingsLoadInput<T>): SettingsLoadView<T> {
  const failure = error !== undefined;
  const retrying = failure && loading;
  if (value === undefined) return { body: failure ? "failure" : "loading", failure, retrying };
  return { body: isEmpty?.(value) ? "empty" : "rows", value, failure, retrying };
}
