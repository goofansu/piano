# Architecture reviews

Which deepening candidates an architecture review of Piano proposes.

Judge the code as it stands this round. A candidate qualifies when it names a cost the code pays
now:

- a reachable bug;
- one decision made in two or more places;
- a recent `feat` or `fix` commit that touched several modules for one concept;
- consequential behavior (security, data, protocol, concurrency) that today's interface cannot test;
- code the deletion test shows can go.

Find hot spots in `feat` and `fix` commits since the last review; `refactor` commits mark settled
ground. When no candidate qualifies, report "no useful candidates" and stop.
