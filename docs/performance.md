# Performance benchmarks

Opt-in measurements for a performance claim. None is a CI gate or a latency budget: a result proves
its bounded synthetic workload on the machine that ran it (INV-09), and correctness still comes
from the module suite and browser journeys.

- Run one benchmark at a time on an idle machine, apart from test suites and browser checks.
- Each starts its own scratch backend, database and Pi directories; none needs model credentials.
- To compare revisions, run the same benchmark script in a separate checkout of the base revision.
  Compare the raw runs and their recorded revision and environment, not one machine's times.
- Keep output on the PR, not in Git.

| Measures | Command | Also needs | Detail |
| --- | --- | --- | --- |
| Transcript size against opening, scrolling and sending | `node test/browser/session-perf.mjs <directory>` | agent-browser | `--help` |
| Sidebar rendering by session count | `node test/performance-sidebar-sessions.mjs <directory> [counts…]` | agent-browser |  |
| New-session startup stages | `node scripts/bench/start-session.mjs <directory>` | agent-browser; the locked real Pi | [`scripts/bench`](../scripts/bench/README.md) |
| Folder picker and registry latency | `node test/performance-folder-registry.mjs <file>.json` | Linux `ss` |  |
| Saved-history peeks | `node test/performance-saved-history.mjs <file>.json` | |  |
