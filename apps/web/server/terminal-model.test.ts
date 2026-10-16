import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNpcInput,
  createInitialState,
  ids,
  emptyShellState,
} from "@throne/court";
import { runShellDay } from "@throne/agent-runtime/shell-day";
import type { LiveCallTrace } from "@throne/agent-runtime/live";
import { createTerminalCourtModel } from "./terminal-model.ts";
vi.mock("@throne/agent-runtime/shell-day", () => ({ runShellDay: vi.fn() }));
describe("terminal day cache", () => {
  it("caches the whole day, including transcript, across run ids and invalidates changed visible evidence", async () => {
    vi.mocked(runShellDay).mockResolvedValue({
      directory: "unused",
      nudged: false,
      state: { ...emptyShellState, inner: "今日照常办差。" } as never,
      transcript: [
        {
          command: 'end --text "今日照常办差。"',
          output: "已收笔",
          isError: false,
        },
      ],
      requests: 2,
      usage: { inputTokens: 20, outputTokens: 10 },
      durationMs: 30,
    });
    const root = await mkdtemp(join(tmpdir(), "terminal-cache-"));
    const traces: LiveCallTrace[] = [];
    const model = createTerminalCourtModel(root, (t) => traces.push(t));
    const input = buildNpcInput(
      createInitialState("seed"),
      ids.hu,
      0,
      "one",
      "zh-CN",
      true,
    );
    const request = {
      decisionEpisodeId: "first",
      sessionKey: "one",
      systemPrompt: "unused form prompt",
      prompt: "unused",
      input,
    };
    const first = await model(request);
    expect(
      await model({
        ...request,
        decisionEpisodeId: "second",
        sessionKey: "two",
        input: { ...input, runId: "two" },
      }),
    ).toBe(first);
    expect(runShellDay).toHaveBeenCalledTimes(1);
    expect(traces[1]?.cached).toBe(true);
    expect(traces[1]?.terminal).toEqual(traces[0]?.terminal);
    expect(traces[1]?.usage?.requests).toBe(0);
    await model({ ...request, input: { ...input, now: "新的一天" } });
    expect(runShellDay).toHaveBeenCalledTimes(2);
  });
});
