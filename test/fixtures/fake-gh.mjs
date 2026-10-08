// Controlled external forge boundary for session PR module/browser checks; no credentials/network.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const fixture = JSON.parse(readFileSync(process.env.PIANO_TEST_GH_FIXTURE, 'utf8'));
const args = process.argv.slice(2), list = args[1] === 'list';
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : undefined;
if ((fixture.expectedHost && process.env.GH_HOST !== fixture.expectedHost) || (fixture.expectedRepo && repo !== fixture.expectedRepo)) {
  console.error('Incorrect GitHub API routing'); process.exit(1);
}
if (fixture.gate && list) {
  writeFileSync(fixture.gate.started, 'started');
  for (let n = 0; !existsSync(fixture.gate.release); n++) {
    if (n > 500) process.exit(1);
    await delay(10);
  }
}
if (fixture.error) { console.error(fixture.error); process.exit(1); }
if (fixture.malformed) { console.log('{}'); process.exit(0); }
if (list) console.log(JSON.stringify(fixture.prs.filter(p => p.headRefName === args[args.indexOf('--head') + 1] && p.state === 'OPEN')));
else {
  const url = repo ? `https://github.com/${repo.split('/').slice(-2).join('/')}/pull/${args[2]}` : args[2];
  const pr = fixture.prs.find(p => p.url.toLowerCase().replace('github.int.exe.xyz', 'github.com') === url.toLowerCase());
  if (!pr) { console.error('not found'); process.exit(1); }
  console.log(JSON.stringify(pr));
}
