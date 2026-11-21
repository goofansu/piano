import { createPreference, parseJson } from "@/shared/lib/preference";
import { usePreference } from "@/shared/lib/usePreference";
import {
  DEFAULT_SIDEBAR_VIEW,
  GROUP_BY,
  type SidebarView,
  SORT_BY,
} from "@/shared/navigation/sidebarPreferences";

const choose = <T extends string>(
  choices: ReadonlyArray<{ value: T }>,
  stored: unknown,
  fallback: T,
): T => choices.find((choice) => choice.value === stored)?.value ?? fallback;

const sidebarView = createPreference<SidebarView>({
  key: "piano.sidebarView",
  decode: (raw) => {
    const stored = parseJson(raw);
    const fields: Record<string, unknown> =
      typeof stored === "object" && stored !== null ? { ...stored } : {};
    return {
      groupBy: choose(GROUP_BY, fields.groupBy, DEFAULT_SIDEBAR_VIEW.groupBy),
      sortBy: choose(SORT_BY, fields.sortBy, DEFAULT_SIDEBAR_VIEW.sortBy),
      folderAndBranch:
        typeof fields.folderAndBranch === "boolean"
          ? fields.folderAndBranch
          : DEFAULT_SIDEBAR_VIEW.folderAndBranch,
    };
  },
  encode: ({ groupBy, sortBy, folderAndBranch }) =>
    JSON.stringify({ groupBy, sortBy, folderAndBranch }),
});
const setView = (change: Partial<SidebarView>) =>
  sidebarView.set({ ...sidebarView.get(), ...change });

export function useSidebarView() {
  const [view] = usePreference(sidebarView);
  return { view, setView };
}
