import type { Schema } from "effect";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export type IdParam = "workspaceId" | "sessionId";

export type Fallback = string | ((status: number) => string);

export type Json = Schema.ConstraintCodec<unknown, unknown, never, never>;

export function readRefusal(body: unknown, fallback: string): { error: string; field?: string } {
  const answer = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = typeof answer.error === "string" && answer.error ? answer.error : fallback;
  return typeof answer.field === "string" ? { error, field: answer.field } : { error };
}

export interface Upload {
  readonly bytes: number;
  readonly concurrent: number;
  readonly busy: string;
  readonly tooLarge: string;
  readonly compressed: string;
  readonly unreadable: string;
  readonly timedOut: string;
}

export type RefusedStatus = 400 | 409 | 502;

export interface Endpoint<
  Q extends IdParam = IdParam,
  B extends Json | undefined = Json | undefined,
  R extends Json = Json,
  F extends RefusedStatus | undefined = RefusedStatus | undefined,
> {
  readonly method: Method;
  readonly path: `/api/${string}`;
  readonly query: ReadonlyArray<Q>;
  readonly body: B;
  readonly invalid: string;
  readonly response: R;
  readonly noStore: boolean;
  readonly refused: F;
  readonly redact: boolean;
  readonly fallback: Fallback;
  readonly upload: Upload | undefined;
}

export type NoPathParams<P extends string> = P extends `${string}${":" | "?" | "*"}${string}`
  ? never
  : P;

export const endpoint = <
  const P extends `/api/${string}`,
  M extends Method,
  Q extends IdParam = never,
  B extends Json | undefined = undefined,
  R extends Json = Json,
  F extends RefusedStatus | undefined = undefined,
>(e: {
  method: M;
  path: NoPathParams<P>;
  query?: ReadonlyArray<Q>;
  body?: M extends "GET" ? undefined : B;
  invalid?: string;
  response: R;
  noStore?: boolean;
  refused?: F;
  redact?: boolean;
  fallback: Fallback;
  upload?: M extends "GET" ? undefined : Upload;
}): Endpoint<Q, B, R, F> => ({
  method: e.method,
  path: e.path,
  query: e.query ?? [],
  body: e.body as B,
  invalid: e.invalid ?? "Invalid request.",
  response: e.response,
  noStore: e.noStore ?? false,
  refused: e.refused as F,
  redact: e.redact ?? true,
  fallback: e.fallback,
  upload: e.upload,
});

export const answerJson = (body: unknown): string => JSON.stringify(body, null, 2);
