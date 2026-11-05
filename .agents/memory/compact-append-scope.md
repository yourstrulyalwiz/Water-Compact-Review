---
name: Compact append scope
description: User constraints when adding new compacts and candidate entries.
---

When adding new compacts and candidates, the UI must not change, and production review entries must remain unchanged and preserved.

**Why:** The user explicitly required these boundaries for adding compacts.

**How to apply:** Scope append work separately from UI improvements. Verify preservation of existing production records; do not treat an append request as permission to replace the dataset or reset reviews.

The user confirmed that the first-run Jamaica and Cambodia export contains genuine team review decisions and comments, not example data.

**Why:** These are colleagues' historical review contributions.

**How to apply:** Preserve that source export separately from the current production backup. Confirmation of its provenance does not authorize importing legacy decisions or overwriting current reviews.
