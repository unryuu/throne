import { describe, expect, it } from "vitest";
import type { JsonObject } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import { at, days, roll } from "./calendar.ts";
import { createInitialState, ids } from "./jiajing.ts";
import { reduceCourtState, type RescriptSubmission } from "./model.ts";
import type { CourtModel, CourtModelRequest } from "./npc.ts";
import { startCourtSession, type CourtSession } from "./session.ts";
import type { CourtState } from "./types.ts";

type Script = (input: JsonObject, count: number) => JsonObject;

function scriptedModel(scripts: Record<string, Script>) {
  const calls: CourtModelRequest[] = [];
  const model: CourtModel = async (request) => {
    calls.push(request);
    const input = JSON.parse(request.prompt.split("\n\n")[1]!) as JsonObject;
    const actorId = String(input.actorId);
    const count = Number(request.decisionEpisodeId.split(":").at(-1));
    const output = scripts[actorId]?.(input, count) ?? {
      inner: "静观其变。",
    };
    return "```json\n" + JSON.stringify(output) + "\n```";
  };
  return { model, calls };
}

const yanDraftsAll: Script = (input) => ({
  inner: "先照常票拟。",
  drafts: (
    (input.memorialsAwaitingYourDraft as { memorialId: string }[]) ?? []
  ).map((m) => ({
    memorialId: m.memorialId,
    edict: { kind: "acknowledge", params: {} },
    text: "知道了。",
  })),
});

const defaultScripts: Record<string, Script> = {
  [ids.yanSong]: yanDraftsAll,
  [ids.zheng]: (_input, count) =>
    count === 1
      ? {
          inner: "限期紧，百姓不卖。建德的堤，只好让它自己决。",
          documents: [
            {
              kind: "memorial",
              subject: "奉旨督办改稻为桑疏",
              text: "臣已督率各县，务使百姓得价，不敢扰民。",
            },
            {
              kind: "letter",
              to: [ids.yang, "胡宗宪"],
              subject: "密函",
              text: "端午之后田价自落。",
            },
          ],
          actions: [
            { capabilityId: "breach_dike", parameters: { countyId: "jiande" } },
            {
              capabilityId: "buy_land",
              parameters: { countyId: "chunan", mu: 10, price: "low" },
            },
            { capabilityId: "summon_rain", parameters: {} },
          ],
        }
      : { inner: "且看局势。" },
  [ids.hu]: (input) =>
    JSON.stringify(input.observations).includes("决口")
      ? {
          inner: "去建德看看。",
          actions: [
            {
              capabilityId: "inspect_county",
              parameters: { countyId: "jiande" },
            },
          ],
        }
      : { inner: "军务要紧。" },
  [ids.yang]: (_input, count) =>
    count === 1
      ? {
          inner: "先给干爹递个话。",
          documents: [
            {
              kind: "secret_memorial",
              subject: "织造局密奏",
              text: "奴婢谨奏：浙江诸事尚顺。",
            },
          ],
          actions: [
            { capabilityId: "breach_dike", parameters: { countyId: "tonglu" } },
          ],
        }
      : { inner: "静观。" },
};

type Strategy = (
  view: CourtSession["view"],
  index: number,
) => Omit<RescriptSubmission, "audienceId">;

