"use client"

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Layer 2: notices float over everything but dialogs. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 font-sans text-sm text-ink shadow-2",
          content: "flex min-w-0 flex-col gap-0.5",
          title: "font-medium",
          description: "text-ink-2",
          icon: "flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
          success: "[&_[data-icon]]:text-ok",
          error: "[&_[data-icon]]:text-err",
          warning: "[&_[data-icon]]:text-warn",
          info: "[&_[data-icon]]:text-ink-2",
          loading: "[&_[data-icon]]:text-ink-2",
          actionButton: "ml-2 h-7 rounded-md bg-brand px-2.5 text-sm font-medium text-brand-ink",
          cancelButton: "ml-2 h-7 rounded-md bg-fill px-2.5 text-sm font-medium text-ink",
          closeButton: "text-ink-3 hover:text-ink",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
