import { Spinner } from "@/components/ui/spinner";

export function ConnectionStatus() {
  return (
    <div
      role="status"
      aria-label="Connection"
      className="late-enter pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center"
    >
      <span className="flex items-center gap-2 rounded-full border border-line bg-layer-2 px-3 py-1.5 text-sm text-ink-2 shadow-2">
        <Spinner aria-hidden="true" className="size-3.5" /> Reconnecting…
      </span>
    </div>
  );
}
