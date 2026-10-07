import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildChronicle, type ChronicleSource } from "@throne/court";

const [id, slug] = process.argv.slice(2);
if (!id || !slug) throw new Error("Usage: export-run.ts <run id> <slug>");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const saved = JSON.parse(
  await readFile(`${root}runs/court/${id}.json`, "utf8"),
) as ChronicleSource;
const chronicle = buildChronicle(saved);
const out = fileURLToPath(
  new URL(`../public/runs/${slug}.json`, import.meta.url),
);
await writeFile(out, JSON.stringify(chronicle));
console.log(
  `${out}: ${chronicle.days.length} days, ${(JSON.stringify(chronicle).length / 1024).toFixed(0)} KB`,
);
