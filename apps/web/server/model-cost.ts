import type { LiveCallTrace } from "@throne/agent-runtime/live";

/** Same historical rates as opening-pack planning, USD per million tokens. */
export function estimateCost(
  input: number,
  cachedInput: number,
  output: number,
) {
  return {
    estimatedUsdOffPeak:
      (input * 0.15 + cachedInput * 0.003 + output * 0.6) / 1e6,
    estimatedUsdPeak: (input * 0.3 + cachedInput * 0.006 + output * 1.2) / 1e6,
  };
}
export type UsageTotals = Readonly<{
  calls: number;
  cacheHits: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  unknownCalls: number;
  estimatedUsdOffPeak: number;
  estimatedUsdPeak: number;
}>;
export function usageTotals(traces: readonly LiveCallTrace[]): UsageTotals {
  const live = traces.filter((t) => !t.cached);
  const known = live.filter((t) =>
    ["inputTokens", "cacheReadTokens", "outputTokens"].every(
      (k) =>
        typeof t.usage?.[k] === "number" &&
        Number.isFinite(t.usage[k]) &&
        t.usage[k] >= 0,
    ),
  );
  const sum = (key: string) =>
    known.reduce((total, t) => total + (t.usage![key] as number), 0);
  const inputTokens = sum("inputTokens"),
    cacheReadTokens = sum("cacheReadTokens"),
    outputTokens = sum("outputTokens");
  return {
    calls: live.length,
    cacheHits: traces.length - live.length,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    unknownCalls: live.length - known.length,
    ...estimateCost(inputTokens, cacheReadTokens, outputTokens),
  };
}
