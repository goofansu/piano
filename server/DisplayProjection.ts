/** Browser/export projection only. Never mutate Pi records or load its credentials.
 * Heuristic protection: known secret-valued environment variables and common token
 * shapes. Encoded, unknown and tool-specific credentials are not contained by this.
 */
import { stripVTControlCharacters } from 'node:util';

const marker = '[REDACTED]';
const prefixes = ['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'xoxp-'];

export function redactDisplay(text: string, streaming = false): string {
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => /(?:TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(key) && value && value.length >= 8)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length);
  let safe = stripVTControlCharacters(text);
  for (const secret of secrets) safe = safe.split(secret).join(marker);
  safe = safe
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[bp]-)[\w-]+/g, marker)
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1' + marker)
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?)([^\s"',;\]}]+)/gi, (_, lead: string, value: string) => lead + (value.startsWith('[REDACTED') ? value : marker))
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, marker);
  if (streaming) {
    // A full cumulative partial is projected on every update. Hide any suffix
    // which could become a known secret on the next chunk, including one byte.
    for (const secret of [...secrets, ...prefixes, 'Bearer ', '-----BEGIN ']) {
      // Generic token prefixes need an identifiable prefix, not every word
      // ending in “s” or “g”. Known environment values use the full suffix rule.
      const minimum = secrets.includes(secret) ? 1 : 3;
      for (let n = Math.min(safe.length, secret.length - 1); n >= minimum; n--) {
        if (safe.endsWith(secret.slice(0, n))) { safe = safe.slice(0, -n) + marker; break; }
      }
    }
  }
  return safe;
}

/** One rule for all outbound string values, including notices, errors and snapshots. */
export function projectDisplay<T>(value: T): T {
  if (typeof value === 'string') return redactDisplay(value) as T;
  if (Array.isArray(value)) return value.map(item => projectDisplay(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, projectDisplay(item)]),
  ) as T;
  return value;
}
