import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

/** A status line in the file viewer's body: opening, a refusal or a decoder failure. */
export function FileNotice({ children }: { children: React.ReactNode }) {
  return (
    <Empty className="py-16" role="status">
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
