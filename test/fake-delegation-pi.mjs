// Structured pi-subagent history and one live update, without loading the extension.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const sessionFile = arg('--session');
const entries = sessionFile && existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const reply = (command, data) => out({ type: 'response', id: command.id, command: command.type, success: true, data });
const sessionId = arg('--session-id') ?? entries.find(entry => entry.type === 'session')?.id ?? 'delegation-projection';
const canary = process.env.PIANO_TEST_SECRET ?? 'sk-delegation-canary-123456789';
const assistant = (id, name, args) => ({ role: 'assistant', provider: 'fake', model: 'delegation', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'stop' });
const result = (id, name, text, details) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], details, isError: false });
const start = (callId, runId, subagentId, label) => [
  assistant(callId, 'agent_start', { agent: 'reviewer', description: label, prompt: `Inspect ${canary}` }),
  result(callId, 'agent_start', `Started ${runId}`, { kind: 'start', rowPhrase: 'Started', tone: 'toolTitle', agent: 'reviewer', runId, subagentId }),
];
const defaultMessages = [
  ...start('start-done', 'run-done', 'subagent-stable', 'Same label'),
  { role: 'custom', customType: 'subagent-notification', display: true, content: `Useful answer ${canary}`, details: { runId: 'run-done', subagentId: 'subagent-stable', agent: 'reviewer', label: 'Same label', status: 'completed', durationMillis: 1200 } },
  assistant('resume-failed', 'agent_resume', { id: 'subagent-stable', description: 'Same label', prompt: 'Follow up' }),
  result('resume-failed', 'agent_resume', 'Resumed run-failed', { kind: 'resume', rowPhrase: 'Resumed', tone: 'toolTitle', subagentId: 'subagent-stable', runId: 'run-failed' }),
  assistant('wait-failed', 'agent_wait', { ids: ['run-failed'] }),
  result('wait-failed', 'agent_wait', 'Failed answer delivered by wait', { kind: 'collection', scope: 'named', runs: [{ runId: 'run-failed', agent: 'reviewer', status: 'failed' }], stillRunning: 0, unknown: 0, unavailable: 0, noActiveRuns: false }),
  ...start('start-cancelled', 'run-cancelled', 'subagent-cancelled', 'Same label'),
  assistant('cancel-terminal', 'agent_cancel', { ids: ['run-cancelled'] }),
  result('cancel-terminal', 'agent_cancel', 'The Run had already settled as cancelled.', { kind: 'cancel', outcomes: [{ kind: 'already terminal', runId: 'run-cancelled', phase: 'cancelled' }] }),
  ...start('start-open', 'run-open', 'subagent-open', 'Same label'),
  assistant('wait-mixed', 'agent_wait_all', {}),
  result('wait-mixed', 'agent_wait_all', 'One answer delivered, one Run still running.', { kind: 'collection', scope: 'all-active', runs: [{ runId: 'run-done', agent: 'reviewer', status: 'completed' }], stillRunning: 1, unknown: 0, unavailable: 0, noActiveRuns: false }),
  assistant('steer-open', 'agent_steer', { id: 'run-open', message: 'Use the exact full guidance.' }),
  result('steer-open', 'agent_steer', 'Guidance entered the local mailbox; delivery is not confirmed.', { kind: 'steer', rowPhrase: 'Accepted into local Control mailbox', tone: 'toolTitle', runId: 'run-open' }),
  assistant('result-open', 'agent_result', { id: 'run-open' }),
  result('result-open', 'agent_result', 'The run had not settled.', { kind: 'result', rowPhrase: 'still running', tone: 'toolOutput', outcome: 'still-running', runId: 'run-open' }),
  assistant('cancel-open', 'agent_cancel', { ids: ['run-open'] }),
  result('cancel-open', 'agent_cancel', 'Cancellation requested', { kind: 'cancel', outcomes: [{ kind: 'requested', runId: 'run-open' }] }),
  assistant('refused-start', 'agent_start', { agent: 'missing' }),
  result('refused-start', 'agent_start', 'The requested profile does not exist. No Run was started.', { kind: 'start', rowPhrase: 'Start refused · unknown Agent', tone: 'error', agent: 'missing' }),
  assistant('bad-start', 'agent_start', { agent: 'reviewer', description: 'Malformed details', prompt: 'Fallback' }),
  result('bad-start', 'agent_start', 'Readable malformed fallback', { kind: 'start', rowPhrase: '', agent: 'reviewer', runId: 123 }),
];
// The two-Run shape of a real Pi 1.1.0 session with pi-subagent Run usage (sanitized): the waited
// Run is delivered by wait, agent_result and its Notification; the other only by its Notification.
const probeUsage = { input: 3518, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.007096 };
const claudeUsage = { input: 10, output: 106, cacheRead: 0, cacheWrite: 20786, cost: 0.042112 };
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const probeStart = (callId, agent, runId, subagentId, label) => [
  assistant(callId, 'agent_start', { agent, description: label, prompt: 'Reply with exactly: OK' }),
  result(callId, 'agent_start', `Started ${runId}`, { kind: 'start', rowPhrase: 'Started', tone: 'toolTitle', agent, runId, subagentId }),
];
const notification = (runId, subagentId, agent, label, spend) => ({ role: 'custom', customType: 'subagent-notification', display: true, content: `Result of ${label}`, details: { runId, subagentId, agent, label, status: 'completed', durationMillis: 2407, ...spend } });
const usageMessages = [
  ...probeStart('start-pi', 'usage-probe-pi', 'run-qbdd-1', 'subagent-qbdd-1', 'waited probe'),
  ...probeStart('start-claude', 'usage-probe-claude', 'run-qbdd-2', 'subagent-qbdd-2', 'unwaited probe'),
  ...probeStart('start-idle', 'usage-probe-idle', 'run-idle', 'subagent-idle', 'idle probe'),
  assistant('wait-pi', 'agent_wait', { ids: ['run-qbdd-1', 'run-idle'] }),
  result('wait-pi', 'agent_wait', 'OK', { kind: 'collection', scope: 'named', runs: [
    { runId: 'run-qbdd-1', agent: 'usage-probe-pi', status: 'completed', usage: probeUsage, model: 'openai/gpt-6.1-sol' },
    { runId: 'run-idle', agent: 'usage-probe-idle', status: 'completed', usage: zero },
  ], stillRunning: 0, unknown: 0, unavailable: 0, noActiveRuns: false }),
  assistant('result-pi', 'agent_result', { id: 'run-qbdd-1' }),
  result('result-pi', 'agent_result', 'OK', { kind: 'result', rowPhrase: '2 characters', tone: 'toolOutput', outcome: 'available', run: { runId: 'run-qbdd-1', agent: 'usage-probe-pi', status: 'completed', usage: probeUsage, model: 'openai/gpt-6.1-sol' } }),
  notification('run-qbdd-1', 'subagent-qbdd-1', 'usage-probe-pi', 'waited probe', { usage: probeUsage, model: 'openai/gpt-6.1-sol' }),
  notification('run-idle', 'subagent-idle', 'usage-probe-idle', 'idle probe', {}),
  assistant('result-bad', 'agent_result', { id: 'run-idle' }),
  result('result-bad', 'agent_result', 'Malformed usage', { kind: 'result', rowPhrase: '15 characters', tone: 'toolOutput', outcome: 'available', run: { runId: 'run-idle', agent: 'usage-probe-idle', status: 'completed', usage: { ...probeUsage, cost: -1 }, model: 'x'.repeat(101) } }),
];
const usageLive = notification('run-qbdd-2', 'subagent-qbdd-2', 'usage-probe-claude', 'unwaited probe', { usage: claudeUsage, model: 'claude-haiku-4-5-20251001' });
const messages = entries.length ? entries.filter(entry => entry.type === 'message').map(entry => entry.message) : args.includes('--usage') ? usageMessages : defaultMessages;
const historicalStart = messages.find(message => message.role === 'toolResult' && message.details?.kind === 'start' && typeof message.details.subagentId === 'string');
const liveSubagentId = historicalStart?.details.subagentId ?? 'subagent-stable';
const liveAgent = historicalStart?.details.agent ?? 'reviewer';
let lastId = entries.findLast(entry => entry.type === 'message')?.id ?? null;
function emit(message) {
  messages.push(message);
  if (sessionFile) {
    const id = `delegation-${messages.length}`;
    appendFileSync(sessionFile, JSON.stringify({ type: 'message', id, parentId: lastId, timestamp: new Date().toISOString(), message }) + '\n');
    lastId = id;
  }
  out({ type: 'message_end', message });
}
function handle(command) {
  switch (command.type) {
    case 'get_state': return reply(command, { sessionId, model: { provider: 'fake', id: 'delegation' }, thinkingLevel: 'off', isStreaming: false });
    case 'get_messages': return reply(command, { messages });
    case 'get_session_stats': return reply(command, { cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, contextUsage: { tokens: 0, contextWindow: 1000, percent: 0 } });
    case 'get_commands': return reply(command, { commands: [] });
    case 'get_available_models': return reply(command, { models: [{ provider: 'fake', id: 'delegation', reasoning: false, contextWindow: 1000 }] });
    case 'prompt':
      if (command.message === '/delegation-live') {
        out({ type: 'agent_start' });
        emit({ role: 'user', content: command.message });
        emit(assistant('live-resume', 'agent_resume', { id: liveSubagentId, description: 'Live delegation', prompt: 'Continue the historical review.' }));
        emit(result('live-resume', 'agent_resume', 'Resumed run-live', { kind: 'resume', rowPhrase: 'Resumed', tone: 'toolTitle', subagentId: liveSubagentId, runId: 'run-live' }));
        emit({ role: 'custom', customType: 'subagent-notification', display: true, content: 'Live result', details: { runId: 'run-live', subagentId: liveSubagentId, agent: liveAgent, label: 'Live delegation', status: 'cancelled', durationMillis: 25 } });
        out({ type: 'agent_settled' });
      }
      if (command.message === '/usage-live') {
        out({ type: 'agent_start' });
        emit(usageLive);
        out({ type: 'agent_settled' });
      }
      out({ type: 'extension_ui_request', id: 'notice', method: 'notify', message: `barrier ${command.message}` });
      return reply(command, { disposition: 'handled' });
    default: return reply(command);
  }
}
const decoder = new StringDecoder('utf8'); let buffer = '';
process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk);
  for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
