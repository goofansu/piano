import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const sessionId = args.includes('--session') ? JSON.parse(readFileSync(option('--session'), 'utf8').split('\n')[0]).id : args.includes('--session-id') ? option('--session-id') : 'probe';
const mode = option('--history-fixture');
const command = 'piano-history-00000000-0000-0000-0000-000000000000';
const prefix = 'piano.history.v1:';
const entries = [
  { type: 'message', id: 'first', parentId: null, timestamp: '2026-10-08T00:00:00Z', message: { role: 'user', content: 'First prompt' } },
  { type: 'message', id: 'answer', parentId: 'first', timestamp: '2026-10-08T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] } },
];
let prompts = 0, leafId = 'answer';
const emit = record => process.stdout.write(JSON.stringify(record) + '\n');
const notify = message => emit({ type: 'extension_ui_request', method: 'notify', message: prefix + JSON.stringify({ version: 1, sessionId, ...message }) });
if (mode !== 'missing') notify({ kind: 'capability', command, version: mode === 'version' ? 2 : 1 });
createInterface({ input: process.stdin }).on('line', line => {
  const record = JSON.parse(line);
  const ok = data => emit({ type: 'response', command: record.type, id: record.id, success: true, data });
  switch (record.type) {
    case 'get_available_models': return ok({ models: [] });
    case 'get_state': return ok({ sessionId, isStreaming: false, sessionName: `prompts:${prompts}` });
    case 'get_messages': return ok({ messages: entries.filter(e => e.type === 'message').map(e => e.message) });
    case 'get_session_stats': return ok({});
    case 'get_entries': return ok({ entries, leafId });
    case 'get_commands': return ok({ commands: mode === 'missing' ? [] : [{ name: command, source: 'extension', sourceInfo: { path: mode === 'wrong-source' ? '/untrusted/replacement.ts' : option('--extension') } }] });
    case 'abort': return ok({});
    case 'prompt': {
      prompts++;
      if (args.includes('--history-audit')) appendFileSync(option('--history-audit'), record.message + '\n');
      const request = JSON.parse(Buffer.from(record.message.split(' ')[1], 'base64url').toString('utf8'));
      if (mode === 'rejected') { notify({ kind: 'result', requestId: request.requestId, outcome: 'rejected', detail: 'fixture veto' }); return ok({ disposition: 'handled' }); }
      entries.push({ type: 'label', id: `label-${prompts}`, parentId: leafId, timestamp: '2026-10-08T00:00:02Z', targetId: request.entryId, label: request.label || undefined });
      leafId = `label-${prompts}`;
      if (mode === 'wrong-result') notify({ kind: 'result', requestId: 'another-operation', outcome: 'success' });
      else if (mode !== 'lost') notify({ kind: 'result', requestId: request.requestId, outcome: 'success' });
      return ok({ disposition: 'handled' });
    }
    default: throw new Error(`Unexpected ${record.type}`);
  }
});
