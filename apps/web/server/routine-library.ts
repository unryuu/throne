import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoutineLibrary, type RoutineEntry } from "@throne/court";

const directory = fileURLToPath(
  new URL("../../../packages/court/data/routine/", import.meta.url),
);

export async function loadRoutineLibrary(path = directory) {
  const files = (await readdir(path, { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith(".md"))
    .map((file) => file.name)
    .sort();
  return parseRoutineLibrary(
    await Promise.all(
      files.map(async (name) => ({
        name,
        text: await readFile(join(path, name), "utf8"),
      })),
    ),
  );
}

export async function loadRoutineEntries(): Promise<readonly RoutineEntry[]> {
  const result = await loadRoutineLibrary();
  if (result.warnings.length) console.warn(result.warnings.join("\n"));
  return result.entries;
}

export function routineLibraryReport(
  result: Awaited<ReturnType<typeof loadRoutineLibrary>>,
): string {
  const lines = [`杂事奏疏库：加载 ${result.entries.length} 条`];
  for (const [label, field] of [
    ["来源", "source"],
    ["类别", "category"],
    ["可信度", "credibility"],
  ] as const) {
    lines.push(`${label}：`);
    const counts = new Map<string, number>();
    for (const entry of result.entries)
      counts.set(entry[field], (counts.get(entry[field]) ?? 0) + 1);
    for (const [value, count] of counts) lines.push(`  ${value}：${count}`);
  }
  lines.push(`警告：${result.warnings.length} 条`, ...result.warnings);
  return lines.join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(routineLibraryReport(await loadRoutineLibrary()));
}
