import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildChronicle, type ChronicleSource } from "@throne/court";

export function assertRunId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))
    throw new Error("Invalid run id");
}
export async function readChronicle(root: string, id: string) {
  assertRunId(id);
  const source = JSON.parse(
    await readFile(join(root, "runs/court", `${id}.json`), "utf8"),
  ) as ChronicleSource;
  if (source.id !== id) throw new Error(`存档局号不一致：${id}`);
  return buildChronicle(source);
}
export type LocalRun = {
  readonly id: string;
  readonly complete: boolean;
  readonly days: number;
  readonly calls: number;
};
export async function listLocalRuns(root: string) {
  const directory = join(root, "runs/court");
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const runs: LocalRun[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    const id = file.slice(0, -5);
    try {
      const c = await readChronicle(root, id);
      runs.push({
        id,
        complete: c.complete,
        days: c.days.at(-1)?.day ?? 0,
        calls: c.calls,
      });
    } catch (error) {
      errors.push({ id, error: String(error) });
    }
  }
  return { runs, errors };
}
