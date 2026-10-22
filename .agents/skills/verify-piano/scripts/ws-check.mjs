#!/usr/bin/env node
// Exits 0 once Piano sends its registry over the session socket, the way the browser connects.
// Usage: ws-check.mjs <ws-url> <origin>
const [url, origin] = process.argv.slice(2);
if (!url || !origin) {
  console.error("usage: ws-check.mjs <ws-url> <origin>");
  process.exit(2);
}
const ws = new WebSocket(url, { headers: { Origin: origin } });
const timer = setTimeout(() => {
  console.error(`no registry message from ${url} within 10s`);
  process.exit(1);
}, 10_000);
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message._tag !== "registry") return;
  clearTimeout(timer);
  console.log(`registry over ${url}: ${message.folders.length} folder(s)`);
  ws.close();
  process.exit(0);
};
ws.onerror = () => {
  console.error(`socket error on ${url} (a 403 means the origin is not allowed)`);
  process.exit(1);
};
