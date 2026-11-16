import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

export function FileNotice({ children }: { children: React.ReactNode }) {
  return (
    <Empty className="py-16" role="status">
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
