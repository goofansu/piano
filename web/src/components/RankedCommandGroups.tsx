import { defaultFilter } from "cmdk";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { CommandSeparator } from "@/components/ui/command";

/** cmdk 1.1.1 leaves our groups in declaration order. Rank them by their best item,
 * using cmdk's own scores; cmdk still filters and orders the items within each group. */
export function RankedCommandGroups({ search, children }: { search: string; children: ReactNode }) {
  function score(node: ReactNode): number {
    if (!isValidElement<{ value?: string; keywords?: string[]; children?: ReactNode }>(node))
      return 0;
    if (typeof node.props.value === "string")
      return defaultFilter(node.props.value, search, node.props.keywords);
    return Math.max(0, ...Children.toArray(node.props.children).map(score));
  }
  const groups = Children.toArray(children).filter(isValidElement);
  if (search) groups.sort((a, b) => score(b) - score(a));
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 && <CommandSeparator />}
          {group}
        </Fragment>
      ))}
    </>
  );
}
