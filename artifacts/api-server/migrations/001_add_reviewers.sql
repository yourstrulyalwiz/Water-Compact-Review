-- Migration 001: Add reviewers table for name+PIN identity
-- Requires: pgcrypto extension
-- Apply with: psql $DATABASE_URL < artifacts/api-server/migrations/001_add_reviewers.sql
-- Status: APPLIED to development database

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS reviewers (
  reviewer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviewers_display_name ON reviewers(display_name);

COMMIT;
