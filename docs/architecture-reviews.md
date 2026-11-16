# Architecture reviews

Which deepening candidates an architecture review of Piano proposes.

Judge the code as it stands this round. A candidate qualifies when it names a cost the code pays
now:

- a reachable bug;
- one decision made in two or more places;
- a recent `feat` or `fix` commit that touched several modules for one concept;
- consequential behavior (security, data, protocol, concurrency) that today's interface cannot test;
- code the deletion test shows can go.

For new or substantially changed features, apply [feature locality](#feature-locality):
flag a missing starting place, including implementation spread across modules without one.

Find hot spots in `feat` and `fix` commits since the last review; `refactor` commits mark settled
ground. When no candidate qualifies, report "no useful candidates" and stop.

## Feature locality

For a new or substantially changed feature, group what genuinely changes together within its
runtime behind a small interface; preserve `web → shared ← server`. Give it one obvious starting
place: a `docs/<feature>.md` page naming the owning modules per runtime, their exposed interface,
module tests, and the `verify-piano` feature entry / browser journey. Link that page from the
feature's entry in the [verification map](../.agents/skills/verify-piano/features/README.md#features).
This is not a folder migration and does not apply retroactively.
