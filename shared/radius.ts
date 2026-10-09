/** Machine-wide Radius setup observations, not live session connectivity or tool authorization. */
export interface RadiusSetupStep {
  status: "missing" | "ready" | "blocked";
  detail?: string;
  /** Opaque identity of the configuration reviewed before confirming removal. */
  removalKey?: string;
}
export interface RadiusSetupState {
  mcp: RadiusSetupStep;
  webSearch: RadiusSetupStep;
  /** One server-owned package operation; navigation never cancels it. */
  installation: { status: "idle" | "running" | "success" | "error"; action?: "install" | "uninstall"; detail?: string };
}
