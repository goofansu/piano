# ADR 0003: Pi owns managed preview lifetime

Status: proposed; accepted on merge of PIN-99. Supersedes PIN-94's independent-lifetime decision
in [managed live previews](../live-previews.md), not its launch validation or private-access policy.

The session that starts a preview owns it through **one concrete live Pi generation**. Piano owns
Pi; systemd/launchd execute and clean up the app but do not confer an independent lifetime. This
avoids abandoned services without introducing an orphan-management screen, expiry policy or a
second session-stop control. Reopening a saved conversation creates a new generation, never an
adoption or automatic relaunch.

Turn completion, composer Stop/abort, browser disconnect and selection changes do not release Pi.
A preview pins its otherwise idle Pi while starting, running, stopping or uncertain. Explicit
preview stop leaves Pi available and permits normal idle retirement once absence is confirmed.
Archive/delete/explicit release end the owner and its preview; failed cleanup must not be reported
as successful archive/delete. Piano shutdown ends its children even if supervisor observation fails.

A generation-local private Unix socket fixes trusted session/workspace identity. Its admission gate
serializes tool requests against idle reservation and release; the adapter's existing account-wide
lock serializes workspace launches/replacements/cleanup. A supervisor runner must hold a live
connection before spawning. Transport exit closes that connection immediately, without waiting for
locks; Piano crash closes it in the kernel. A late supervisor submission cannot start an app against
a dead endpoint. There is no renewable lease, expiry timer or PID-based liveness test. The runner
exits on connection loss (systemd kills its cgroup), or kills its own still-live process group on
macOS. See [mechanism, bounds and platform limits](../live-previews.md#ownership-and-death-cleanup).

One canonical workspace has one app and one owner. Competing live sessions get a conflict, not
reuse/replace/transfer. Cleanup retains canonical workspace and exact launch identity, so it works
without the directory. A later explicit start may clear a confirmed terminal **generation-owned**
intent, only after the old owner endpoint is confirmed gone, before a fresh launch; it never adopts
an app. Even a failed app still belongs to its live owner. Independently managed legacy records cannot
be attributed or automatically stopped: users [stop them before upgrading](../live-previews.md#upgrading-from-pin-94).

Rejected alternatives: an extension shutdown callback misses SIGKILL; independent transient units
survive owner death; a saved session ID or PID can be reused; browser ownership kills useful work;
shared ownership/refcounts make release ambiguous. A dedicated watchdog service/daemon would add a
second orchestrator. The small runner within each existing supervisor job needs only Node 24.

Consequences for INV-01/02/05/06/07/11/12/13: history stays Pi-owned, process generations fence stale
cleanup, archive/delete wait for honest cleanup, workspace identity survives deletion, app environment
stays minimal and links private, and no skill or Pi wire-protocol dependency is added. There is no
physical worktree-removal action today; future removal must coordinate/refuse live owners. Hiding a
folder is not checkout removal or process release. Verification must include native owner-kill and
Piano-crash journeys, not just normal finalizers; platform gaps must be explicit.
