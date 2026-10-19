import { registerCallAdmission } from "@throne/agent-runtime/live";
import { ModelBudget } from "./model-budget.ts";
import { Analytics, analyticsPath, readAnalytics } from "./analytics.ts";
import { usageTotals } from "./model-cost.ts";
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CourtModel, IntelligenceFact } from "@throne/court";
import { CourtService, type CourtSnapshot } from "./court-service.ts";

const quietModel =
  (onCall: () => void = () => {}): CourtModel =>
  async (request) => {
    onCall();
    if (request.summaries)
      return JSON.stringify({
        summaries: (request.input.texts as string[]).map(() => "想让皇帝做主"),
      });
    if (request.ponder) return "朕得想想。";
    if (request.bureau)
      return JSON.stringify({
        reports: (request.input.facts as unknown as IntelligenceFact[]).map(
          (f) => ({
            id: f.id,
            title: f.titles[0],
            opening: "通政司谨汇：",
            closing: "谨奏。",
          }),
        ),
      });
    const input = JSON.parse(request.prompt.split("\n\n")[1]!) as {
      memorialsAwaitingYourDraft?: { memorialId: string }[];
    };
    return JSON.stringify({
      inner: "心里另有盘算。",
      reply: "奴婢在。",
      documents: [
        { kind: "letter", to: "actor:yan-song", subject: "私函", text: "密。" },
      ],
      drafts: (input.memorialsAwaitingYourDraft ?? []).map((m) => ({
        memorialId: m.memorialId,
        edict: { kind: "acknowledge", params: {} },
        text: "知道了。",
      })),
    });
  };

async function finish(service: CourtService, snapshot: CourtSnapshot) {
  let current = snapshot;
  for (let i = 0; current.status === "waiting" && i < 120; i += 1) {
    const audience = current.view.audience!;
    current = await service.submit(current.id, {
      audienceId: audience.id,
      items: audience.documents.map((d) => ({
        documentId: d.id,
        disposition: d.draft || d.hasDraft ? "follow_draft" : "hold",
      })),
      specials: [],
    });
  }
  return current;
}

describe("court service", () => {
  it("saves every step, restores after restart and replays without calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "throne-court-test-"));
    let calls = 0;
    await mkdir(join(root, "secret"));
    await writeFile(
      join(root, "secret/passcodes.json"),
      JSON.stringify([{ label: "渠道A", code: "a", enabled: true }]),
    );
    const analytics = new Analytics(root);
    const service = new CourtService(
      root,
      () => quietModel(() => calls++),
      undefined,
      analytics,
    );
    const start = await service.create(
      "zh-CN",
      {},
      { attribution: { channel: "渠道A", visitor: "v1" } },
    );
    expect(start.status).toBe("waiting");
    const first = start.view.audience!;
    const talked = await service.act(start.id, first.id, {
      type: "converse",
      message: "浙江的事怎么样了？",
    });
    expect(talked.view.audience!.conversation).toEqual([
      { role: "ruler", text: "浙江的事怎么样了？" },
      { role: "lv", text: "奴婢在。" },
    ]);
    const after = await service.submit(start.id, {
      audienceId: first.id,
      items: first.documents.map((d) => ({
        documentId: d.id,
        disposition: d.draft || d.hasDraft ? "follow_draft" : "hold",
      })),
      specials: [],
    });
    expect(JSON.stringify(after)).not.toContain("心里另有盘算");
    await expect(service.review(start.id)).rejects.toThrow("after the reign");

    const restarted = new CourtService(
      root,
      () => quietModel(() => calls++),
      undefined,
      new Analytics(root),
    );
    const restored = await restarted.get(start.id);
    expect(restored.view).toEqual(after.view);
    const done = await finish(restarted, restored);
    expect(done.status).toBe("complete");

    const callsBefore = calls;
    const review = await restarted.review(start.id);
    expect(review.state.decisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(review.state)).toContain("心里另有盘算");
    expect((await restarted.replay(start.id)).verified).toBe(true);
    expect(calls).toBe(callsBefore);
    const raw = await readFile(
      join(root, "runs", "court", `${start.id}.json`),
      "utf8",
    );
    expect(raw).not.toContain("sk-");
    const events = await readAnalytics(analyticsPath(root));
    expect(events.filter((e) => e.type === "run.started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "run.completed")).toEqual([
      expect.objectContaining({
        runId: start.id,
        channel: "渠道A",
        visitor: "v1",
        day: Math.floor(done.view.time / 12),
      }),
    ]);
    expect(
      events.some((e) => e.type === "run.progress" && e.operation === "act"),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "run.progress" && e.operation === "rescript" && e.day > 0,
      ),
    ).toBe(true);
    expect(events.filter((e) => e.type === "run.usage").at(-1)).toMatchObject({
      usage: usageTotals(review.calls),
    });
    expect(await readAnalytics(analyticsPath(root))).toHaveLength(
      events.length,
    );
  }, 30000);

  it("keeps the audience open after an invalid submission and retries failed calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "throne-court-test-"));
    let fail = true;
    const service = new CourtService(root, () => async (request) => {
      if (fail && !request.bureau && !request.summaries) {
        fail = false;
        throw new Error("provider unavailable");
      }
      return quietModel()(request);
    });
    const start = await service.create("zh-CN");
    const audience = start.view.audience!;
    const invalid = await service.submit(start.id, {
      audienceId: audience.id,
      items: [],
      specials: [
        { edict: { kind: "arrest", params: { actorId: "actor:yan-song" } } },
      ],
    });
    expect(invalid.status).toBe("waiting");
    expect(invalid.error).toContain("invalid target");
    const failed = await service.submit(start.id, {
      audienceId: audience.id,
      items: [{ documentId: "doc-policy", disposition: "follow_draft" }],
      specials: [],
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("provider unavailable");
    const resumed = await new CourtService(root, () => quietModel()).retry(
      start.id,
    );
    expect(resumed.status).toBe("waiting");
    expect(resumed.view.audience!.id).not.toBe(audience.id);
  });
});

