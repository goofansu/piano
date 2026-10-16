import { createContext, useContext } from "react";
import { exeDevEnvironment } from "./api";
import { useObservation } from "./useObservation";

/** Global availability never waits for integration discovery. */
export function useExeDevController() {
  return useObservation("exe-dev-environment", (signal) => exeDevEnvironment({ signal }), {
    focus: true,
    interval: (value) => (value?.detected ? undefined : 30_000),
  });
}
export const ExeDevContext = createContext<ReturnType<typeof useExeDevController> | null>(null);
export function useExeDev() {
  const value = useContext(ExeDevContext);
  if (!value) throw new Error("exe.dev needs ExeDevContext");
  return value;
}
