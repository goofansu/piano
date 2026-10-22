import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("preview ownership contracts (fake supervisor, real filesystem and sockets)", async () => {
  await promisify(execFile)(
    "python3",
    [fileURLToPath(new URL("./preview_test.py", import.meta.url))],
    { timeout: 30_000 },
  );
});
