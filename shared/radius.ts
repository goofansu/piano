/** Machine-wide Radius setup observations, not live session connectivity or tool authorization. */
export interface RadiusSetupStep {
  status: "missing" | "ready" | "blocked";
  detail?: string;
}
export interface RadiusSetupState {
  mcp: RadiusSetupStep;
  webSearch: RadiusSetupStep;
  installation: { status: "idle" | "running" | "success" | "error"; detail?: string };
}
