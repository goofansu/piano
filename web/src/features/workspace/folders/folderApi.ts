import { folderEndpoints } from "../../../../../shared/features/workspace/folders/http.ts";
import { call, type RequestOptions } from "../../../shared/transport/api.ts";

export const listDirectory = (path: string, options?: RequestOptions) =>
  call(folderEndpoints.listDirectory, { body: { path } }, options);

export const makeDirectory = async (path: string, options?: RequestOptions) =>
  (await call(folderEndpoints.makeDirectory, { body: { path } }, options)).path;
