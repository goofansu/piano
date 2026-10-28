import { createPreference, parseJson } from "@/lib/preference";
import { DEFAULT_SIDEBAR_VIEW, GROUP_BY, type SidebarView, SORT_BY } from "@/lib/sidebarView";
import { usePreference } from "@/lib/usePreference";

const choose = <T extends string>(
  choices: ReadonlyArray<{ value: T }>,
  stored: unknown,
  fallback: T,
): T => choices.find((choice) => choice.value === stored)?.value ?? fallback;

/** Remembered like the sidebar's open groups: per browser. A missing or unknown field keeps its default. */
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

/** The sidebar's grouping, sort and row details, shared by every sidebar instance and the command palette. */
export function useSidebarView() {
  const [view] = usePreference(sidebarView);
  return { view, setView };
}
