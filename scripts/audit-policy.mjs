import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const severities = ['info', 'low', 'moderate', 'high', 'critical'];

// Evaluate advisory leaves, not npm's repeated transitive package counts.
export function auditFailures(report, production, now = new Date()) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities) {
    throw new Error('Missing or unsupported npm audit report');
  }
  const failures = [];
  for (const entry of Object.values(report.vulnerabilities)) {
    if (!severities.includes(entry.severity) || !Array.isArray(entry.via)) {
      throw new Error('Malformed npm audit vulnerability');
    }
    if (severities.indexOf(entry.severity) < 3) continue;
    if (production) {
      failures.push(entry.name);
      continue;
    }
    for (const advisory of entry.via) {
      if (typeof advisory === 'string') {
        if (!report.vulnerabilities[advisory]) throw new Error('Missing advisory dependency');
        continue;
      }
      const excepted =
        entry.name === 'braces' &&
        advisory.url === 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' &&
        advisory.range === '<=3.0.3' &&
        advisory.severity === 'high' &&
        now < new Date('2026-11-12T00:00:00Z');
      if (!excepted) failures.push(`${entry.name}: ${advisory.url}`);
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync('audit-reports', { recursive: true });
  for (const production of [false, true]) {
    const result = spawnSync(
      'npm',
      ['audit', '--json', ...(production ? ['--omit=dev'] : [])],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const scope = production ? 'production' : 'full';
    writeFileSync(`audit-reports/${scope}.json`, result.stdout ?? '');
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error(`npm audit ${scope} failed: ${result.error ?? result.stderr}`);
    }
    const failures = auditFailures(JSON.parse(result.stdout), production);
    console.log(`${scope}: ${failures.length ? failures.join(', ') : 'policy passed'}`);
    if (failures.length) process.exitCode = 1;
  }
}
