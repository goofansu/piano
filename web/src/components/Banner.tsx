import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** The folded part of a notice: the title says what happened, this says why, on request. */
export function AlertDetails({ label = "Details", children }: { label?: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0">{label}</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A notice above the transcript: it slides in, and its details fold out on request. */
export function Banner({ variant, title, action, children }: { variant: "destructive" | "warning"; title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant={variant} className="mx-4 mt-3 w-auto animate-in fade-in-0 slide-in-from-top-1 md:mx-6">
      <AlertTitle className="flex items-center gap-2">{title}{action}</AlertTitle>
      {children && (
        <AlertDescription>
          <AlertDetails>{children}</AlertDetails>
        </AlertDescription>
      )}
    </Alert>
  );
}
