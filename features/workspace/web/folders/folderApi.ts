import { call, type RequestOptions } from "../../../../web/src/shared/transport/api.ts";
import { folderEndpoints } from "../../contracts/folders/http.ts";

export const listDirectory = (path: string, options?: RequestOptions) =>
  call(folderEndpoints.listDirectory, { body: { path } }, options);

export const makeDirectory = async (path: string, options?: RequestOptions) =>
  (await call(folderEndpoints.makeDirectory, { body: { path } }, options)).path;
