# Architecture reviews

Which deepening candidates an architecture review of Piano proposes.

Judge the code as it stands this round. A candidate qualifies when it names a cost the code pays
now:

- a reachable bug;
- one decision made in two or more places;
- a recent `feat` or `fix` commit that touched several modules for one concept;
- consequential behavior (security, data, protocol, concurrency) that today's interface cannot test;
- code the deletion test shows can go.

For new or substantially changed features, flag scattered ownership or a missing
[verification map](testing.md#feature-verification-map).

Find hot spots in `feat` and `fix` commits since the last review; `refactor` commits mark settled
ground. When no candidate qualifies, report "no useful candidates" and stop.

Commits before the move to `features/` name pre-feature paths; `.git-blame-ignore-revs` lists the
moves. Count a current file's history with `git log --follow --oneline -- <path>`, and set
`git config blame.ignoreRevsFile .git-blame-ignore-revs` so blame reaches past them.
