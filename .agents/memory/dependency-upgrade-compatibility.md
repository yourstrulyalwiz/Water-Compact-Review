---
name: Dependency upgrade compatibility
description: Why security remediation must retain runtime compatibility with Node 20 and legacy archive tooling.
---

Keep API generation compatible with Node 20 rather than upgrading the runtime as part of dependency-only maintenance.

**Why:** A newer Orval release installed successfully and the application's build passed, but generating Zod schemas failed because it used `Map.groupBy`, which Node 20 does not provide. The older generator line can remain secure by upgrading its transitive dependencies.

**How to apply:** Run generation against temporary output folders when upgrading the generator, not just the app typecheck. Do not assume installation or declared engine constraints prove runtime compatibility.

Security audits do not establish compatibility across transitive major upgrades.

**Why:** Patched Minimatch releases changed the matcher objects consumed by legacy Glob. A zero-vulnerability lockfile still allowed archive-related wildcard operations to throw.

**How to apply:** Exercise wildcard matching and streaming Excel round trips when changing archive or matching dependencies; preserve these checks even if the frontend build succeeds.
