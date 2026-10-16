import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runsDirectory } from "@throne/agent-runtime/live";
import { readPasscodes, type Visitor } from "./passcodes.ts";
import { usageTotals, type UsageTotals } from "./model-cost.ts";
import type { CourtOperation, SavedCourtRun } from "./court-service.ts";

type RunEvent = Visitor & { readonly runId: string };
export type AnalyticsData =
  | (Visitor & { readonly type: "auth.login" })
  | { readonly type: "auth.failure"; readonly reason: string }
  | (RunEvent & { readonly type: "run.started" })
  | (RunEvent & {
      readonly type: "run.progress";
      readonly operation: CourtOperation;
      readonly day: number;
      readonly status: string;
    })
  | (RunEvent & { readonly type: "run.completed"; readonly day: number })
  | (RunEvent & { readonly type: "run.usage"; readonly usage: UsageTotals });
export type AnalyticsEvent = AnalyticsData & {
  readonly version: 1;
  readonly at: string;
};
export const analyticsPath = (root: string) =>
  join(runsDirectory(root), "analytics", "events.jsonl");
export const quotaDay = (date: Date) =>
  new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export async function readAnalytics(
  path: string,
): Promise<readonly AnalyticsEvent[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = text.split("\n");
  return lines.flatMap<AnalyticsEvent>((line, i) => {
    if (!line && i === lines.length - 1) return [];
    const fail = () => {
      throw new Error(`Invalid analytics event at ${path}:${i + 1}`);
    };
    let event: AnalyticsEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return fail();
    }
    if (
      !event ||
      event.version !== 1 ||
      typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at))
    )
      return fail();
    if (event.type === "auth.failure") {
      if (typeof event.reason !== "string") return fail();
      return [event];
    }
    if (
      !("channel" in event) ||
      typeof event.channel !== "string" ||
      !event.channel ||
      typeof event.visitor !== "string" ||
      !event.visitor
    )
      return fail();
    if (event.type === "auth.login") return [event];
    if (typeof event.runId !== "string" || !event.runId) return fail();
    const number = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0;
    switch (event.type) {
      case "run.started":
        break;
      case "run.progress":
        if (
          !["create", "rescript", "act", "retry"].includes(event.operation) ||
          !["waiting", "running", "failed", "complete"].includes(
            event.status,
          ) ||
          !Number.isSafeInteger(event.day) ||
          event.day < 0
        )
          return fail();
        break;
      case "run.completed":
        if (!Number.isSafeInteger(event.day) || event.day < 0) return fail();
        break;
      case "run.usage":
        if (
          !event.usage ||
          ![
            "calls",
            "cacheHits",
            "inputTokens",
            "cacheReadTokens",
            "outputTokens",
            "unknownCalls",
            "estimatedUsdOffPeak",
            "estimatedUsdPeak",
          ].every((k) => number(event.usage[k as keyof UsageTotals]))
        )
          return fail();
        break;
      default:
        return fail();
    }
    return [event];
  });
}

/** One writer per deployment. Admission and JSONL append share the same queue. */
export class Analytics {
  private queue: Promise<unknown> = Promise.resolve();
  private events: AnalyticsEvent[] | undefined;
  constructor(
    readonly root: string,
    readonly now: () => number = Date.now,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async loaded() {
    this.events ??= [...(await readAnalytics(analyticsPath(this.root)))];
    return this.events;
  }
  private async append(data: readonly AnalyticsData[]) {
    const events = await this.loaded();
    const next = data.map((item) => ({
      ...item,
      version: 1 as const,
      at: new Date(this.now()).toISOString(),
    }));
    const path = analyticsPath(this.root);
    await mkdir(join(runsDirectory(this.root), "analytics"), {
      recursive: true,
    });
    await appendFile(
      path,
      next.map((e) => JSON.stringify(e)).join("\n") + "\n",
      { mode: 0o600 },
    );
    events.push(...next);
  }
  record(data: AnalyticsData): Promise<void> {
    return this.serial(() => this.append([data]));
  }
  beforeCreate(runId: string, identity: Visitor): Promise<void> {
    return this.serial(async () => {
      const passcode = (await readPasscodes(this.root)).find(
        (p) => p.enabled && p.label === identity.channel,
      );
      if (!passcode) throw new Error("渠道口令已停用，请重新登录");
      const events = await this.loaded();
      const day = quotaDay(new Date(this.now()));
      const starts = events.filter(
        (e) =>
          e.type === "run.started" &&
          e.channel === identity.channel &&
          quotaDay(new Date(e.at)) === day,
      ).length;
      if (
        passcode.maxRunsPerDay !== undefined &&
        starts >= passcode.maxRunsPerDay
      )
        throw new Error("今日国库已空");
      // Global spending admission can be added here before any model work starts.
      await this.append([{ type: "run.started", runId, ...identity }]);
    });
  }
  saved(
    saved: SavedCourtRun,
    operation: CourtOperation,
    day: number,
  ): Promise<void> {
    if (!saved.analytics) return Promise.resolve();
    const { channel, visitor, callOffset } = saved.analytics;
    const run = { channel, visitor, runId: saved.id };
    return this.serial(async () => {
      const events = await this.loaded();
      const next: AnalyticsData[] = [
        { type: "run.progress", ...run, operation, day, status: saved.status },
        {
          type: "run.usage",
          ...run,
          usage: usageTotals(saved.calls.slice(callOffset)),
        },
      ];
      if (
        saved.status === "complete" &&
        !events.some((e) => e.type === "run.completed" && e.runId === saved.id)
      )
        next.push({ type: "run.completed", ...run, day });
      await this.append(next);
    });
  }
}
