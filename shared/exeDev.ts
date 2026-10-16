import { Schema } from "effect";

/** An exe.dev integration name is one DNS label, never a URL or path. */
export const ExeDevIntegrationName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i),
);
