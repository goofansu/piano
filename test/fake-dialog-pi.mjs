// Deterministic dialog/abort barriers at the actual Pi JSONL process seam. No model calls.
import { closeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const out = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (cmd, data) => out({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
const notice = message => out({ type: 'extension_ui_request', id: 'notice', method: 'notify', message });
const args = process.argv.slice(2);
const sessionId = args[args.indexOf('--session-id') + 1];
const pending = new Map();
const responses = [];
let serial = 0, streaming = false, abortHeld, holdAbort = false, model = 'alpha';
function dialog(cmd, method = 'input', timeout) {
  const id = `d${++serial}`;
  pending.set(id, cmd);
  out({ type: 'extension_ui_request', id, method, title: `Fixture ${id}`, options: ['A', 'B'], ...(timeout ? { timeout } : {}) });
}
function handle(cmd) {
  switch (cmd.type) {
    case 'get_state': return reply(cmd, { sessionId, isStreaming: streaming, model: { provider: 'fake', id: model }, thinkingLevel: 'off' });
    case 'get_messages': return reply(cmd, { messages: [] });
    case 'get_session_stats': return reply(cmd, {});
    case 'get_available_models': return reply(cmd, { models: [{ provider: 'fake', id: 'alpha', reasoning: false, contextWindow: 200000 }] });
    case 'extension_ui_response':
      responses.push(cmd);
      if (!cmd.cancelled) model = 'beta'; // An extension command changes model after its dialog returns.
      if (pending.has(cmd.id)) { if (pending.get(cmd.id)) reply(pending.get(cmd.id), { disposition: 'handled' }); pending.delete(cmd.id); }
      return notice(`received ${cmd.id}`);
    case 'abort':
      if (holdAbort) {
        abortHeld = cmd;
        dialog(undefined); // A supported dialog arriving while abort acknowledgement is pending.
        return;
      }
      streaming = false;
      out({ type: 'agent_settled' });
      return reply(cmd);
    case 'prompt': {
      if (cmd.message.startsWith('/dialog')) {
        const [, method, timeout] = cmd.message.split(' ');
        return dialog(cmd, method, Number(timeout)); // originating command acknowledgement is blocked
      }
      if (cmd.message === '/hold-abort') holdAbort = true;
      if (cmd.message === '/new-turn' || cmd.message === '/new-turn-release-abort') { streaming = true; out({ type: 'agent_start' }); dialog(undefined); }
      if (cmd.message === '/release-abort' || cmd.message === '/new-turn-release-abort') { reply(abortHeld); abortHeld = undefined; notice('old abort acknowledged'); }
      if (cmd.message === '/audit') notice(`audit ${JSON.stringify(responses)}`);
      if (cmd.message === '/close-input') {
        closeSync(0); setInterval(() => {}, 1000); notice('input closed'); return;
      }
      if (cmd.message === '/exit') process.exit(3);
      return reply(cmd, { disposition: 'handled' });
    }
  }
}
const decoder = new StringDecoder('utf8'); let buffer = '';
process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk);
  for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
