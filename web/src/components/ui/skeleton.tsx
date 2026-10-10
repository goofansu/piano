import { cn } from "cn"

// piano: skeletons use the fill-active layer token
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-fill-active", className)}
      {...props}
    />
  )
}

export { Skeleton }
