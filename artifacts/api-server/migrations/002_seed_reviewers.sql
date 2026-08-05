-- Migration 002: Seed the four named reviewers
-- The new auth model uses a shared master password (REVIEWER_MASTER_PASSWORD env var)
-- instead of per-reviewer PINs.  pin_hash is populated with a random unguessable
-- value so the NOT NULL constraint is satisfied; it is never checked by the new flow.
-- Apply with: psql $DATABASE_URL < artifacts/api-server/migrations/002_seed_reviewers.sql
-- Status: APPLIED to development database

BEGIN;

INSERT INTO reviewers (display_name, pin_hash)
VALUES
  ('Christina', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('Billy',     crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('Juliana',   crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('Patricia',  crypt(gen_random_uuid()::text, gen_salt('bf')))
ON CONFLICT (display_name) DO NOTHING;

COMMIT;
