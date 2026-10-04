// Local-only MCP stdio sentinel. Reports identity; the checkpoint never calls its tool.
import { appendFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
const log = process.argv[2];
const broken = process.argv.includes('--broken');
const record = event => appendFileSync(log, JSON.stringify({ event, pid: process.pid, cwd: process.cwd() }) + '\n');
const output = message => process.stdout.write(JSON.stringify(message) + '\n');
record('spawn');
const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', data => {
  buffer += decoder.write(data);
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    record(request.method);
    if (request.id === undefined) continue;
    let result;
    switch (request.method) {
      case 'initialize':
        if (broken) {
          output({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'PHASE0_BROKEN_SENTINEL' } });
          continue;
        }
        result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'piano-phase0-sentinel', version: '1' } };
        break;
      case 'tools/list':
        result = { tools: [{ name: 'identity', description: 'Local checkpoint identity', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } }] };
        break;
      case 'ping': result = {}; break;
      default:
        output({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Checkpoint does not invoke MCP tools' } });
        continue;
    }
    output({ jsonrpc: '2.0', id: request.id, result });
  }
});
process.stdin.on('end', () => { record('stdin-end'); process.exit(0); });
process.on('SIGTERM', () => { record('sigterm'); process.exit(0); });
