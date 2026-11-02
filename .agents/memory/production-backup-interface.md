---
name: Production backup interface
description: User-visible backup controls differed from documentation in this workspace.
---

On 2026-11-02 the user reported no production backup settings, but confirmed
production connection details were available. Do not send them repeatedly to
“Scheduled backups → View all backups” without verifying that interface exists.

**Why:** Documentation suggested those controls, but the user could not access
them. A manual read-only export through a separately supplied secure connection
provided a workable alternative and was successfully restored in isolation.

**How to apply:** For future backup work, check the available interface first.
Treat a backup listing, a data fingerprint, and a successful isolated restore as
different evidence. Never test recovery by restoring over the live database.
