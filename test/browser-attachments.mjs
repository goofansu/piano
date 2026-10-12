// Scratch-only browser contract: npx agent-browser, fake Pi, no paid model calls.
// Run: node test/browser-attachments.mjs /tmp/piano-attachments-evidence
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { crc32, deflateSync } from "node:zlib";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-attachments-evidence");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "piano-attachments-"));
const cwd = join(scratch, "project");
mkdirSync(cwd);
spawnSync("git", ["init", cwd]);
writeFileSync(
  join(scratch, "registry.json"),
  JSON.stringify({ folders: [cwd], worktrees: [], sessions: [] }),
);
const data =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=";
const image = join(scratch, "pixel.png");
writeFileSync(image, Buffer.from(data, "base64"));
const invalid = join(scratch, "notes.txt");
writeFileSync(invalid, "Not an image");
const oversized = join(scratch, "large.png");
writeFileSync(oversized, Buffer.alloc(10 * 1024 * 1024 + 1));
// Valid PNGs with uncompressed ancillary metadata exercise original upload bytes,
// not model quality. Different metadata prevents preview-cache deduplication.
function chunk(type, bytes) {
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  out.write(type, 4);
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
function boundaryImage(name, fill) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const start = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  ]);
  const end = chunk("IEND", Buffer.alloc(0));
  const metadata = Buffer.alloc(10 * 1024 * 1024 - start.length - end.length - 12, fill);
  metadata[1] = 0;
  const path = join(scratch, name);
  writeFileSync(path, Buffer.concat([start, chunk("tEXt", metadata), end]));
  return path;
}
const maximumImages = [boundaryImage("maximum-a.png", 97), boundaryImage("maximum-b.png", 98)];
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? "7171";
const frontendPort = process.env.PIANO_TEST_FRONTEND_PORT ?? "7172";
const backendUrl = `http://127.0.0.1:${backendPort}`,
  appUrl = `http://127.0.0.1:${frontendPort}`;
