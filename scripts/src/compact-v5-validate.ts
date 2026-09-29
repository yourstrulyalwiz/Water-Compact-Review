import {
  DEFAULT_MANIFEST,
  assertValid,
  getArg,
  validatePackage,
  writeValidationReport,
} from "./compact-v5-core.js";

try {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  const manifest = getArg(args, "--manifest", DEFAULT_MANIFEST);
  const reportPathArg = args.includes("--report")
    ? getArg(args, "--report")
    : undefined;
  const result = await validatePackage(manifest);
  const report = await writeValidationReport(result, reportPathArg);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  process.stdout.write(`${JSON.stringify({
    command: "compact:v5:validate",
    dataset: result.datasetId,
    valid: result.valid,
    totals: result.totals,
    country_streams: result.countryStreams,
    errors,
    warnings,
    report,
  }, null, 2)}\n`);
  assertValid(result);
} catch (error) {
  process.stderr.write(`compact:v5:validate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}