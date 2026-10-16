import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Analytics,
  analyticsPath,
  readAnalytics,
  quotaDay,
} from "./analytics.ts";
import { readPasscodes } from "./passcodes.ts";
import { usageTotals } from "./model-cost.ts";
import type { LiveCallTrace } from "@throne/agent-runtime/live";

afterEach(() => vi.unstubAllEnvs());
it("reserves a channel slot atomically, survives restart, reloads limits and resets at Beijing midnight", async () => {
  const root = await mkdtemp(join(tmpdir(), "channel-quota-"));
  const data = await mkdtemp(join(tmpdir(), "channel-data-"));
  vi.stubEnv("THRONE_RUNS_DIR", data);
  await mkdir(join(root, "secret"));
  const path = join(root, "secret/passcodes.json");
  const codes = [
    { label: "A", code: "a", enabled: true, maxRunsPerDay: 1 },
    { label: "B", code: "b", enabled: true, maxRunsPerDay: 1 },
  ];
  await writeFile(path, JSON.stringify(codes));
  let time = Date.parse("2026-10-16T15:59:59Z");
  const analytics = new Analytics(root, () => time);
  const identity = { channel: "A", visitor: "one" };
  const results = await Promise.allSettled([
    analytics.beforeCreate("one", identity),
    analytics.beforeCreate("two", identity),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: new Error("今日国库已空"),
  });
  await analytics.beforeCreate("three", { ...identity, channel: "B" });
  const restarted = new Analytics(root, () => time);
  await expect(restarted.beforeCreate("four", identity)).rejects.toThrow(
    "今日国库已空",
  );
  time += 1000;
  expect(quotaDay(new Date(time))).toBe("2026-10-17");
  await restarted.beforeCreate("five", identity);
  await writeFile(
    path,
    JSON.stringify([{ ...codes[0], maxRunsPerDay: 2 }, codes[1]]),
  );
  await restarted.beforeCreate("six", identity);
  await writeFile(
    path,
    JSON.stringify([{ ...codes[0], enabled: false }, codes[1]]),
  );
  await expect(restarted.beforeCreate("seven", identity)).rejects.toThrow(
    "已停用",
  );
  const events = await readAnalytics(join(data, "analytics/events.jsonl"));
  expect(events.map((e) => e.type)).toEqual(Array(4).fill("run.started"));
});

it("rejects invalid/duplicate passcodes and corrupt analytics with a line number", async () => {
  const root = await mkdtemp(join(tmpdir(), "channel-invalid-"));
  await mkdir(join(root, "secret"));
  for (const value of [
    {},
    [{ code: "a", label: "A", enabled: true, maxRunsPerDay: -1 }],
    [
      { code: "a", label: "A", enabled: true },
      { code: "a", label: "B", enabled: true },
    ],
    [
      { code: "a", label: "A", enabled: true },
      { code: "b", label: "A", enabled: false },
    ],
  ]) {
    await writeFile(join(root, "secret/passcodes.json"), JSON.stringify(value));
    await expect(readPasscodes(root)).rejects.toThrow();
  }
  await mkdir(join(root, "runs/analytics"), { recursive: true });
  await writeFile(analyticsPath(root), '{"type":"unknown"}\n');
  await expect(readAnalytics(analyticsPath(root))).rejects.toThrow(
    "events.jsonl:1",
  );
});

it("excludes fingerprint hits and marks missing usage explicitly, using opening-pack historical prices", () => {
  const base: LiveCallTrace = {
    decisionEpisodeId: "test",
    requestedProvider: "test",
    requestedModel: "test",
    returnedProvider: "test",
    returnedModel: "test",
    thinking: "enabled",
    reasoningEffort: "high",
    thinkingObserved: false,
    durationMs: 0,
    status: "succeeded",
    usage: {
      inputTokens: 1000000,
      cacheReadTokens: 1000000,
      outputTokens: 1000000,
    },
  };
  expect(
    usageTotals([
      base,
      { ...base, cached: true },
      { ...base, status: "failed", usage: null },
    ]),
  ).toEqual({
    calls: 2,
    cacheHits: 1,
    inputTokens: 1000000,
    cacheReadTokens: 1000000,
    outputTokens: 1000000,
    unknownCalls: 1,
    estimatedUsdOffPeak: 0.753,
    estimatedUsdPeak: 1.506,
  });
});
