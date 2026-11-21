import { call, signInApi, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { providerEndpoints } from "../contracts/http.ts";

export const oauthProviders = async (options?: RequestOptions) =>
  (await call(providerEndpoints.oauthProviders, {}, options)).providers;

export const providerLogout = async (provider: string, options?: RequestOptions) => {
  await call(providerEndpoints.providerLogout, { body: { provider } }, options);
};

export const providerApiKeys = async (options?: RequestOptions) =>
  (await call(providerEndpoints.providerApiKeys, {}, options)).providers;

export const changeProviderApiKey = async (
  body: typeof providerEndpoints.changeProviderApiKey.body.Type,
) => {
  await call(providerEndpoints.changeProviderApiKey, { body });
};

export const providerLogin = signInApi(providerEndpoints.providerLogin);
