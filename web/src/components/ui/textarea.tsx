import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-base text-ink shadow-1 transition-[border-color,box-shadow] outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30",
        "aria-invalid:border-err aria-invalid:ring-err/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
