import { isSecretName } from "../server/shared/DisplayProjection.ts";

for (const key of Object.keys(process.env)) if (isSecretName(key)) delete process.env[key];
