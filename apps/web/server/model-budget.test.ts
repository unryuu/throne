import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedCall,
  registerCallAdmission,
  type LiveCallTrace,
} from "@throne/agent-runtime/live";
import { ModelBudget, costCny } from "./model-budget.ts";
const trace: LiveCallTrace = {
  decisionEpisodeId: "test",
  requestedProvider: "test",
  requestedModel: "test",
  returnedProvider: null,
  returnedModel: null,
  thinking: "enabled",
  reasoningEffort: "high",
  thinkingObserved: true,
  status: "succeeded",
  durationMs: 1,
  usage: { inputTokens: 100000, cacheReadTokens: 100000, outputTokens: 100000 },
};
afterEach(() => vi.unstubAllEnvs());
async function root() {
  return mkdtemp(join(tmpdir(), "model-budget-"));
}
it("reserves atomically across games, settles actual tokens and retains unknown/restarted reservations until midnight", async () => {
  const dir = await root();
  let time = Date.parse("2026-10-19T15:59:00Z");
  const b = new ModelBudget(dir, 5, 3, () => time);
  const results = await Promise.allSettled([
    b.admit({ mode: "terminal-day" }),
    b.admit({ mode: "terminal-day" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: expect.objectContaining({
      message: expect.stringContaining("今日生成额度"),
    }),
  });
  const first = results.find((r) => r.status === "fulfilled")!;
  if (first.status !== "fulfilled") throw new Error("missing permit");
  expect(
    (await new ModelBudget(dir, 5, 3, () => time).snapshot()).heldCny,
  ).toBe(5);
  expect(costCny(trace)).toBeCloseTo(1.004);
  await first.value.finish(trace);
  expect((await b.snapshot()).spentCny).toBeCloseTo(1.004);
  const unknown = await b.admit({ mode: "text" });
  await unknown.finish(undefined);
  expect(
    (await new ModelBudget(dir, 5, 3, () => time).snapshot()).spentCny,
  ).toBeCloseTo(1.504);
  // A process killed after admission cannot make its unknown spend disappear.
  await b.admit({ mode: "text" });
  const restart = new ModelBudget(dir, 5, 3, () => time);
  expect((await restart.snapshot()).heldCny).toBe(0.5);
  time += 60000;
  expect(await restart.snapshot()).toMatchObject({
    day: "2026-10-20",
    spentCny: 0,
    heldCny: 0,
  });
  const tomorrow = await restart.admit({ mode: "terminal-day" });
  await tomorrow.finish(trace);
});
it("queues model misses, releases slots on errors, and leaves exact cache hits usable after budget exhaustion", async () => {
  const dir = await root();
  const b = new ModelBudget(dir, 1, 1);
  const unregister = registerCallAdmission(dir, b.admit);
  let calls = 0;
  const call = (prompt: string) =>
    cachedCall({
      root: dir,
      episode: prompt,
      request: { mode: "text", prompt },
      onTrace: () => {},
      run: async (emit) => {
        calls++;
        emit(trace);
        return "saved";
      },
    });
  try {
    await call("cached");
    expect(await call("cached")).toBe("saved");
    await expect(call("new")).rejects.toThrow("今日生成额度");
    expect(calls).toBe(1);
    expect(b.pressure()).toMatchObject({ waiting: 0, active: 0 });
  } finally {
    unregister();
  }
  const q = new ModelBudget(await root(), 50, 1);
  const p = await q.admit({});
  const queued = q.admit({});
  expect(q.pressure().waiting).toBe(1);
  await p.finish(trace);
  const next = await queued;
  expect(q.pressure()).toMatchObject({ waiting: 0, active: 1 });
  await next.finish(undefined);
  expect(q.pressure().active).toBe(0);
});
it("rejects damaged ledgers instead of resetting spend", async () => {
  const dir = await root();
  const b = new ModelBudget(dir);
  const p = await b.admit({});
  await p.finish(trace);
  const path = join(dir, "runs/budget/events.jsonl");
  await writeFile(path, (await readFile(path, "utf8")) + "broken\n");
  await expect(new ModelBudget(dir).snapshot()).rejects.toThrow(
    "events.jsonl:3",
  );
});
