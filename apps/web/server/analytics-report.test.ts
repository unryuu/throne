import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  summarizeAnalytics,
  analyticsReport,
  sinceTimestamp,
} from "./analytics-report.ts";
import {
  analyticsPath,
  type AnalyticsData,
  type AnalyticsEvent,
} from "./analytics.ts";
import { estimateCost, usageTotals } from "./model-cost.ts";

it("reports unique visitors, run cohorts, completions and cumulative cost deltas from a fake event file", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-report-"));
  const a = { channel: "朋友圈", visitor: "v1" },
    b = { channel: "小红书", visitor: "v2" };
  const event = (
    data: AnalyticsData,
    at = "2026-10-16T02:00:00Z",
  ): AnalyticsEvent => ({ ...data, at, version: 1 });
  const usage = (calls: number) => ({
    ...usageTotals([]),
    calls,
    inputTokens: calls * 1000000,
    ...estimateCost(calls * 1000000, 0, 0),
  });
  const events = [
    event({ type: "auth.login", ...a }, "2026-10-15T00:00:00Z"),
    event({ type: "run.started", ...a, runId: "old" }, "2026-10-15T00:00:00Z"),
    event(
      { type: "run.usage", ...a, runId: "old", usage: usage(1) },
      "2026-10-15T00:00:00Z",
    ),
    event({ type: "auth.login", ...a }),
    event({ type: "auth.login", ...a }),
    event({ type: "auth.login", ...b }),
    event({ type: "auth.failure", reason: "invalid-code" }),
    event({ type: "run.started", ...a, runId: "new" }),
    event({ type: "run.started", ...a, runId: "other" }),
    event({
      type: "run.progress",
      ...a,
      runId: "new",
      day: 5,
      status: "waiting",
      operation: "rescript",
    }),
    event({ type: "run.usage", ...a, runId: "new", usage: usage(1) }),
    event({
      type: "run.progress",
      ...a,
      runId: "new",
      day: 10,
      status: "complete",
      operation: "act",
    }),
    event({ type: "run.usage", ...a, runId: "new", usage: usage(2) }),
    event({ type: "run.usage", ...a, runId: "new", usage: usage(2) }),
    event({ type: "run.completed", ...a, runId: "new", day: 10 }),
    event({ type: "run.completed", ...a, runId: "new", day: 10 }),
    event({
      type: "run.progress",
      ...a,
      runId: "other",
      day: 2,
      status: "waiting",
      operation: "create",
    }),
    event({ type: "run.usage", ...a, runId: "other", usage: usage(0) }),
    event({ type: "run.usage", ...a, runId: "old", usage: usage(3) }),
  ];
  await mkdir(join(root, "runs/analytics"), { recursive: true });
  await writeFile(
    analyticsPath(root),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const report = summarizeAnalytics(events, "2026-10-16");
  expect(report.failures).toBe(1);
  expect(report.rows.find((r) => r.channel === "朋友圈")).toMatchObject({
    visitors: 1,
    logins: 2,
    runs: 2,
    averageDay: 6,
    completionRate: 0.5,
    calls: 4,
    inputTokens: 4000000,
    unsettledRuns: 0,
  });
  expect(
    report.rows.find((r) => r.channel === "朋友圈")!.estimatedUsdOffPeak,
  ).toBeCloseTo(0.6);
  expect(
    report.rows.find((r) => r.channel === "朋友圈")!.estimatedUsdPeak,
  ).toBeCloseTo(1.2);
  expect(report.rows.find((r) => r.channel === "小红书")).toMatchObject({
    visitors: 1,
    logins: 1,
    runs: 0,
    averageDay: null,
    completionRate: null,
  });
  expect(await analyticsReport(root, ["--since=2026-10-16"])).toContain(
    "| 朋友圈 | 1 | 2 | 2 | 6.0 | 50.0% | 4 | 4000000 | 0.600000–1.200000 |",
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("apps/web/server/analytics-report.ts"),
      "--since=2026-10-16",
    ],
    { env: { ...process.env, THRONE_RUNS_DIR: join(root, "runs") } },
  );
  expect(stdout).toContain(
    "| 朋友圈 | 1 | 2 | 2 | 6.0 | 50.0% | 4 | 4000000 |",
  );
  expect(() => sinceTimestamp("2026-02-30")).toThrow("有效日期");
  expect(sinceTimestamp("2026-10-16")).toBe(Date.parse("2026-10-15T16:00:00Z"));
  await expect(analyticsReport(root, ["--since="])).rejects.toThrow("有效日期");
});
