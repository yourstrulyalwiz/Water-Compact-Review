import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { validatePackage } from './package.js';
import { inventory, applyAppend, verifyBatch, assertPreserved, preflight } from './database.js';
import { loadAllCandidates } from '../../../artifacts/compact-review/src/lib/load-all-candidates.js';

// Explicit local disposable PostgreSQL only. Never uses DATABASE_URL.
const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:55432/compact_append_test' });
const client = await pool.connect();
try {
  const pkg = await validatePackage('../source_package/append-20261020/append-manifest.json');
  const dataset = (await client.query('SELECT active_dataset_id FROM compact_v5.dataset_state')).rows[0].active_dataset_id;
  const reviewer = (await client.query('SELECT reviewer_id FROM public.reviewers LIMIT 1')).rows[0].reviewer_id;
  // Historical activity exists BEFORE the append, even when the copied
  // development fixture has no human reviews of its own.
  await client.query(`INSERT INTO compact_v5.review_events(dataset_id,candidate_id,assessment_revision,reviewer_id,stage,decision,comment)
    VALUES($1,'SLE-RA-018',1,$2,'Global','Needs Discussion','Preserve this pre-import comment')`, [dataset,reviewer]);
  const keys = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='compact_v5'
    AND table_name='candidate_assessments' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
  const copyRevision = (candidate: string) => client.query(`INSERT INTO compact_v5.candidate_assessments(${keys.join(',')})
    SELECT ${keys.map(k => k === 'assessment_revision' ? '2' : k === 'change_reason' ? "'Disposable revision'" : k).join(',')}
    FROM compact_v5.candidate_assessments WHERE dataset_id=$1 AND candidate_id=$2 AND assessment_revision=1`, [dataset,candidate]);
  await copyRevision('SLE-RA-018');
  const before = await inventory(client, dataset);
  const invalid = structuredClone(pkg);
  invalid.data.candidate_evidence[0]!.evidence_id = 'INVALID';
  await assert.rejects(applyAppend(client, invalid, dataset, before, {}));
  assertPreserved(before, await inventory(client, dataset));
  assert.equal((await preflight(client, pkg, dataset)).existing, undefined);
  const second = await pool.connect();
  const outcomes = await Promise.all([
    applyAppend(client, pkg, dataset, before, {}),
    applyAppend(second, pkg, dataset, before, {}),
  ]);
  second.release();
  assert.deepEqual(outcomes.map(r => r.result).sort(), ['already-applied', 'appended']);
  const batch = outcomes[0]!.batch_id;
  await verifyBatch(client, pkg, dataset, batch);
  assertPreserved(before, await inventory(client, dataset));
  const cid = pkg.data.candidate_baselines[0]!.candidate_id;
  await client.query(`INSERT INTO compact_v5.review_events(dataset_id,candidate_id,assessment_revision,reviewer_id,stage,decision,comment)
    VALUES($1,$2,1,$3,'Global','Approve','Disposable test review')`, [dataset,cid,reviewer]);
  await copyRevision(cid);
  const later = await inventory(client,dataset);
  assert.equal((await applyAppend(client,pkg,dataset,before,{})).result,'already-applied');
  assertPreserved(later,await inventory(client,dataset));
  const changed = structuredClone(pkg); changed.fingerprint='0'.repeat(64);
  await assert.rejects(preflight(client,changed,dataset), /fingerprint/);
  await assert.rejects(preflight(client,pkg,'wrong-dataset'), /active dataset/);
  const rows = Array.from({length:817},(_,i)=>({candidate_id:`ID-${i}`}));
  const load = (bad: boolean) => loadAllCandidates(async url => {
    const page=Number(new URL(url,'https://test').searchParams.get('page'));
    return {dataset_id:'test',page,limit:500,total:817,candidates:bad && page===2 ? rows.slice(0,317) : rows.slice((page-1)*500,page*500)};
  });
  assert.equal((await load(false)).candidates.length,817);
  await assert.rejects(load(true), /Duplicate/);
  await assert.rejects(loadAllCandidates(async()=>{throw new Error('network');}),/network/);
  assert.deepEqual(await loadAllCandidates(async()=>rows),rows);
  console.log('PASS: rollback, concurrent append, full batch verification, original-row preservation, retry after review/revision, conflicts, 817-row pagination, duplicates, network errors and legacy response.');
} finally {client.release();await pool.end();}
