export const sessionPath = (sessionId: string) => `/s/${encodeURIComponent(sessionId)}`;

export const sessionLink = (origin: string, sessionId: string) =>
  new URL(sessionPath(sessionId), origin).href;
