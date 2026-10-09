---
name: Private deployment health checks
description: Avoid treating a successful private-publishing login page as an application health check.
---

For a private deployment, do not infer app health from the status of an unauthenticated request that follows redirects.

**Why:** During a production save investigation, a shell request followed the private-access redirect and returned a Replit login HTML page with HTTP 200, rather than the application.

**How to apply:** Check the final destination and response content. Use deployment request logs or an authenticated browser to verify the actual app; never treat login-page HTML as a successful application or health-endpoint response.
