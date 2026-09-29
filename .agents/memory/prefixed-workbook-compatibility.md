---
name: Prefixed workbook compatibility
description: Why spreadsheet reader changes need validation against the supplied source workbooks
---

The source spreadsheets use `x:`-prefixed SpreadsheetML elements. Common Excel readers that normally handle XLSX files may fail to parse them, even though the files are valid and another reader accepted them. Some also reject the source table definitions, and formula cells can lack a cached result.

**Why:** Replacing the original workbook reader to remove its security advisories required several parser attempts; successful package installation and typechecking did not establish that workbook validation still worked. Rewriting source files would also invalidate their manifest hashes.

**How to apply:** When changing workbook handling, test against the supplied workbooks with the package validation command. Normalize a copy in memory if needed, leave the source files untouched, and treat formulas without cached results as blank rather than as values.