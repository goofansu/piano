# ADR 0004: Same-owner remote Piano through exe.dev private access

Status: withdrawn.

Piano serves one machine. Its target is performance and user experience on the machine it runs
on, so the peer gateway, machine switcher, per-machine browser state and remote image lane this
ADR introduced were removed. A browser reaches a Piano on another host only by opening that
Piano's own origin through private authenticated access (INV-11). The original text is in Git
history.
