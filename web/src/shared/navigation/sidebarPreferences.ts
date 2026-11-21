export type GroupBy = "folder" | "project" | "date";
export type SortBy = "name" | "recent";
export interface SidebarView {
  groupBy: GroupBy;
  sortBy: SortBy;
  folderAndBranch: boolean;
}
export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
  groupBy: "date",
  sortBy: "recent",
  folderAndBranch: false,
};
export const GROUP_BY: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "date", label: "Date" },
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
];
export const SORT_BY: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: "recent", label: "Activity" },
  { value: "name", label: "Name" },
];
