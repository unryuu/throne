import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedCall,
  fingerprint,
  textRequestIdentity,
  zeroUsage,
} from "./call-cache.ts";
import type { LiveCallTrace } from "./live-policy.ts";
const trace: LiveCallTrace = {
  decisionEpisodeId: "old-run",
  requestedProvider: "test",
  requestedModel: "stub",
  returnedProvider: null,
  returnedModel: null,
  thinking: "enabled",
  reasoningEffort: "high",
  thinkingObserved: true,
  durationMs: 20,
  usage: { inputTokens: 7, outputTokens: 4 },
  status: "succeeded",
  terminal: {
    nudged: false,
    steps: [{ command: "end --text 想法", output: "已收笔", isError: false }],
  },
};
describe("exact call cache", () => {
  it("coalesces concurrent writers, restores terminal records, charges zero on a hit, and reports only misses as busy", async () => {
    const root = await mkdtemp(join(tmpdir(), "call-cache-"));
    let invoked = 0;
    const traces: LiveCallTrace[] = [],
      busy: boolean[] = [];
    const request = textRequestIdentity({
      systemPrompt: "instructions",
      prompt: "evidence",
    });
    const call = (episode: string) =>
      cachedCall({
        root,
        request,
        episode,
        onTrace: (t) => traces.push(t),
        onBusy: (v) => busy.push(v),
        run: async (emit) => {
          invoked++;
          await new Promise((r) => setTimeout(r, 30));
          emit(trace);
          return "result";
        },
      });
    expect(
      await Promise.all([call("one"), call("two"), call("three")]),
    ).toEqual(["result", "result", "result"]);
    expect(invoked).toBe(1);
    const hits = traces.filter((t) => t.cached);
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.usage).toEqual(zeroUsage);
      expect(hit.terminal).toEqual(trace.terminal);
      expect(hit.decisionEpisodeId).not.toBe("old-run");
    }
    expect(busy.filter(Boolean)).toHaveLength(1);
    expect(fingerprint(request)).not.toBe(
      fingerprint({ ...request, maxTokens: 1 }),
    );
    expect(fingerprint(request)).not.toBe(
      fingerprint({ ...request, prompt: "different evidence" }),
    );
  });
  it("does not poison the library with failed or invalid outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "call-cache-"));
    const base = {
      root,
      request: { prompt: "test" },
      episode: "test",
      onTrace: () => {},
    };
    await expect(
      cachedCall({
        ...base,
        run: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");
    await expect(
      cachedCall({
        ...base,
        validate: () => {
          throw new Error("invalid decision");
        },
        run: async (emit) => {
          emit(trace);
          return "invalid";
        },
      }),
    ).rejects.toThrow("invalid decision");
    let invoked = false;
    expect(
      await cachedCall({
        ...base,
        run: async (emit) => {
          invoked = true;
          emit(trace);
          return "valid";
        },
      }),
    ).toBe("valid");
    expect(invoked).toBe(true);
  });
});
