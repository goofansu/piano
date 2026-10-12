import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { auditFailures } from './audit-policy.mjs';

const report = JSON.parse(readFileSync(new URL('../docs/research/yej-16-audit/full-before.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-12T00:00:00Z');
test('exception is development-only and expires; propagated counts are not advisories', () => {
  assert.deepEqual(auditFailures(report, false, now), []);
  assert.equal(auditFailures(report, true, now).length, 7);
  assert.equal(auditFailures(report, false, new Date('2026-11-12T00:00:00Z')).length, 1);
});
test('new high advisories and severity escalation fail the policy', () => {
  const changed = structuredClone(report);
  changed.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/new';
  assert.equal(auditFailures(changed, false, now).length, 1);
  changed.vulnerabilities.braces.via[0] = { ...report.vulnerabilities.braces.via[0], severity: 'critical' };
  assert.equal(auditFailures(changed, false, now).length, 1);
});
test('registry errors or missing reports cannot pass', () => {
  assert.throws(() => auditFailures({ error: 'unavailable' }, false, now));
  assert.throws(() => auditFailures({}, false, now));
  assert.deepEqual(auditFailures({ auditReportVersion: 2, vulnerabilities: {} }, true, now), []);
});
