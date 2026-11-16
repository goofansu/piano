import { toast } from "sonner";
import type { Notify } from "./client.ts";

export const toastNotify: Notify = (message, level) =>
  level === "success"
    ? toast.success(message)
    : level === "info"
      ? toast.info(message)
      : level === "warning"
        ? toast.warning(message)
        : level === "error"
          ? toast.error(message)
          : toast(message);
