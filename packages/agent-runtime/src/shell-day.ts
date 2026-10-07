import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { JsonObject } from "@throne/shared-types";
import { readDeepSeekKey } from "./live-policy.ts";

/** One actor's day through the fake terminal (FEAT-0009 experiment). */
export type ShellDayRequest = {
  readonly root: string;
  /** Absolute path of the court's shell.ts, loaded by the harness plugin. */
  readonly shellModule: string;
  readonly world: JsonObject;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
};

export type ShellDayStep = {
  readonly command: string;
  readonly output: string;
  readonly isError: boolean;
};

export type ShellDayResult = {
  readonly directory: string;
  /** True when the actor needed a reminder to run end. */
  readonly nudged: boolean;
  readonly state: JsonObject | null;
  readonly transcript: readonly ShellDayStep[];
  readonly requests: number;
  readonly usage: Record<string, number>;
  readonly durationMs: number;
};

export async function runShellDay(
  request: ShellDayRequest,
): Promise<ShellDayResult> {
  const key = await readDeepSeekKey(request.root);
  const runtimeRoot = join(request.root, "runs", "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const directory = await mkdtemp(join(runtimeRoot, "shell-"));
  const shellDir = join(directory, "shell");
  await mkdir(shellDir);
  await writeFile(join(shellDir, "world.json"), JSON.stringify(request.world));
  const began = Date.now();
  const harness = new DeepSeekHarness({
    profile: "sdk-minimal",
    cwd: directory,
    processCwd: directory,
    dshHome: join(directory, "home"),
    patches: [
      fileURLToPath(new URL("../court-shell.patch.yml", import.meta.url)),
    ],
    provider: "deepseek-official",
    model: "deepseek-flash",
    reasoningEffort: "high" as never,
    maxTokens: request.maxTokens ?? 32768,
    initializeTimeoutMs: 20000,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      TMPDIR: directory,
      DEEPSEEK_API_KEY: key,
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DSH_SYSTEM_PROMPT: request.systemPrompt,
      COURT_SHELL_DIR: shellDir,
      COURT_SHELL_MODULE: request.shellModule,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = (name: string) =>
    readFile(join(shellDir, name), "utf8").catch(() => "");
  const ended = async () =>
    (JSON.parse((await read("state.json")) || "{}") as { inner?: string })
      .inner !== undefined;
  try {
    const day = async () => {
      const first = await harness.run(request.prompt);
      if (await ended()) return { first, nudged: undefined };
      // One reminder in the same session; a day that never ends is a failure, not a blank inner.
      const nudged = await harness.run(
        "你还没有收笔。请用 end --text 写下你此刻真实的想法。",
        { sessionId: first.sessionId },
      );
      if (!(await ended()))
        throw new Error("The actor finished without running end");
      return { first, nudged };
    };
    const { first, nudged } = await Promise.race([
      day(),
      new Promise<never>((_, reject) => {
        const ms = request.timeoutMs ?? 600000;
        timer = setTimeout(
          () => reject(new Error(`Shell day timed out after ${ms} ms`)),
          ms,
        );
      }),
    ]);
    const events = [...first.events, ...(nudged?.events ?? [])];
    const usage: Record<string, number> = {};
    let requests = 0;
    for (const raw of events) {
      const event = raw as {
        type?: string;
        data?: { usage?: Record<string, unknown> };
      };
      if (event.type !== "assistant/message") continue;
      requests += 1;
      for (const [k, v] of Object.entries(event.data?.usage ?? {}))
        if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
    }
    const state = await read("state.json");
    const transcript = (await read("transcript.jsonl"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ShellDayStep);
    await writeFile(join(directory, "events.json"), JSON.stringify(events));
    return {
      directory,
      nudged: nudged !== undefined,
      state: state ? (JSON.parse(state) as JsonObject) : null,
      transcript,
      requests,
      usage,
      durationMs: Date.now() - began,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message.replaceAll(key, "[redacted]"));
  } finally {
    clearTimeout(timer);
    await harness.close();
  }
}
