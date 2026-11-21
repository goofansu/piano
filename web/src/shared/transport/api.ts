import { Schema } from "effect";
import {
  readRefusal,
  type Endpoint,
  type IdParam,
  type Json,
} from "../../../../shared/endpoint.ts";
import { type SignInEndpoints } from "../../../../shared/signInEndpoints.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly field: string | undefined;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

type Input<Q extends IdParam, B extends Json | undefined> = ([Q] extends [never]
  ? unknown
  : { readonly query: Readonly<Record<Q, string>> }) &
  (B extends Json ? { readonly body: B["Type"] } : unknown);

export async function call<Q extends IdParam, B extends Json | undefined, R extends Json>(
  endpoint: Endpoint<Q, B, R>,
  input: Input<Q, B>,
  { signal }: RequestOptions = {},
  readSuccess?: (response: Response) => Promise<unknown>,
): Promise<R["Type"]> {
  const { method, noStore, fallback, path } = endpoint;
  const { query, body } = input as { query?: Record<string, string>; body?: unknown };
  const failure = (status: number) => (typeof fallback === "string" ? fallback : fallback(status));
  let response: Response;
  try {
    response = await fetch(query ? `${path}?${new URLSearchParams(query)}` : path, {
      method,
      signal,
      ...(noStore ? { cache: "no-store" as const } : {}),
      ...(endpoint.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(failure(0), 0);
  }
  const json: unknown = await (
    response.ok && readSuccess ? readSuccess(response) : response.json()
  ).catch((error) => {
    if (signal?.aborted) throw error;
    return undefined;
  });
  if (!response.ok) {
    const { error, field } = readRefusal(json, failure(response.status));
    throw new ApiError(error, response.status, field);
  }
  const decoded = Schema.decodeUnknownExit(endpoint.response)(json);
  if (decoded._tag === "Failure") throw new ApiError(failure(response.status), response.status);
  return decoded.value;
}

export type SignInRequest =
  | { method: "GET" }
  | { method: "POST"; body: SignInEndpoints["start"]["body"]["Type"] }
  | { method: "PUT"; body: SignInEndpoints["answer"]["body"]["Type"] }
  | { method: "DELETE"; body: SignInEndpoints["cancel"]["body"]["Type"] };

export const signInApi =
  (endpoints: SignInEndpoints) =>
  async (request: SignInRequest = { method: "GET" }, options?: RequestOptions) => {
    switch (request.method) {
      case "GET":
        return (await call(endpoints.state, {}, options)).state;
      case "POST":
        return (await call(endpoints.start, request, options)).state;
      case "PUT":
        return (await call(endpoints.answer, request, options)).state;
      case "DELETE":
        return (await call(endpoints.cancel, request, options)).state;
    }
  };
