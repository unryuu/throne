import { describe, expect, it } from "vitest";
import {
  simTime,
  type JsonObject,
  type SimulationRecord,
} from "@throne/shared-types";
import { buildChronicle, type ChronicleSource } from "./chronicle.ts";
import { ids } from "./jiajing.ts";
import type { CourtModel } from "./npc.ts";
import { startCourtSession } from "./session.ts";

const runId = "22222222-3333-4444-5555-666666666666";
const breachThought = "田价不落，建德的堤只好让它自己决。";

const model: CourtModel = async (request) => {
  const input = JSON.parse(request.prompt.split("\n\n")[1]!) as JsonObject;
  const first = request.decisionEpisodeId.endsWith(":1");
  const output =
    input.actorId === ids.zheng && first
      ? {
          inner: breachThought,
          documents: [
            { kind: "memorial", subject: "督办改桑疏", text: "臣已修堤备汛。" },
          ],
          actions: [
            { capabilityId: "breach_dike", parameters: { countyId: "jiande" } },
          ],
        }
      : input.actorId === ids.yanSong
        ? {
            inner: "照常票拟。",
            drafts: (
              (input.memorialsAwaitingYourDraft as
                { memorialId: string }[] | undefined) ?? []
            ).map((m) => ({
              memorialId: m.memorialId,
              edict: { kind: "acknowledge", params: {} },
              text: "知道了。",
            })),
          }
        : input.actorId === ids.lvFang
          ? {
              inner: "都呈上去。",
              dispositions: (
                (input.inbox as { documentId: string }[] | undefined) ?? []
              ).map((d) => ({ documentId: d.documentId, action: "present" })),
            }
          : { inner: "静观其变。" };
  return "```json\n" + JSON.stringify(output) + "\n```";
};

async function playedRun(): Promise<ChronicleSource> {
  const session = await startCourtSession({ runId, language: "zh-CN", model });
  for (let i = 0; !session.complete && i < 200; i += 1) {
    const audience = session.view.audience!;
    await session.submit({
      audienceId: audience.id,
      items: audience.documents.map((d) =>
        d.draft
          ? { documentId: d.id, disposition: "follow_draft" as const }
          : {
              documentId: d.id,
              disposition: "custom" as const,
              edict: { kind: "acknowledge" as const, params: {} },
            },
      ),
      specials: [],
    });
  }
  expect(session.complete).toBe(true);
  return {
    id: runId,
    status: "complete",
    records: await session.records(),
    state: session.state,
    calls: [],
  };
}

describe("chronicle", () => {
  it("splits each day into what the emperor saw and what happened", async () => {
    const source = await playedRun();
    const chronicle = buildChronicle(source);
    expect(chronicle.complete).toBe(true);

    const opening = chronicle.days[0]!.ruler[0]!;
    expect(
      opening.type === "audience" && opening.papers.map((p) => p.id),
    ).toEqual([ids.policyMemorial, ids.armyMemorial]);
    expect(
      opening.type === "audience" && opening.papers[0]!.rescript?.disposition,
    ).toBe("follow_draft");

    const decision = chronicle.days
      .flatMap((d) => d.truth)
      .find((e) => e.type === "decision" && e.actor === ids.zheng);
    expect(decision).toMatchObject({
      thought: breachThought,
      office: "浙江巡抚",
      documents: [{ kind: "memorial", to: ["嘉靖"], text: "臣已修堤备汛。" }],
      actions: [{ capability: "breach_dike", county: "建德" }],
    });
    const truth = JSON.stringify(chronicle.days.map((d) => d.truth));
    expect(truth).toContain("暗中掘开建德大堤");
    const ruler = JSON.stringify(chronicle.days.map((d) => d.ruler));
    expect(ruler).not.toContain(breachThought);
    expect(ruler).toContain("臣已修堤备汛。");

    const last = chronicle.days.at(-1)!.world;
    expect(last.counties.find((c) => c.id === "jiande")!.dikeSabotaged).toBe(
      true,
    );
    expect(last.granary).toBe(source.state.granary);
  });

  it("refuses a run whose numbers or events it cannot account for", async () => {
    const source = await playedRun();
    expect(() =>
      buildChronicle({
        ...source,
        state: { ...source.state, granary: source.state.granary + 1 },
      }),
    ).toThrow(/granary folds to/);

    const mystery: SimulationRecord = {
      kind: "committed",
      event: {
        id: "x",
        occurredAt: simTime(1),
        eventType: "court.mystery",
        payload: {},
      },
    };
    expect(() =>
      buildChronicle({ ...source, records: [...source.records, mystery] }),
    ).toThrow(/unhandled event court.mystery/);
  });
});
