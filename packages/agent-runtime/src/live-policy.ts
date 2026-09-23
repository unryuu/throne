import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActorDecisionInput,
  ActorDecisionOutput,
  JsonObject,
} from "@throne/shared-types";
import {
  DeepSeekHarnessDecisionPolicy,
  type DeepSeekHarnessDecisionOptions,
} from "./deepseek-harness.ts";
import type { DecisionPolicy } from "./policy.ts";

export type LiveCallTrace = {
  readonly decisionEpisodeId: string;
  readonly requestedProvider: string;
  readonly requestedModel: string;
  readonly returnedProvider: string | null;
  readonly returnedModel: string | null;
  readonly thinking: "enabled";
  readonly reasoningEffort: "high";
  readonly thinkingObserved: boolean;
  readonly durationMs: number;
  readonly usage: JsonObject | null;
  readonly status: "succeeded" | "failed";
  readonly error?: string;
};

export async function readDeepSeekKey(root: string): Promise<string> {
  const configured = process.env.DEEPSEEK_API_KEY;
  if (configured !== undefined) {
    if (!configured.trim()) throw new Error("DEEPSEEK_API_KEY is empty");
    return configured.trim();
  }
  const contents = await readFile(join(root, "secret", "deepseek.txt"), "utf8");
  const matches = contents.match(/\bsk-[A-Za-z0-9_-]+\b/g);
  if (!matches || matches.length !== 1)
    throw new Error(
      "secret/deepseek.txt must contain exactly one DeepSeek key",
    );
  return matches[0]!;
}

type LiveCall<T> = {
  readonly decisionEpisodeId: string;
  readonly systemPrompt: string;
  readonly maxTokens: number;
  readonly run: (harness: DeepSeekHarnessDecisionPolicy) => Promise<T>;
};

async function callLive<T>(
  root: string,
  onTrace: (trace: LiveCallTrace) => void,
  call: LiveCall<T>,
): Promise<T> {
  const key = await readDeepSeekKey(root);
  const runtimeRoot = join(root, "runs", "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const directory = await mkdtemp(join(runtimeRoot, "npc-"));
  const began = Date.now();
  let thinkingObserved = false;
  let usage: JsonObject | null = null;
  const harness = new DeepSeekHarnessDecisionPolicy({
    cwd: directory,
    processCwd: directory,
    dshHome: join(directory, "home"),
    patches: [fileURLToPath(new URL("../npc.patch.yml", import.meta.url))],
    provider: "deepseek-official",
    model: "deepseek-flash",
    reasoningEffort: "high" as NonNullable<
      DeepSeekHarnessDecisionOptions["reasoningEffort"]
    >,
    maxTokens: call.maxTokens,
    initializeTimeoutMs: 20000,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      TMPDIR: directory,
      DEEPSEEK_API_KEY: key,
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    },
    systemPrompt: call.systemPrompt,
    onTrace(trace) {
      for (const raw of trace.events) {
        if (!raw || typeof raw !== "object") continue;
        const event = raw as {
          type?: string;
          data?: {
            usage?: Record<string, unknown>;
            message?: { content?: { type?: string }[] };
          };
        };
        if (event.type !== "assistant/message") continue;
        thinkingObserved ||=
          event.data?.message?.content?.some(
            (block) => block.type === "reasoning",
          ) === true;
        if (event.data?.usage)
          usage = Object.fromEntries(
            Object.entries(event.data.usage).filter(
              ([, v]) => typeof v === "number",
            ),
          ) as JsonObject;
      }
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const base = {
    decisionEpisodeId: call.decisionEpisodeId,
    requestedProvider: "deepseek-official",
    requestedModel: "deepseek-flash",
    returnedProvider: null,
    returnedModel: null,
    thinking: "enabled" as const,
    reasoningEffort: "high" as const,
  };
  try {
    const output = await Promise.race([
      call.run(harness),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("DeepSeek decision timed out after 90 seconds")),
          90000,
        );
      }),
    ]);
    onTrace({
      ...base,
      status: "succeeded",
      durationMs: Date.now() - began,
      thinkingObserved,
      usage,
    });
    return output;
  } catch (cause) {
    const error = (
      cause instanceof Error ? cause.message : String(cause)
    ).replaceAll(key, "[redacted]");
    onTrace({
      ...base,
      status: "failed",
      error,
      durationMs: Date.now() - began,
      thinkingObserved,
      usage,
    });
    throw new Error(error);
  } finally {
    clearTimeout(timer);
    await harness.close();
  }
}

export function createLivePolicy(
  root: string,
  onTrace: (trace: LiveCallTrace) => void,
): DecisionPolicy {
  return {
    decide(input: ActorDecisionInput): Promise<ActorDecisionOutput> {
      return callLive(root, onTrace, {
        decisionEpisodeId: input.decisionEpisodeId,
        maxTokens: 4096,
        systemPrompt: [
          "You are Commander Zhao, an individual political actor in a simulation, not an assistant to the player.",
          "Use only the supplied actor-visible evidence. Reports are claims, not objective truth.",
          "Weigh military risk, formal duty, personal survival, loyalty, wages and patronage. You may obey either issuer; neither choice is preselected.",
          "The two capabilities are obey_ruler (deploy to the target in the royal order) and follow_chancellor (deploy to the military pay office).",
          "Use the latest received royal order for this episode. Earlier orders and your previous decisions are history, not a command to repeat them. Consider your actual past actions alongside the new evidence.",
          "Both capabilities take an empty parameters object. You cannot split the unit in this episode.",
          "Return only a JSON object: {selectedIntent:{goal:string,capabilityId:string,parameters:{}},reasoningSummary:string,confidence:number}.",
          "reasoningSummary is a brief decision justification (at most three sentences), not a chain of thought.",
          "Do not claim the action has already happened. Use the requested output language for human-readable values.",
        ].join("\n"),
        run: (harness) => harness.decide(input),
      });
    },
  };
}

export type LiveTextRequest = {
  readonly decisionEpisodeId: string;
  readonly sessionKey: string;
  readonly systemPrompt: string;
  readonly prompt: string;
};

/** Free-form live call for scenarios that own their prompt and output schema. */
export function createLiveTextModel(
  root: string,
  onTrace: (trace: LiveCallTrace) => void,
): (request: LiveTextRequest) => Promise<string> {
  return async (request) => {
    if (!request.systemPrompt.trim())
      throw new Error("Actor instructions must not be empty");
    const result = await callLive(root, onTrace, {
      decisionEpisodeId: request.decisionEpisodeId,
      maxTokens: 32768,
      systemPrompt: request.systemPrompt,
      run: (harness) =>
        harness.complete(
          request.prompt,
          `throne-${createHash("sha256").update(request.sessionKey).digest("hex").slice(0, 24)}`,
          request.decisionEpisodeId,
        ),
    });
    return result.finalResponse;
  };
}
