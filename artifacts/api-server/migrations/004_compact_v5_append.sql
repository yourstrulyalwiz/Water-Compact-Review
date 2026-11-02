-- Development migration. Production schema changes go through Publish's diff.
-- Never run from the application, deployment build, or append-data command.
BEGIN;
DO $$
DECLARE item record;
BEGIN
  -- Discover the actual constraint names, and change ONLY the four-country
  -- allowlist and candidate-ID pattern, not the prefix-equality check.
  FOR item IN
    SELECT c.conname, c.conrelid::regclass AS tbl, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN ('compact_v5.documents'::regclass,
                        'compact_v5.candidate_baselines'::regclass,
                        'compact_v5.reviewer_assignments'::regclass)
  LOOP
    IF item.definition LIKE '%country_code%ARRAY[%'
       AND item.definition LIKE '%KHM%' AND item.definition NOT LIKE '%AGO%' THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.tbl, item.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (country_code IN
        (''KHM'',''SLE'',''JAM'',''COD'',''AGO'',''BOL'',''BDI'',''CIV'',''GIN'',''MOZ'',''SEN'',''TGO'',''UZB'',''ZMB''))',
        item.tbl, item.conname);
    ELSIF item.definition LIKE '%candidate_id ~%' AND item.definition LIKE '%KHM|SLE|JAM|COD)%' THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.tbl, item.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.tbl, item.conname,
        replace(item.definition, 'KHM|SLE|JAM|COD)', 'KHM|SLE|JAM|COD|AGO|BOL|BDI|CIV|GIN|MOZ|SEN|TGO|UZB|ZMB)'));
    END IF;
  END LOOP;
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='compact_v5.import_batches'::regclass AND contype='u'
      AND pg_get_constraintdef(oid)='UNIQUE (dataset_id)'
  LOOP
    EXECUTE format('ALTER TABLE compact_v5.import_batches DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
ALTER TABLE compact_v5.import_batches ADD COLUMN IF NOT EXISTS batch_key text;
ALTER TABLE compact_v5.import_batches ADD COLUMN IF NOT EXISTS package_sha256 text
  CHECK (package_sha256 IS NULL OR package_sha256 ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS import_batches_dataset_batch_key_idx
  ON compact_v5.import_batches(dataset_id, batch_key);
COMMIT;
