/**
 * The UI's route to one session, `/s/<id>`, and the absolute link to it that leaves Piano: the
 * webhook payload, the dispatch tools and the dispatch CLI hand out the same link the browser routes.
 */
export const sessionPath = (sessionId: string) => `/s/${encodeURIComponent(sessionId)}`;

/** `sessionPath` resolved against the origin Piano decided to hand out links for. */
export const sessionLink = (origin: string, sessionId: string) =>
  new URL(sessionPath(sessionId), origin).href;
