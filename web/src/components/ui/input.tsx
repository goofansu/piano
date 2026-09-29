import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface-1 px-3 py-1 text-base text-ink shadow-1 transition-[border-color,box-shadow] outline-none placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30",
        "aria-invalid:border-err aria-invalid:ring-err/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
