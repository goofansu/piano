import { SessionManager } from '@earendil-works/pi-coding-agent';

export function seedConversation(cwd: string, directory: string) {
  const manager = SessionManager.create(cwd, directory);
  manager.appendThinkingLevelChange('high');
  const model = manager.appendModelChange('piano-phase0', 'project');
  const first = manager.appendMessage({ role: 'user', content: 'Original decision before compaction', timestamp: 1 });
  const answer = manager.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'piano-phase0', model: 'project', content: [{ type: 'text', text: 'Original answer' }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 });
  const abandoned = manager.appendMessage({ role: 'user', content: 'Abandoned approach', timestamp: 3 });
  manager.branch(answer);
  const compact = manager.appendCompaction('Compacted decision', answer, 10);
  const active = manager.appendMessage({ role: 'user', content: [
    { type: 'text', text: 'Active approach sk-tree-canary-secret\n' + 'long '.repeat(8000) },
    { type: 'image', data: 'BASE64_CANARY', mimeType: 'image/png' },
  ], timestamp: 4 });
  manager.appendLabelChange(abandoned, 'Return point');
  manager.resetLeaf();
  const otherRoot = manager.appendCustomEntry('fixture-root', { secret: 'CUSTOM_CANARY' });
  manager.branch(active);
  const leaf = manager.appendCustomEntry('fixture-current', {});
  return { manager, sessionId: manager.getSessionId(), file: manager.getSessionFile()!, model, first, answer, abandoned, compact, active, otherRoot, leaf };
}
