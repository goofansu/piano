export type TurnEnding = "completed" | "cancelled" | "failed" | "other";

export const turnEnding = (stopReason: string | undefined): TurnEnding => {
  switch (stopReason) {
    case "stop":
    case "length":
      return "completed";
    case "aborted":
      return "cancelled";
    case "error":
      return "failed";
    default:
      return "other";
  }
};
