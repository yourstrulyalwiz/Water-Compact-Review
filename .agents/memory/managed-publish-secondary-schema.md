---
name: Managed Publish and secondary schemas
description: A production rollout constraint for a separately created PostgreSQL schema.
---

The managed Publish schema check reported no changes while a secondary schema existed in development and was absent from production. Do not assume Publish will transfer that schema or its data on this project; inspect the live diff and production schema before promising a rollout. The cause of the mismatch has not been established.

The discrepancy recurred when the secondary schema existed in both environments:
the platform returned an empty diff despite directly verified differences in
columns, constraints and indexes inside `compact_v5`. Do not interpret an empty
diff as schema equality without checking the required objects directly.

A controlled test explicitly included `compact_v5` in the local Drizzle
`schemaFilter`, but the managed read-only diff still returned no statements.
The temporary config was restored without running a schema push. Do not present
that local setting as a verified fix for this project's managed publishing path.

**Why:** Publishing code under that assumption would leave the new dataset unavailable while the existing production records remain in place. Choosing a development-data overwrite instead would put those records at risk.

**How to apply:** For future production rollouts involving non-public schemas, verify an explicitly non-destructive publish plan and preserve the legacy production data. Do not substitute a deploy-build, startup migration, or direct production DDL for a missing managed schema diff.