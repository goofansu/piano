/**
 * Loaded before every test file. Display redaction treats secret-named environment variables as
 * known secrets, so whatever the runner's shell exports would change projected text. Tests that
 * exercise redaction set their own canary instead.
 */
import { isSecretName } from "../server/DisplayProjection.ts";

for (const key of Object.keys(process.env)) if (isSecretName(key)) delete process.env[key];
