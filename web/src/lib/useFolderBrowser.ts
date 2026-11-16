import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { listDirectory, makeDirectory } from "./api.ts";
import {
  createFolderBrowser,
  type FolderBrowser,
  type FolderBrowserState,
} from "./folderBrowser.ts";
import { createPreference } from "./preference.ts";

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