const followAll: Strategy = (view) => ({
  items: view.audience!.documents.map((d) =>
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

async function play(session: CourtSession, strategy: Strategy, limit = 40) {
  for (let i = 0; !session.complete && i < limit; i += 1) {
    const view = session.view;
    if (view.phase !== "audience") throw new Error("Expected an audience");
    await session.submit({
      audienceId: view.audience!.id,
      ...strategy(view, i),
    });
  }
  expect(session.complete).toBe(true);
}

const runId = "11111111-2222-3333-4444-555555555555";

describe("court session", () => {
  it("opens with the scripted cabinet memorials and hides every private layer", async () => {
    const { model, calls } = scriptedModel(defaultScripts);
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    const view = session.view;
    expect(view.phase).toBe("audience");
    expect(view.time).toBe(at(0, 6));
    expect(view.audience!.documents.map((d) => d.id)).toEqual([
      ids.policyMemorial,
      ids.armyMemorial,
    ]);
    expect(view.audience!.documents[0]!.draft!.edict.kind).toBe(
      "approve_policy",
    );
    expect(calls).toHaveLength(0);
    const text = JSON.stringify(view);
    for (const hidden of ["inner", "observations", "dikeIntegrity", "严世蕃"])
      expect(text).not.toContain(hidden);
  });

  it("plays a whole run with delays, isolation, consequences and exact replay", async () => {
    const { model, calls } = scriptedModel(defaultScripts);
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    await play(session, followAll);
    const state = session.state;

    const approval = Object.values(state.documents).find(
      (d) => d.edict?.kind === "approve_policy",
    )!;
    expect(approval.arrivals[ids.zheng]).toBe(at(0, 6) + days(6));
    expect(state.policy.status).toBe("approved");

    const zhengFirst = state.decisions.find((d) => d.actorId === ids.zheng)!;
    expect(zhengFirst.at).toBeGreaterThan(approval.arrivals[ids.zheng]!);
    const zhengInput = JSON.stringify(zhengFirst.input);
    expect(zhengInput).toContain("严世蕃");
    expect(zhengInput).not.toContain("先给干爹递个话");
    expect(zhengInput).not.toContain("吕公公传话");

    const actions = Object.values(state.actions);
    expect(
      actions.find(
        (a) => a.capabilityId === "breach_dike" && a.actorId === ids.yang,
      )?.status,
    ).toBe("impossible");
    expect(state.gaps.map((g) => g.capabilityId)).toEqual(["summon_rain"]);
    expect(state.counties.jiande.breach).toBe("sabotage");
    expect(state.counties.chunan.mulberryMu).toBeGreaterThan(0);
    expect(state.counties.chunan.annexedMu).toBe(
      state.counties.chunan.mulberryMu,
    );

    const strength = Math.round((0.5 + 0.4 * roll(runId, "flood")) * 100) / 100;
    expect(state.flood.strength).toBe(strength);
    expect(state.counties.tonglu.breach).toBe(
      strength > 0.85 ? "flood" : undefined,
    );

    const huInspection = actions.find(
      (a) => a.capabilityId === "inspect_county",
    );
    expect(huInspection?.status).toBe("succeeded");
    const found = roll(runId, `${huInspection!.id}:ev-0`) < 0.7;
    expect(state.evidence[0]!.discoveredBy.includes(ids.hu)).toBe(found);

    const secret = Object.values(state.documents).find(
      (d) => d.kind === "secret_memorial",
    )!;
    expect(secret.deliveredTo).not.toContain(ids.yanSong);
    expect(secret.arrivals[ids.ruler]).toBe(secret.sentAt + days(5));
    expect(session.view.archive.some((d) => d.id === secret.id)).toBe(true);
    expect(JSON.stringify(session.view)).not.toContain("端午之后田价自落");
    const letter = Object.values(state.documents).find(
      (d) => d.kind === "letter",
    )!;
    expect(letter.toIds).toEqual([ids.yang, ids.hu]);

    const records = await session.records();
    const callCount = calls.length;
    expect(
      replay(createInitialState(runId), records, reduceCourtState),
    ).toEqual(state);
    expect(calls).toHaveLength(callCount);
    expect(state.summary?.deaths).toBeGreaterThan(0);
  });

  it("retries only the failed call and restores a saved run without new calls", async () => {
    const { model: base, calls } = scriptedModel(defaultScripts);
    let fail = true;
    const model: CourtModel = async (request) => {
      if (fail && request.decisionEpisodeId === "court:zheng-bichang:1") {
        fail = false;
        await base(request);
        throw new Error("provider hiccup");
      }
      return base(request);
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    const first = session.view;
    await expect(
      session.submit({
        audienceId: first.audience!.id,
        ...followAll(first, 0),
      }),
    ).rejects.toThrow("provider hiccup");
    const before = calls.length;
    await session.retry();
    const retried = calls.slice(before).map((c) => c.decisionEpisodeId);
    expect(calls.slice(0, before).map((c) => c.decisionEpisodeId)).toContain(
      "court:yang-jinshui:1",
    );
    expect(retried[0]).toBe("court:zheng-bichang:1");
    expect(retried).not.toContain("court:yang-jinshui:1");
    await expect(session.retry()).rejects.toThrow("no failed step");
    expect(session.view.phase).toBe("audience");

    const saved = await session.records();
    const callsAtSave = calls.length;
    const restored = await startCourtSession({
      runId,
      language: "zh-CN",
      model: async () => {
        throw new Error("restore must not call the model");
      },
      records: saved,
    });
    expect(restored.view).toEqual(session.view);
    expect(calls).toHaveLength(callsAtSave);

    const uninterrupted = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(defaultScripts).model,
    });
    await play(uninterrupted, followAll);
    const resumed = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(defaultScripts).model,
      records: saved,
    });
    await play(resumed, followAll);
    expect(resumed.state).toEqual(uninterrupted.state);
    expect(await resumed.records()).toEqual(await uninterrupted.records());
  });

  it("re-asks once when a reply is malformed instead of caching it", async () => {
    const { model: base } = scriptedModel(defaultScripts);
    let truncated = true;
    const model: CourtModel = async (request) => {
      if (truncated && request.decisionEpisodeId === "court:zheng-bichang:1") {
        truncated = false;
        return '{"inner":"写到一半';
      }
      return base(request);
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    const first = session.view;
    await session.submit({
      audienceId: first.audience!.id,
      ...followAll(first, 0),
    });
    expect(truncated).toBe(false);
    expect(session.state.decisions.some((d) => d.actorId === ids.zheng)).toBe(
      true,
    );
  });

  it("lets a repair finished before the flood undo sabotage but keeps the evidence", async () => {
    const scripts = {
      ...defaultScripts,
      [ids.zheng]: ((_input, count) =>
        count === 1
          ? {
              inner: "先掘后补。",
              actions: [
                {
                  capabilityId: "breach_dike",
                  parameters: { countyId: "jiande" },
                },
              ],
            }
          : count === 2
            ? {
                inner: "还是补上罢。",
                actions: [
                  {
                    capabilityId: "repair_dike",
                    parameters: { countyId: "jiande" },
                  },
                ],
              }
            : { inner: "静观。" }) as Script,
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(scripts).model,
    });
    let sent = false;
    await play(session, (view, index) => {
      const base = followAll(view, index);
      if (sent || view.time < at(36)) return base;
      sent = true;
      const inquiry = {
        kind: "order_inquiry" as const,
        params: { countyId: "jiande", agent: "jinyiwei" },
      };
      return { ...base, specials: [{ edict: inquiry }] };
    });
    const state = session.state;
    expect(state.counties.jiande.dikeSabotaged).toBe(false);
    expect(state.counties.jiande.breach).toBeUndefined();
    expect(state.evidence).toHaveLength(1);
    const inquiryId = (await session.records()).flatMap((r) =>
      r.kind === "scheduled" && r.event.eventType === "jinyiwei.arrive"
        ? [String(r.event.payload.inquiryId)]
        : [],
    )[0];
    const report = Object.values(state.documents).find(
      (d) => d.fromId === ids.jinyiwei,
    )!;
    expect(report.text).toContain("大堤无恙");
    expect(report.text).not.toContain("非天灾");
    expect(report.text.includes("后已补修")).toBe(
      roll(runId, `${inquiryId}:ev-0`) < 0.7,
    );
    expect(roll(runId, `${inquiryId}:ev-0`)).toBeLessThan(0.7);
  });

  it("tells an author when a memorial is held, and arrest hands the province to Hu", async () => {
    const { model } = scriptedModel(defaultScripts);
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    await play(session, (view, index) => {
      const approve = followAll(view, index);
      if (index > 0)
        return {
          items: view.audience!.documents.map((d) => ({
            documentId: d.id,
            disposition: "hold" as const,
          })),
          specials:
            index === 1
              ? [
                  {
                    edict: {
                      kind: "arrest" as const,
                      params: { actorId: ids.zheng },
                    },
                    text: "郑泌昌欺君罔上，着即拿问。",
                  },
                ]
              : [],
        };
      return approve;
    });
    const state = session.state;
    expect(state.actors[ids.zheng]!.active).toBe(false);
    expect(state.actors[ids.hu]!.capabilities).toContain("relief_granary");
    const final = state.decisions
      .filter((d) => d.actorId === ids.zheng)
      .at(-1)!;
    expect(final.final).toBe(true);
    expect(JSON.stringify(final.input)).toContain("着即拿问");
    expect(
      state.observations.some(
        (o) => o.kind === "no_reply" && o.actorId === ids.zheng,
      ),
    ).toBe(true);
    expect(session.view.options.arrestable.map((a) => a.id)).not.toContain(
      ids.zheng,
    );
  });

  it("stops regular decisions at the cost guard but still gives an arrested minister his last word", async () => {
    const { model } = scriptedModel(defaultScripts);
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
      decisionBudget: 3,
    });
    await play(session, (view, index) =>
      index === 1
        ? {
            items: [],
            specials: [
              {
                edict: { kind: "arrest", params: { actorId: ids.zheng } },
                text: "着即拿问。",
              },
            ],
          }
        : followAll(view, index),
    );
    const state = session.state;
    expect(state.decisions.filter((d) => !d.final)).toHaveLength(3);
    const final = state.decisions.filter((d) => d.final);
    expect(final.map((d) => d.actorId)).toEqual([ids.zheng]);
    expect(state.counters.cappedWakes).toBeGreaterThan(0);
    expect(state.summary?.cappedWakes).toBe(state.counters.cappedWakes);
    expect(session.view.cappedWakes).toBe(state.counters.cappedWakes);
  });

  it("reports the inundated area and keeps merchant grain apart from official relief", async () => {
    let bought = false;
    const scripts: Record<string, Script> = {
      ...defaultScripts,
      [ids.zheng]: (input, count) => {
        if (count === 1)
          return {
            inner: "建德的堤，让它自己决。",
            actions: [
              {
                capabilityId: "breach_dike",
                parameters: { countyId: "jiande" },
              },
            ],
          };
        if (bought || !JSON.stringify(input.observations).includes("决口"))
          return { inner: "静观。" };
        bought = true;
        return {
          inner: "水退之前把淹田收了。",
          actions: [
            {
              capabilityId: "buy_land",
              parameters: { countyId: "jiande", mu: 10, price: "fair" },
            },
            {
              capabilityId: "relief_merchant",
              parameters: { countyId: "jiande", amount: 5 },
            },
          ],
        };
      },
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(scripts).model,
    });
    let sent = false;
    await play(session, (view, index) => {
      const base = followAll(view, index);
      if (sent || view.time < at(42)) return base;
      sent = true;
      return {
        ...base,
        specials: [
          {
            edict: {
              kind: "order_inquiry",
              params: { countyId: "jiande", agent: "jinyiwei" },
            },
          },
        ],
      };
    });
    const jiande = session.state.counties.jiande;
    expect(jiande.inundatedMu).toBe(24.5);
    expect(jiande.floodedMu).toBe(9.5);
    expect(jiande.merchantGrainDelivered).toBe(5);
    const report = Object.values(session.state.documents).find(
      (d) => d.fromId === ids.jinyiwei,
    )!;
    expect(report.text).toContain("受淹田约24.5万亩");
    expect(report.text).toContain(
      `官府累计放赈${jiande.reliefDelivered}万石；沈一石以粮换田，出粮5万石。`,
    );
  });

  it("rejects submissions that reference documents off the desk or decide the policy twice", async () => {
    const { model } = scriptedModel(defaultScripts);
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model,
    });
    const audienceId = session.view.audience!.id;
    await expect(
      session.submit({
        audienceId,
        items: [
          { documentId: ids.policyMemorial, disposition: "follow_draft" },
        ],
        specials: [{ edict: { kind: "approve_policy", params: {} } }],
      }),
    ).rejects.toThrow("policy already decided");
    await expect(
      session.submit({
        audienceId,
        items: [{ documentId: "doc-99", disposition: "hold" }],
        specials: [],
      }),
    ).rejects.toThrow("not on the desk");
    expect(session.view.phase).toBe("audience");
  });
});

export type { CourtState };
