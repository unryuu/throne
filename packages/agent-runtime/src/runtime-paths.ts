import { resolve } from "node:path";

/** Keep code/secret paths separate from writable deployment data. */
export function runsDirectory(root: string): string {
  const configured = process.env.THRONE_RUNS_DIR;
  if (configured !== undefined && !configured.trim())
    throw new Error("THRONE_RUNS_DIR is empty");
  return resolve(root, configured ?? "runs");
}
