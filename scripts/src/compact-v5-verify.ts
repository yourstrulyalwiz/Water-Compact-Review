import {
  DEFAULT_MANIFEST,
  assertValid,
  getArg,
  validatePackage,
  verifyDataset,
  writeValidationReport,
} from "./compact-v5-core.js";

try {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  const dataset = getArg(args, "--dataset");
  const manifest = getArg(args, "--manifest", DEFAULT_MANIFEST);
  const sourceValidation = await validatePackage(manifest);
  const report = await writeValidationReport(sourceValidation);
  assertValid(sourceValidation);
  if (sourceValidation.datasetId !== dataset) {
    throw new Error(`Manifest dataset ${sourceValidation.datasetId} does not match requested dataset ${dataset}`);
  }
  const counts = await verifyDataset(dataset, true);
  process.stdout.write(`${JSON.stringify({
    command: "compact:v5:verify",
    dataset,
    valid: true,
    source_assets: sourceValidation.fileHashes.length,
    counts,
    report,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`compact:v5:verify failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}