---
name: Local publish-build reproduction
description: Why a local web build can fail on a missing port when publishing builds successfully.
---

When reproducing a publishing build in the shell, supply the web service's configured `PORT` (and other service-specific build environment values) explicitly.

**Why:** The artifact service supplies its environment during publishing, but a plain shell build does not. A root workspace build may additionally build the mockup sandbox, which is not part of the published app, and fail for the same missing-port reason. Neither failure alone indicates a publishing failure.

**How to apply:** Compare the failed publish log with the artifact's production build command, then run that command locally with the service's configured environment rather than relying on a root-level build.