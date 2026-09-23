import { createHash } from "node:crypto";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
} from "@deepseek-ai/dsh-sdk-client";
import {
  actorDecisionOutputSchema,
  type ActorDecisionInput,
  type ActorDecisionOutput,
} from "@throne/shared-types";
import type { DecisionPolicy } from "./policy.ts";

const actorSystemPrompt = `You are one political actor inside a simulation. You know only the actor-visible information supplied in each request. Do not assume access to objective world state. Choose one feasible strategy based on the actor's beliefs, motivations, relationships, memories, and available capabilities.

Return only one JSON object with this shape:
{
  "reasoningSummary": "concise explanation without private chain-of-thought",
  "selectedIntent": {
    "goal": "what the actor is trying to achieve",
    "capabilityId": "one available capability when applicable",
    "parameters": {}
  },
  "confidence": 0.0,
  "requestedInformation": []
}

Do not claim that an intent has already changed the world.`;

export type HarnessDecisionTrace = {
  readonly decisionEpisodeId: string;
  readonly sessionId: string;
  readonly finalResponse: string;
  readonly events: readonly unknown[];
  readonly notifications: readonly HarnessNotification[];
};

export type DeepSeekHarnessDecisionOptions = Omit<
  DeepSeekHarnessOptions,
  "profile"
> & {
  readonly systemPrompt?: string;
  readonly onTrace?: (trace: HarnessDecisionTrace) => Promise<void> | void;
};

export class DeepSeekHarnessDecisionPolicy
  implements DecisionPolicy, AsyncDisposable
{
  readonly #harness: DeepSeekHarness;
  readonly #onTrace: DeepSeekHarnessDecisionOptions["onTrace"];

  constructor(options: DeepSeekHarnessDecisionOptions = {}) {
    const {
      onTrace,
      systemPrompt = actorSystemPrompt,
      env,
      ...harnessOptions
    } = options;
    if (!systemPrompt.trim())
      throw new Error("Actor instructions must not be empty");
    this.#onTrace = onTrace;
    this.#harness = new DeepSeekHarness({
      ...harnessOptions,
      profile: "sdk-minimal",
      env: {
        ...(env ?? process.env),
        DSH_SYSTEM_PROMPT: systemPrompt,
      },
    });
  }

  async decide(input: ActorDecisionInput): Promise<ActorDecisionOutput> {
    const sessionId = actorSessionId(input);
    const result = await this.#harness.run(decisionPrompt(input), {
      sessionId,
    });
    const decision = parseDecisionResponse(result.finalResponse);

    await this.#onTrace?.({
      decisionEpisodeId: input.decisionEpisodeId,
      sessionId: result.sessionId,
      finalResponse: result.finalResponse,
      events: result.events,
      notifications: result.notifications,
    });

    return decision;
  }

  /** Runs one free-form prompt; callers own parsing and validation. */
  async complete(
    prompt: string,
    sessionId: string,
    decisionEpisodeId: string,
  ): Promise<{ finalResponse: string; events: readonly unknown[] }> {
    const result = await this.#harness.run(prompt, { sessionId });
    await this.#onTrace?.({
      decisionEpisodeId,
      sessionId: result.sessionId,
      finalResponse: result.finalResponse,
      events: result.events,
      notifications: result.notifications,
    });
    return { finalResponse: result.finalResponse, events: result.events };
  }

  close(): Promise<void> {
    return this.#harness.close();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

export function parseDecisionResponse(response: string): ActorDecisionOutput {
  const trimmed = response.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error("DeepSeek Harness returned no JSON decision object");
  }

  const parsed: unknown = JSON.parse(
    withoutFence.slice(firstBrace, lastBrace + 1),
  );
  return actorDecisionOutputSchema.parse(parsed);
}

function actorSessionId(input: ActorDecisionInput): string {
  const identity = `${input.runId}\u0000${input.branchId}\u0000${input.actorId}`;
  const digest = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 24);
  return `throne-${digest}`;
}

function decisionPrompt(input: ActorDecisionInput): string {
  return [
    "Decide the actor's next intent from this authoritative actor-visible snapshot.",
    "Do not infer missing facts as objective truth.",
    input.outputLanguage
      ? `Use ${input.outputLanguage} for human-readable values while keeping the required JSON keys unchanged.`
      : "Use the language of the supplied context for human-readable values.",
    JSON.stringify(input),
  ].join("\n\n");
}
