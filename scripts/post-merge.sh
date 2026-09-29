#!/bin/bash
set -e
pnpm install --frozen-lockfile
# The source schema is SQL-managed. Never run Drizzle push here:
# it may reconcile away existing review history or staged v5 tables.
# Apply versioned migrations and run the v5 import explicitly in development.
