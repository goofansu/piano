import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { createPreference } from "../../../../web/src/shared/lib/preference.ts";
import { listDirectory, makeDirectory } from "./folderApi.ts";
import {
  createFolderBrowser,
  type FolderBrowser,
  type FolderBrowserState,
} from "./folderBrowser.ts";

const lastPicked = createPreference<string>({
  key: "piano.pickerPath",
  decode: (raw) => raw ?? "",
  encode: (path) => path,
});

export function useFolderBrowser(
  open: boolean,
  initialPath: string | undefined,
): FolderBrowser & FolderBrowserState {
  const [browser] = useState(() =>
    createFolderBrowser({
      list: listDirectory,
      mkdir: makeDirectory,
      lastPicked,
      notify: { error: (message) => toast.error(message) },
    }),
  );
  useEffect(() => browser.start(), [browser]);
  useEffect(
    () => (open ? browser.open(initialPath) : browser.close()),
    [browser, open, initialPath],
  );
  const state = useSyncExternalStore(browser.subscribe, browser.getState);
  return { ...browser, ...state };
}
