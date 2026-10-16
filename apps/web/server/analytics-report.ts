import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  analyticsPath,
  readAnalytics,
  type AnalyticsEvent,
} from "./analytics.ts";
import { usageTotals, type UsageTotals } from "./model-cost.ts";

export function sinceTimestamp(since?: string): number {
  if (since === undefined) return -Infinity;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
    !Number.isFinite(Date.parse(since)) ||
    new Date(since).toISOString().slice(0, 10) !== since
  )
    throw new Error("--since 必须是有效日期 YYYY-MM-DD（北京时间零点起）");
  return Date.parse(`${since}T00:00:00+08:00`);
}
export function summarizeAnalytics(
  events: readonly AnalyticsEvent[],
  since?: string,
) {
  const start = sinceTimestamp(since);
  type Group = {
    visitors: Set<string>;
    logins: number;
    runs: Set<string>;
    usage: UsageTotals;
  };
  const groups = new Map<string, Group>();
  const days = new Map<string, number>();
  const completed = new Set<string>();
  const owners = new Map<string, string>();
  const previousUsage = new Map<string, UsageTotals>();
  const group = (channel: string) => {
    let value = groups.get(channel);
    if (!value) {
      value = {
        visitors: new Set(),
        logins: 0,
        runs: new Set(),
        usage: usageTotals([]),
      };
      groups.set(channel, value);
    }
    return value;
  };
  let failures = 0;
  for (const event of events) {
    const included = Date.parse(event.at) >= start;
    if (event.type === "auth.failure") {
      if (included) failures++;
      continue;
    }
    if ("runId" in event) {
      const owner = owners.get(event.runId);
      if (owner !== undefined && owner !== event.channel)
        throw new Error(`Analytics channel changed for run ${event.runId}`);
      owners.set(event.runId, event.channel);
    }
    if (event.type === "run.progress" || event.type === "run.completed")
      days.set(event.runId, Math.max(days.get(event.runId) ?? 0, event.day));
    if (event.type === "run.completed") completed.add(event.runId);
    if (event.type === "run.usage") {
      const previous = previousUsage.get(event.runId) ?? usageTotals([]);
      const delta = Object.fromEntries(
        Object.entries(event.usage).map(([key, value]) => {
          const difference = value - previous[key as keyof UsageTotals];
          if (difference < -1e-10)
            throw new Error(
              `Analytics cumulative usage decreased for run ${event.runId}`,
            );
          return [key, Math.max(0, difference)];
        }),
      ) as UsageTotals;
      previousUsage.set(event.runId, event.usage);
      if (included) {
        const g = group(event.channel);
        g.usage = Object.fromEntries(
          Object.entries(delta).map(([k, v]) => [
            k,
            g.usage[k as keyof UsageTotals] + v,
          ]),
        ) as UsageTotals;
      }
    }
    if (!included) continue;
    const g = group(event.channel);
    g.visitors.add(event.visitor);
    if (event.type === "auth.login") g.logins++;
    if (event.type === "run.started") g.runs.add(event.runId);
  }
  return {
    failures,
    rows: [...groups]
      .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
      .map(([channel, g]) => ({
        channel,
        visitors: g.visitors.size,
        logins: g.logins,
        runs: g.runs.size,
        averageDay: g.runs.size
          ? [...g.runs].reduce((sum, id) => sum + (days.get(id) ?? 0), 0) /
            g.runs.size
          : null,
        completionRate: g.runs.size
          ? [...g.runs].filter((id) => completed.has(id)).length / g.runs.size
          : null,
        unsettledRuns: [...g.runs].filter((id) => !previousUsage.has(id))
          .length,
        ...g.usage,
      })),
  };
}

export function formatAnalytics(
  report: ReturnType<typeof summarizeAnalytics>,
  since?: string,
): string {
  const lines = [
    `渠道统计｜${since ? `${since} 起` : "全部记录"}（北京时间）`,
    "| 渠道 | 访客 | 登录 | 开局 | 平均日数 | 结局率 | 模型调用 | token | 估算 US$ | 用量未知调用 | 未回写局 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.rows.map(
      (r) =>
        `| ${r.channel.replaceAll("|", "\\|")} | ${r.visitors} | ${r.logins} | ${r.runs} | ${r.averageDay?.toFixed(1) ?? "—"} | ${r.completionRate === null ? "—" : `${(r.completionRate * 100).toFixed(1)}%`} | ${r.calls} | ${r.inputTokens + r.cacheReadTokens + r.outputTokens} | ${r.estimatedUsdOffPeak.toFixed(6)}–${r.estimatedUsdPeak.toFixed(6)} | ${r.unknownCalls} | ${r.unsettledRuns} |`,
    ),
    `登录失败：${report.failures}（不归因渠道）。`,
    "访客按匿名 cookie 去重；平均日数/结局率按期间开局至今的进展。模型调用按整日/文本调用计，排除指纹命中；token 为未缓存输入+缓存输入+输出（含推理）。费用为期间新增的已知用量，不含未知或未回写部分，沿用开局包 2026-10-15 历史低谷/高峰单价。",
  ];
  if (!report.rows.length) lines.push("暂无渠道记录。");
  return lines.join("\n");
}
export async function analyticsReport(root: string, args: readonly string[]) {
  if (args.length > 1 || args.some((arg) => !arg.startsWith("--since=")))
    throw new Error("用法：analytics-report.ts [--since=YYYY-MM-DD]");
  const since = args[0]?.slice("--since=".length);
  sinceTimestamp(since);
  return formatAnalytics(
    summarizeAnalytics(await readAnalytics(analyticsPath(root)), since),
    since,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      await analyticsReport(
        fileURLToPath(new URL("../../..", import.meta.url)),
        process.argv.slice(2),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
