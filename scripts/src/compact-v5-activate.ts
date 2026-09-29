import { activateDataset, getArg } from "./compact-v5-core.js";

try {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  const dataset = getArg(args, "--dataset");
  const result = await activateDataset(dataset);
  process.stdout.write(`${JSON.stringify({
    command: "compact:v5:activate",
    ...result,
    note: dataset.toLowerCase() === "legacy"
      ? "Active pointer cleared; the legacy application dataset remains selected."
      : "Active pointer updated after successful compact:v5:verify.",
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`compact:v5:activate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}