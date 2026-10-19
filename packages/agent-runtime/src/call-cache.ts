import { runsDirectory } from "./runtime-paths.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { LiveCallTrace } from "./live-policy.ts";

export type CallAdmission = (request: unknown) => Promise<{
  finish(trace: LiveCallTrace | undefined): Promise<void>;
}>;
const admissions = new Map<string, CallAdmission>();
/** Deployment policy runs only after a cache miss; it is not model input. */
export function registerCallAdmission(root: string, admission: CallAdmission) {
  if (admissions.has(root))
    throw new Error("Call admission already registered");
  admissions.set(root, admission);
  return () => admissions.delete(root);
}

export const fingerprint = (request: unknown): string =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");
export const zeroUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  requests: 0,
};
type CachedCall = {
  readonly version: 1;
  readonly fingerprint: string;
  readonly text: string;
  readonly trace: LiveCallTrace;
};
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** Exact request bytes, including tool-visible inputs; see ADR 0012. */
export async function cachedCall(options: {
  root: string;
  request: unknown;
  episode: string;
  onTrace: (trace: LiveCallTrace) => void;
  run: (trace: (trace: LiveCallTrace) => void) => Promise<string>;
  validate?: ((text: string) => void) | undefined;
  onBusy?: ((busy: boolean) => void) | undefined;
}): Promise<string> {
  const key = fingerprint(options.request);
  const directory = join(runsDirectory(options.root), "cache", "calls");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${key}.json`);
  const read = async (): Promise<CachedCall | undefined> => {
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as CachedCall;
      if (
        value.version !== 1 ||
        value.fingerprint !== key ||
        typeof value.text !== "string" ||
        value.trace?.status !== "succeeded"
      )
        throw new Error(`Damaged call cache: ${path}`);
      options.validate?.(value.text);
      return value;
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  };
  const hit = (value: CachedCall) => {
    options.onTrace({
      ...value.trace,
      decisionEpisodeId: options.episode,
      fingerprint: key,
      cached: true,
      durationMs: 0,
      usage: zeroUsage,
    });
    return value.text;
  };
  const existing = await read();
  if (existing) return hit(existing);
  if (process.env.THRONE_CACHE_ONLY === "1")
    throw new Error(`Call cache miss in cache-only mode: ${key}`);
  const began = Date.now();
  let lock;
  while (!lock) {
    try {
      lock = await open(path + ".lock", "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const ready = await read();
      if (ready) return hit(ready);
      if (Date.now() - began > 900000)
        throw new Error(
          `Call cache lock timed out: ${path}.lock; check its owner before recovering`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    const ready = await read();
    if (ready) return hit(ready);
    const permit = await admissions.get(options.root)?.(options.request);
    let trace: LiveCallTrace | undefined;
    let text: string;
    try {
      options.onBusy?.(true);
      text = await options.run((t) => {
        trace = { ...t, fingerprint: key, cached: false };
        options.onTrace(trace);
      });
    } finally {
      await permit?.finish(trace);
    }
    options.validate?.(text);
    if (!trace || trace.status !== "succeeded")
      throw new Error(
        "Successful model call did not supply a successful trace",
      );
    const value: CachedCall = { version: 1, fingerprint: key, text, trace };
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
    return text;
  } finally {
    options.onBusy?.(false);
    await lock.close();
    await unlink(path + ".lock");
  }
}

export const textRequestIdentity = (
  request: { systemPrompt: string; prompt: string },
  maxTokens = 32768,
) => ({
  version: 1,
  mode: "text",
  provider: "deepseek-official",
  model: "deepseek-flash",
  thinking: "enabled",
  reasoningEffort: "high",
  maxTokens,
  systemPrompt: request.systemPrompt,
  prompt: request.prompt,
});
