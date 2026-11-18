# T3 Changes limits vs Piano

Source inspection only; no runtime verification. T3 main: **`b707eeb052782cfd8b1ff0445f84b2aaf01da38b`** (refreshed through the librarian checkout script). Piano: **`1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b`**.

## Did Piano's 10,000-total-path limit come from T3?

**No matching limit exists in the inspected reference code.** Piano checks the maximum of HEAD-tree entries, index entries and tracked/non-ignored-untracked working inventory against **10,000 paths**—not merely changed files. T3 bounds review output instead; its current **5,000-file guard applies only to untracked files**, not total repository paths or checkpoint capture.

This establishes a difference in implementation, not the historical motivation for Piano's constant.

Sources: [Piano constants L24](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L24), [inventory check L112–125](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L112-L125); [T3 constants L47–80](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L47-L80), [untracked guard L2665–2702](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L2665-L2702).

## How T3's diff view degrades

| Boundary | Limit / degradation |
| --- | --- |
| Aggregate preview patch | **120,000 bytes per source**. Keeps a byte prefix, sets `truncated`, continues draining Git. No marker is appended by this preview path despite the option name `appendTruncationMarker`. |
| Lazy per-file patch | **1 MiB (1,048,576 bytes)** of patch output; can itself truncate. Not a file-content-size cap. |
| Metadata | **16 MiB** for numstat and untracked path output. Overflow errors; no safely truncated file list. No explicit tracked/changed-file-count ceiling. |
| Untracked count | **>5,000** omits all untracked inclusion, returns tracked patch with `truncated: true` and **no `files` list**. Normal lazy fetching is therefore unavailable. |
| Full-file expansion | Separate **1 MiB per side** limit; overflow errors. NUL-containing content is rejected as binary. |

Lazy fetching requires a **non-turn source with `truncated` and `files`**. It requests four files initially, then four at a time at an intersection loading boundary; selecting a file can request it directly. These are fresh Git reads, not continuation reads of an immutable snapshot. Per-file truncation is surfaced in file status.

Sources: [preview/stats/fallback L2794–2945](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L2794-L2945), [byte collector L810–899](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L810-L899), [separate marker wrapper L1173–1188](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L1173-L1188), [expansion L2972–3091](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L2972-L3091), [lazy eligibility L466–505](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/web/src/components/DiffPanel.tsx#L466-L505), [batch requests/status L44–223](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/web/src/components/diffs/useReviewFilePatches.ts#L44-L223), [loading boundary L5–27](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/web/src/components/diffs/DiffFileLoadingBoundary.tsx#L5-L27).

**Metadata caveat:** the untracked helper's comment promises fallback for oversized output, but its catch predicate is `error.outputLength === undefined`; overflow errors carry `outputLength`, so they propagate.

## Checkpoints, timeouts and binaries

- Checkpoint capture uses a temporary index and Git objects; no explicit ordinary total-path, per-file-content or aggregate-content cap found. Checkpoint **diff output** caps at **10,000,000 bytes**: patch truncates, numstat errors. The patch returns only stdout, discarding the truncation flag and requesting no marker; turn diffs have no lazy per-file continuation. Exceptional embedded-repository recovery has a 64-candidate / 5-second budget, not a normal capture limit. [Constants L423–427](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriver.ts#L423-L427), [capture L811–1078](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriver.ts#L811-L1078), [diff L1142–1222](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriver.ts#L1142-L1222).
- T3 defaults to **30 seconds per Git command**, not per whole operation. Checkpoint capture retries transient failures twice, spaced 75 ms. [Preview timeout L950–1100](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L950-L1100), [checkpoint process L57–230](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/VcsProcess.ts#L57-L230).
- Binary content can enter checkpoints; patches omit `--binary` and disable textconv/external diffs, yielding Git binary notices rather than payload. Numstat retains binary paths as **0 additions / 0 deletions**. Full-file expansion rejects NUL-containing content. [Preview parser L215–231](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/vcs/GitVcsDriverCore.ts#L215-L231), [checkpoint parser L1–32](https://github.com/pingdotgg/t3code/blob/b707eeb052782cfd8b1ff0445f84b2aaf01da38b/apps/server/src/checkpointing/Diffs.ts#L1-L32).

Historical `d2c9281…`, cited by [Piano's earlier note](2026-10-08-session-changes-action.md), already had the same preview byte limits but **no 5,000-untracked guard** ([constants L45–60](https://github.com/pingdotgg/t3code/blob/d2c9281b8112dc3b2991642c4bdb985e4b08b9bb/apps/server/src/vcs/GitVcsDriverCore.ts#L45-L60), [untracked flow L2499–2548](https://github.com/pingdotgg/t3code/blob/d2c9281b8112dc3b2991642c4bdb985e4b08b9bb/apps/server/src/vcs/GitVcsDriverCore.ts#L2499-L2548)). Its “120 KB cap then lazy fetch” describes preview rendering, not checkpoint completeness.

## Piano: fail closed, not partial review

Piano requires **10,000 paths per tree**, **8 MiB per file**, **64 MiB content** (unique base/index Git OIDs plus working bytes, not merely changed bytes), and **2 MiB per patch** for combined, staged and unstaged output. Git batch stdout also has a 64 MiB cap including framing. Any overflow prevents publication; no lazy-fetch fallback. Its **30-second whole-capture** abort deadline starts after serialized admission. Binary bytes are captured within those bounds, but patches contain binary notices rather than payload.

Sources: [command bounds L24–67](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L24-L67), [content L125–180](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L125-L180), [three diffs L197–207](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L197-L207), [deadline/result L239–244](https://github.com/goofansu/piano/blob/1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b/server/WorkspaceRevisions.ts#L239-L244).

**Bottom line:** Piano's 10k whole-tree gate is not a T3 diff-view limit. T3 usually degrades oversized previews into lazy per-file review; Piano rejects oversized exact captures, even when the actual change is small.
