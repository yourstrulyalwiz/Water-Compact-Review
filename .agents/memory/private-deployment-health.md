---
name: Private deployment health checks
description: Avoid treating a successful private-publishing login page as an application health check.
---

For a private deployment, do not infer app health from the status of an unauthenticated request that follows redirects.

**Why:** During a production save investigation, a shell request followed the private-access redirect and returned a Replit login HTML page with HTTP 200, rather than the application.

**How to apply:** Check the final destination and response content. Use deployment request logs or an authenticated browser to verify the actual app; never treat login-page HTML as a successful application or health-endpoint response.

Pre-append PDF verification must not depend on document rows that the append has
not created yet. Use a fixed-manifest, read-only check of deployed file bytes.

**Why:** Document-bound download routes cannot prove that incoming PDFs exist
before their metadata is imported. Adding temporary production rows would
unnecessarily compromise the read-only preflight.

**How to apply:** Verify bundled deployment assets independently of the database;
do not let a workspace fallback hide missing production files, and do not treat
a local check as evidence for the published server.