it("saves a failed opening composition and resumes it after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "throne-inbox-failure-"));
  const service = new CourtService(root, () => async () => {
    throw new Error("opening offline");
  });
  const failed = await service.create("zh-CN");
  expect(failed.status).toBe("failed");
  expect(failed.error).toContain("opening offline");
  const raw = JSON.parse(
    await readFile(join(root, "runs", "court", `${failed.id}.json`), "utf8"),
  );
  expect(
    raw.state.information.facts.some(
      (f: { channel: string }) => f.channel === "bureau",
    ),
  ).toBe(true);
  const restored = new CourtService(root, () => quietModel());
  const ready = await restored.retry(failed.id);
  expect(ready.status).toBe("waiting");
  expect(ready.view.audience!.documents.length).toBeGreaterThanOrEqual(5);
});

it("does not attribute historical costs on GET and binds a legacy run only on its first write", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-legacy-"));
  const original = new CourtService(root, () => quietModel());
  const start = await original.create("zh-CN");
  const history = original.entries.get(start.id)!.calls.length;
  const service = new CourtService(
    root,
    () => quietModel(),
    undefined,
    new Analytics(root),
  );
  const restored = await service.get(start.id);
  expect(await readAnalytics(analyticsPath(root))).toEqual([]);
  const after = await service.act(
    start.id,
    restored.view.audience!.id,
    { type: "converse", message: "今日如何？" },
    { channel: "旧局渠道", visitor: "v2" },
  );
  expect(after.error).toBeUndefined();
  const events = await readAnalytics(analyticsPath(root));
  expect(events.some((e) => e.type === "run.started")).toBe(false);
  expect(events.find((e) => e.type === "run.usage")).toMatchObject({
    channel: "旧局渠道",
    usage: usageTotals(service.entries.get(start.id)!.calls.slice(history)),
  });
  const saved = JSON.parse(
    await readFile(join(root, "runs/court", `${start.id}.json`), "utf8"),
  );
  expect(saved.analytics).toEqual({
    channel: "旧局渠道",
    visitor: "v2",
    callOffset: history,
  });
});

it("opens more than fifty games and restores evicted saved sessions without replaying model calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "court-many-games-"));
  let calls = 0;
  const service = new CourtService(root, () => quietModel(() => calls++));
  const first = await service.create("zh-CN");
  for (let i = 0; i < 50; i++) await service.create("zh-CN");
  expect(service.entries.size).toBeLessThanOrEqual(50);
  expect(service.entries.has(first.id)).toBe(false);
  const before = calls;
  const restored = await service.get(first.id);
  expect(restored.view).toEqual(first.view);
  expect(calls).toBe(before);
  expect(service.entries.size).toBeLessThanOrEqual(50);
});

it("persists a budget-paused opening and resumes it after Beijing midnight using its cached successful work", async () => {
  const root = await mkdtemp(join(tmpdir(), "court-budget-resume-"));
  let time = Date.parse("2026-10-19T15:59:00Z"),
    calls = 0;
  const budget = new ModelBudget(root, 0.5, 3, () => time);
  const unregister = registerCallAdmission(root, budget.admit);
  const factory = () => quietModel(() => calls++);
  try {
    const service = new CourtService(root, factory, "budget-resume-test");
    const paused = await service.create("zh-CN");
    expect(paused.status).toBe("failed");
    expect(paused.error).toContain("今日生成额度");
    expect(calls).toBe(1);
    const restarted = new CourtService(root, factory, "budget-resume-test");
    expect((await restarted.get(paused.id)).status).toBe("failed");
    time += 60000;
    const resumed = await restarted.retry(paused.id);
    expect(resumed.status).toBe("waiting");
    expect(resumed.view.audience).toBeDefined();
    expect(calls).toBe(2);
    const saved = JSON.parse(
      await readFile(join(root, "runs/court", paused.id + ".json"), "utf8"),
    );
    expect(
      saved.records.filter(
        (r: { kind: string; event: { eventType: string } }) =>
          r.kind === "committed" &&
          r.event.eventType === "information.bureau_composed",
      ),
    ).toHaveLength(1);
  } finally {
    unregister();
  }
});
