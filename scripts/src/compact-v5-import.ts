import {
  DEFAULT_MANIFEST,
  assertValid,
  getArg,
  stagePackage,
  validatePackage,
  writeValidationReport,
} from "./compact-v5-core.js";

try {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  const manifest = getArg(args, "--manifest", DEFAULT_MANIFEST);
  const mode = getArg(args, "--mode");
  if (mode !== "stage") throw new Error("Only --mode stage is supported; activation is always a separate explicit command");
  const result = await validatePackage(manifest);
  const report = await writeValidationReport(result);
  assertValid(result);
  const staged = await stagePackage(result);
  process.stdout.write(`${JSON.stringify({
    command: "compact:v5:import",
    dataset: result.datasetId,
    mode,
    result: staged.result,
    counts: staged.counts,
    report,
    active_pointer_changed: false,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`compact:v5:import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}