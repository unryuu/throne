import { readFile } from "node:fs/promises";
import { fingerprint, cachedCall } from "@throne/agent-runtime/live";
import { fileURLToPath } from "node:url";
import {
  createLiveTextModel,
  type LiveCallTrace,
} from "@throne/agent-runtime/live";
import { runShellDay } from "@throne/agent-runtime/shell-day";
import {
  shellDecision,
  shellGreeting,
  shellSystemPrompt,
  type CourtModel,
  type ShellState,
} from "@throne/court";

const shellModule = fileURLToPath(
  new URL("../../../packages/court/src/shell.ts", import.meta.url),
);

/**
 * Regular decisions are lived through the fake terminal (FEAT-0009, ADR 0008);
 * Lü Fang answering the emperor face to face stays a single reply.
 */
export function createTerminalCourtModel(
  root: string,
  onTrace: (trace: LiveCallTrace) => void,
): CourtModel {
  const reply = createLiveTextModel(root, onTrace);
  return async (request) => {
    if (
      request.converse ||
      request.bureau ||
      request.summaries ||
      request.ponder
    )
      return reply(request);
    const implementation = await Promise.all(
      [
        shellModule,
        fileURLToPath(
          new URL(
            "../../../packages/agent-runtime/src/shell-day.ts",
            import.meta.url,
          ),
        ),
        fileURLToPath(
          new URL(
            "../../../packages/agent-runtime/court-shell/plugin.mjs",
            import.meta.url,
          ),
        ),
        fileURLToPath(
          new URL(
            "../../../packages/agent-runtime/court-shell.patch.yml",
            import.meta.url,
          ),
        ),
        fileURLToPath(
          new URL("../../../packages/court/src/rules.ts", import.meta.url),
        ),
      ].map((path) => readFile(path, "utf8")),
    );
    const {
      runId: _runId,
      decisionEpisodeId: _episode,
      ...visibleWorld
    } = request.input;
    return cachedCall({
      root,
      episode: request.decisionEpisodeId,
      onTrace,
      request: {
        version: 1,
        mode: "terminal-day",
        profile: "sdk-minimal",
        sdkVersion: "0.1.5-rc.2",
        model: "deepseek-flash",
        provider: "deepseek-official",
        maxTokens: 32768,
        thinking: "enabled",
        reasoningEffort: "high",
        systemPrompt: shellSystemPrompt(request.input),
        prompt: shellGreeting(request.input),
        world: visibleWorld,
        implementation: fingerprint(implementation),
      },
      validate: request.validate,
      onBusy: request.onBusy,
      run: async (onTrace) => {
        const began = Date.now();
        const base = {
          decisionEpisodeId: request.decisionEpisodeId,
          requestedProvider: "deepseek-official",
          requestedModel: "deepseek-flash",
          returnedProvider: null,
          returnedModel: null,
          thinking: "enabled" as const,
          reasoningEffort: "high" as const,
        };
        try {
          const day = await runShellDay({
            root,
            shellModule,
            world: request.input,
            systemPrompt: shellSystemPrompt(request.input),
            prompt: shellGreeting(request.input),
            timeoutMs: 300000,
          });
          onTrace({
            ...base,
            status: "succeeded",
            durationMs: day.durationMs,
            thinkingObserved: (day.usage.reasoningTokens ?? 0) > 0,
            usage: { ...day.usage, requests: day.requests },
            terminal: {
              nudged: day.nudged,
              steps: day.transcript.map((step) => ({
                command: step.command,
                output: step.output,
                isError: step.isError,
              })),
            },
          });
          return JSON.stringify(shellDecision(day.state as ShellState));
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          onTrace({
            ...base,
            status: "failed",
            error,
            durationMs: Date.now() - began,
            thinkingObserved: false,
            usage: null,
          });
          throw new Error(error);
        }
      },
    });
  };
}
