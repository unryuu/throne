import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActorDecisionInput } from "@throne/shared-types";
import {
  createLivePolicy,
  createLiveTextModel,
  type LiveCallTrace,
} from "./live-policy.ts";

const runtime = vi.hoisted(() => ({
  decide: vi.fn(),
  complete: vi.fn(),
  close: vi.fn(),
  options: vi.fn(),
}));
vi.mock("./deepseek-harness.ts", () => ({
  DeepSeekHarnessDecisionPolicy: class {
    constructor(options: unknown) {
      runtime.options(options);
    }
    decide(input: unknown) {
      return runtime.decide(input);
    }
    complete() {
      return runtime.complete();
    }
    close() {
      return runtime.close();
    }
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("live provider boundary", () => {
  it("closes a timed-out runtime and reports failure without inventing a decision", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-unit-test");
    runtime.decide.mockImplementation(() => new Promise(() => {}));
    runtime.close.mockResolvedValue(undefined);
    const root = await mkdtemp(join(tmpdir(), "throne-timeout-"));
    const traces: LiveCallTrace[] = [];
    vi.useFakeTimers();
    const pending = createLivePolicy(root, (t) => traces.push(t)).decide(
      {} as ActorDecisionInput,
    );
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.waitFor(() => expect(runtime.decide).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(90001);
    await rejected;
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(traces[0]?.status).toBe("failed");
    const options = runtime.options.mock.calls[0]![0];
    expect(options.reasoningEffort).toBe("high");
    expect(options.patches[0]).toContain("npc.patch.yml");
    expect(options.env.DEEPSEEK_API_KEY).toBe("sk-unit-test");
    expect(options.env.HOME).not.toBe(process.env.HOME);
    expect(options.systemPrompt).toContain("individual political actor");
  });
});

it("allows the storyteller a longer deadline and smaller output budget without changing NPC defaults", async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "sk-unit-test");
  runtime.complete.mockImplementation(() => new Promise(() => {}));
  runtime.close.mockResolvedValue(undefined);
  const root = await mkdtemp(join(tmpdir(), "throne-story-deadline-"));
  const traces: LiveCallTrace[] = [];
  vi.useFakeTimers();
  const pending = createLiveTextModel(root, (t) => traces.push(t), {
    timeoutMs: 300000,
    maxTokens: 12288,
  })({
    decisionEpisodeId: "story",
    sessionKey: "story",
    systemPrompt: "Tell the story",
    prompt: "records",
  });
  const rejected = expect(pending).rejects.toThrow("300 seconds");
  await vi.waitFor(() => expect(runtime.complete).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(90001);
  expect(traces).toEqual([]);
  expect(runtime.options.mock.calls[0]![0].maxTokens).toBe(12288);
  await vi.advanceTimersByTimeAsync(210000);
  await rejected;
  expect(runtime.close).toHaveBeenCalledOnce();
  expect(traces[0]?.status).toBe("failed");
});
