export interface SettingsLoadInput<T> {
  value: T | undefined;
  error: string | undefined;
  loading: boolean;
  isEmpty?: (value: T) => boolean;
}

export type SettingsLoadView<T> = {
  failure: boolean;
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