const server = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: backendPort,
    ...registryEnv(join(scratch, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-pi.mjs"),
    PI_CODING_AGENT_DIR: join(scratch, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(scratch, "sessions"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const frontend = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    frontendPort,
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...process.env, PIANO_DEV_BACKEND: backendUrl },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
for (const proc of [server, frontend]) {
  proc.stdout.on("data", (d) => (serverLog += d));
  proc.stderr.on("data", (d) => (serverLog += d));
}
const session = `attachments-${process.pid}`,
  log = [];
function ab(...args) {
  const r = spawnSync("npx", ["agent-browser", "--session", session, ...args], {
    encoding: "utf8",
    timeout: 45000,
  });
  log.push({ args, status: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
function evaluate(js) {
  return JSON.parse(ab("eval", js));
}
async function until(js) {
  for (let i = 0; i < 30; i++) {
    if (evaluate(js)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${js}`);
}
const attached = `document.querySelectorAll('[aria-label="Attachments"] [data-slot="attachment"][data-state="done"]').length`;
const transcriptImages = `document.querySelectorAll('img[alt="Attachment preview"]').length`;
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null || frontend.exitCode !== null) throw new Error(serverLog);
    try {
      if ((await fetch(`${backendUrl}/api/folders`)).ok && (await fetch(appUrl)).ok) break;
    } catch {}
    if (i === 59) throw new Error("Scratch startup failed");
    await delay(100);
  }
  ab("open", `${appUrl}/new`);
  await until(`!!document.querySelector('[aria-label^="Model:"]')?.title.includes('alpha')`);
  ab("upload", 'input[type="file"]', invalid);
  ab("wait", "--text", "Other files aren't supported yet");
  ab("upload", 'input[type="file"]', oversized);
  ab("wait", "--text", "up to 10 MiB");
  ab("upload", 'input[type="file"]', image);
  await until(`${attached} === 1`);
  ab("click", '[aria-label="Remove pixel.png"]');
  assert.equal(evaluate(attached), 0);
  ab("upload", 'input[type="file"]', image);
  await until(`${attached} === 1`);
  ab("set", "viewport", "320", "700");
  ab("screenshot", join(evidence, "new-mobile.png"));
  assert.equal(evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.equal(
    evaluate(`document.querySelector('[aria-label="Send"]').disabled`),
    false,
    "image-only send enabled",
  );
  ab("click", '[aria-label="Send"]');
  await until(`${transcriptImages} === 1`);
  await until(`document.querySelector('img[alt="Attachment preview"]').naturalWidth === 1`);
  const url = evaluate(
    `document.querySelector('img[alt="Attachment preview"]').getAttribute('src')`,
  );
  const response = evaluate(
    `(async () => {const r=await fetch('${url}');return {type:r.headers.get('content-type'),nosniff:r.headers.get('x-content-type-options'),data:btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer())))};})()`,
  );
  assert.equal(response.type, "image/png");
  assert.equal(response.nosniff, "nosniff");
  assert.equal(response.data, data);
  ab("reload");
  await until(`${transcriptImages} === 1`);
  // Paste, then remove; drop, then send a follow-up with text.
  function fileEvent(type, name) {
    evaluate(
      `(() => {const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${data}'),c=>c.charCodeAt(0))],'${name}',{type:'image/png'}));const el=document.querySelector('textarea');el.dispatchEvent(${type === "paste" ? "new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true})" : "new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})"});return true;})()`,
    );
  }
  fileEvent("paste", "pasted.png");
  await until(`${attached} === 1`);
  ab("click", '[aria-label="Remove pasted.png"]');
  fileEvent("drop", "dropped.png");
  await until(`${attached} === 1`);
  ab("fill", '[aria-label="Message"]', "describe image");
  ab("click", '[aria-label="Send"]');
  ab("wait", "--text", "echo: describe image");
  await until(`${transcriptImages} === 2`);
  assert.equal(evaluate(attached), 0);
  // Draft stays scoped and survives navigation without becoming a new session's upload.
  ab("upload", 'input[type="file"]', image);
  await until(`${attached} === 1`);
  ab("set", "viewport", "1280", "800");
  const sessionTitle = evaluate(
    `document.querySelector('button[aria-current="page"] > .truncate').textContent`,
  );
  const openSession = () =>
    evaluate(
      `[...document.querySelectorAll('nav li > button')].find(b => b.querySelector(':scope > .truncate')?.textContent === ${JSON.stringify(sessionTitle)}).click()`,
    );
  ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await until(`!!document.querySelector('[aria-label="First message"]')`);
  assert.equal(evaluate(attached), 0);
  ab("fill", '[aria-label="First message"]', "unsent new session draft");
  ab("upload", 'input[type="file"]', image);
  await until(`${attached} === 1`);
  openSession();
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await until(`!!document.querySelector('[aria-label="First message"]')`);
  assert.equal(evaluate(attached), 1, "new-session images survive navigation");
  assert.equal(
    evaluate(`document.querySelector('[aria-label="First message"]').value`),
    "unsent new session draft",
    "new-session text survives navigation with its images",
  );
  ab("click", '[aria-label="Remove pixel.png"]');
  openSession();
  await until(`${attached} === 1`);
  evaluate(
    `(() => {const native=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){window.finishImageRead=()=>{FileReader.prototype.readAsDataURL=native;native.call(this,file);};};return true;})()`,
  );
  fileEvent("paste", "slow.png");
  await until(`typeof window.finishImageRead === 'function'`);
  ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await until(`!!document.querySelector('[aria-label="First message"]')`);
  openSession();
  await until(`${attached} === 1`);
  assert.equal(
    evaluate(`document.querySelector('[aria-label="Attach images"]').disabled`),
    true,
    "reading state survives navigation",
  );
  evaluate(`(() => {window.finishImageRead();return true;})()`);
  await until(`${attached} === 2`);
  ab("click", '[aria-label="Remove slow.png"]');
  ab("set", "viewport", "320", "700");
  ab("click", '[aria-label="Remove pixel.png"]');
  ab("screenshot", join(evidence, "session-mobile.png"));
  assert.equal(evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  ab("set", "viewport", "1280", "800");
  ab("screenshot", join(evidence, "session-desktop.png"));
  ab("snapshot", "-i");
  ab("upload", 'input[type="file"]', image, image, image, image, image);
  ab("wait", "--text", "Attach up to 4 images per message.");
  assert.equal(evaluate(attached), 0);
  ab("upload", 'input[type="file"]', ...maximumImages);
  await until(`${attached} === 2`);
  ab("upload", 'input[type="file"]', image);
  ab("wait", "--text", "Images must total 20 MiB or less.");
  assert.equal(evaluate(attached), 2, "over-limit batch does not discard valid attachments");
  ab("click", '[aria-label="Send"]');
  await until(`${transcriptImages} === 4`);
  const lengths = evaluate(
    `(async () => Promise.all([...document.querySelectorAll('img[alt="Attachment preview"]')].slice(-2).map(async img => {const r=await fetch(img.src);return {status:r.status,bytes:(await r.arrayBuffer()).byteLength};})))()`,
  );
  assert.deepEqual(
    lengths,
    [
      { status: 200, bytes: 10485760 },
      { status: 200, bytes: 10485760 },
    ],
    "full 20 MiB survives browser → WS → Pi → preview route",
  );
  ab("reload");
  await until(`${transcriptImages} === 4`);
  ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await until(`!!document.querySelector('[aria-label="First message"]')`);
  ab("fill", '[aria-label="First message"]', "unsent new session draft");
  ab("click", '[aria-label="Send"]');
  ab("wait", "--text", "echo: unsent new session draft");
  ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await until(`!!document.querySelector('[aria-label="First message"]')`);
  assert.equal(
    evaluate(`document.querySelector('[aria-label="First message"]').value`),
    "",
    "sent new-session text is cleared",
  );
  assert.equal(evaluate(attached), 0);
  console.log(
    "PASS: new-session text retention and clearing, validation, picker/remove/reselect, image-only creation, paste/drop follow-up, image bytes, reload, scoped drafts, mobile/desktop, four-image cap and full 20 MiB upload/readback. Fake Pi; no real model claim.",
  );
} finally {
  try {
    ab("close");
  } catch {}
  server.kill("SIGTERM");
  frontend.kill("SIGTERM");
  writeFileSync(join(evidence, "browser.json"), JSON.stringify(log, null, 2));
  writeFileSync(join(evidence, "server.log"), serverLog);
  rmSync(scratch, { recursive: true, force: true });
}
