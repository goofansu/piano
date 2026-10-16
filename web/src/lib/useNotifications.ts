import { createContext, useContext } from "react";
import { notificationSettings } from "./api";
import { useObservation } from "./useObservation";

export function useNotificationController() {
  return useObservation("notifications", (signal) => notificationSettings({ signal }), {
    focus: true,
    interval: (value) => (value?.detected ? undefined : 30_000),
  });
}
export const NotificationContext = createContext<ReturnType<
  typeof useNotificationController
> | null>(null);
export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("Notifications need NotificationContext");
  return value;
}
