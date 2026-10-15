import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CourtModel, IntelligenceFact } from "@throne/court";
import { CourtService, type CourtSnapshot } from "./court-service.ts";

const quietModel =
  (onCall: () => void = () => {}): CourtModel =>
  async (request) => {
    onCall();
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
    const service = new CourtService(root, () => quietModel(() => calls++));
    const start = await service.create("zh-CN");
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

    const restarted = new CourtService(root, () => quietModel(() => calls++));
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
  }, 30000);

  it("keeps the audience open after an invalid submission and retries failed calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "throne-court-test-"));
    let fail = true;
    const service = new CourtService(root, () => async (request) => {
      if (fail && !request.bureau) {
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
