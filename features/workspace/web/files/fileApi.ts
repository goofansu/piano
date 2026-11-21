import type { Workspace } from "../../../../shared/wire.ts";
import { ApiError, call, type RequestOptions } from "../../../../web/src/shared/transport/api.ts";
import {
  sameWorkspace,
  type WorkspaceWrittenFiles,
  type WrittenFile,
  fileEndpoints,
  WRITTEN_PATHS_LIMIT,
} from "../../contracts/files/http.ts";

export const workspaceFile = (workspaceId: string, path: string, options?: RequestOptions) =>
  call(
    fileEndpoints.workspaceFile,
    { query: { workspaceId }, body: { path } },
    options,
    async (response) => {
      if (!response.headers.get("content-type")?.startsWith("multipart/form-data"))
        return response.json();
      const form = await response.formData();
      const metadata = form.get("metadata"),
        file = form.get("file");
      if (typeof metadata !== "string" || !(file instanceof Blob))
        throw new Error("Invalid file reply.");
      return { ...JSON.parse(metadata), bytes: new Uint8Array(await file.arrayBuffer()) };
    },
  );

export const workspaceFileDownload = (
  workspaceId: string,
  path: string,
  options?: RequestOptions,
) =>
  call(
    fileEndpoints.workspaceFileDownload,
    { query: { workspaceId }, body: { path } },
    options,
    async (response) => ({
      name:
        attachmentName(response.headers.get("content-disposition")) ??
        path.slice(path.lastIndexOf("/") + 1),
      mime:
        response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    }),
  );

function attachmentName(disposition: string | null): string | undefined {
  const exact = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (exact) {
    try {
      return decodeURIComponent(exact[1]);
    } catch {}
  }
  return undefined;
}

export const workspaceWrittenFiles = async (
  workspace: Workspace,
  paths: readonly string[],
  options?: RequestOptions,
): Promise<WorkspaceWrittenFiles> => {
  const files: WrittenFile[] = [];
  let first: WorkspaceWrittenFiles | undefined;
  for (let at = 0; at === 0 || at < paths.length; at += WRITTEN_PATHS_LIMIT) {
    options?.signal?.throwIfAborted();
    const answer = await call(
      fileEndpoints.workspaceWrittenFiles,
      {
        query: { workspaceId: workspace.id },
        body: { paths: paths.slice(at, at + WRITTEN_PATHS_LIMIT) },
      },
      options,
    );
    if (!sameWorkspace(workspace, answer.workspace))
      throw new ApiError(
        "Files answered for another workspace. Refresh folders and try again.",
        200,
      );
    first ??= answer;
    if (answer.result.status !== "ready") return answer;
    files.push(...answer.result.files);
  }
  return { workspace, observedAt: first!.observedAt, result: { status: "ready", files } };
};
