import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Resolve dependencies from their actual consumers, rather than root hoisting.
const requireScripts = createRequire(new URL("../package.json", import.meta.url));
const requireWeb = createRequire(new URL("../../artifacts/compact-review/package.json", import.meta.url));
const requireZod = createRequire(new URL("../../lib/api-zod/package.json", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("../../lib/api-spec/", import.meta.url));

test("Zod 4 schemas and the form resolver validate and report errors", async () => {
  const { z } = requireZod("zod");
  const { zodResolver } = requireWeb("@hookform/resolvers/zod");
  const schema = z.object({
    page: z.coerce.number().default(1),
    decisions: z.array(z.enum(["Approve", "Reject"])).max(2),
  });
  assert.deepEqual(schema.parse({ decisions: ["Approve"] }), { page: 1, decisions: ["Approve"] });
  assert.equal(schema.safeParse({ decisions: Array(10_000).fill("invalid") }).success, false);
  const resolve = zodResolver(schema);
  const options = { fields: {}, shouldUseNativeValidation: false };
  assert.deepEqual((await resolve({ decisions: ["Reject"] }, {}, options)).errors, {});
  assert.ok((await resolve({ decisions: ["invalid"] }, {}, options)).errors.decisions);
});

test("legacy glob and readdir-glob work with patched Minimatch", async () => {
  const requireExcel = createRequire(requireScripts.resolve("exceljs"));
  const requireArchiver = createRequire(requireExcel.resolve("archiver"));
  const readdirGlob = requireArchiver("readdir-glob");
  const matches = await new Promise((resolve, reject) => {
    const found = [];
    readdirGlob(fixtureRoot, { pattern: "**/*.yaml", nodir: true })
      .on("match", (entry) => found.push(entry.relative))
      .on("error", reject)
      .on("end", () => resolve(found));
  });
  assert.ok(matches.includes("openapi.yaml"));

  const requireArchiveUtils = createRequire(requireArchiver.resolve("archiver-utils"));
  const glob = requireArchiveUtils("glob");
  assert.deepEqual(glob.sync("**/openapi.yaml", { cwd: fixtureRoot }), ["openapi.yaml"]);
  assert.deepEqual(glob.sync("**/*.yaml", { cwd: fixtureRoot, ignore: "**/openapi.yaml" }), []);
  assert.deepEqual(await new Promise((resolve, reject) => {
    glob("**/*.yaml", { cwd: fixtureRoot }, (error, files) => error ? reject(error) : resolve(files));
  }), ["openapi.yaml"]);
  assert.ok(glob.sync(".git*", { cwd: fileURLToPath(new URL("../../", import.meta.url)) }).includes(".gitignore"));
});

test("ExcelJS streams a valid workbook through its archive dependencies", async () => {
  const ExcelJS = requireScripts("exceljs");
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output });
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow(["candidate_id", "decision"]).commit();
  sheet.addRow(["compatibility-check", "Approve"]).commit();
  await workbook.commit();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(Buffer.concat(chunks));
  assert.equal(restored.getWorksheet("Review").getCell("B2").value, "Approve");
});
