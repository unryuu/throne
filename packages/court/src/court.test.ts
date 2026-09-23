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

const lvPresentsAll: Script = (input) => ({
  inner: "都呈上去。",
  dispositions: (
    (input.inbox as { documentId: string }[] | undefined) ?? []
  ).map((d) => ({ documentId: d.documentId, action: "present" })),
});

const luRoutes =
  (channel: string): Script =>
  (input) => ({
    inner: "照实转呈。",
    routes: (
      (input.reportsAwaitingRouting as { reportId: string }[] | undefined) ?? []
    ).map((r) => ({ reportId: r.reportId, channel })),
  });

const defaultScripts: Record<string, Script> = {
  [ids.yanSong]: yanDraftsAll,
  [ids.lvFang]: lvPresentsAll,
  [ids.luBing]: luRoutes("directorate"),
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

async function play(session: CourtSession, strategy: Strategy, limit = 120) {
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
    let failure: unknown;
    for (let i = 0; i < 20 && !failure; i += 1) {
      const view = session.view;
      await session
        .submit({ audienceId: view.audience!.id, ...followAll(view, i) })
        .catch((error: unknown) => (failure = error));
    }
    expect(String(failure)).toContain("provider hiccup");
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
    for (let i = 0; i < 20 && truncated; i += 1) {
      const view = session.view;
      await session.submit({
        audienceId: view.audience!.id,
        ...followAll(view, i),
      });
    }
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

  it("lets Lü Fang return, proxy, summarise and hold papers within each party's knowledge", async () => {
    const lvGatekeeper: Script = (input) => {
      const inbox =
        (input.inbox as {
          documentId: string;
          kind: string;
          subject: string;
          returnedBefore?: number;
        }[]) ?? [];
      return {
        inner: "有的呈，有的压。",
        ...(inbox.length ? { report: "浙江诸事，奴婢都盯着。" } : {}),
        dispositions: inbox.map((d) =>
          d.subject === "奉旨督办改稻为桑疏"
            ? d.returnedBefore
              ? { documentId: d.documentId, action: "proxy" }
              : { documentId: d.documentId, action: "return", text: "再议" }
            : d.kind === "secret_memorial"
              ? {
                  documentId: d.documentId,
                  action: "summarize",
                  text: "杨金水说浙江诸事尚顺。",
                }
              : d.subject.includes("军饷")
                ? { documentId: d.documentId, action: "hold" }
                : { documentId: d.documentId, action: "present" },
        ),
      };
    };
    const scripts: Record<string, Script> = {
      ...defaultScripts,
      [ids.lvFang]: lvGatekeeper,
      [ids.hu]: (_input, count) =>
        count === 1
          ? {
              inner: "再催一次军饷。",
              documents: [
                { kind: "memorial", subject: "再请军饷疏", text: "军中缺饷。" },
              ],
            }
          : { inner: "军务要紧。" },
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(scripts).model,
    });
    const oral: string[] = [];
    let folded: { id: string; summary?: string; text: string } | undefined;
    for (let i = 0; !session.complete && i < 120; i += 1) {
      const view = session.view;
      oral.push(...view.audience!.oralReports);
      const summarised = view.audience!.documents.find((d) => d.folded);
      if (summarised && !folded) {
        folded = summarised;
        await session.act(view.audience!.id, {
          type: "reveal",
          documentId: summarised.id,
        });
        const revealed = session.view.audience!.documents.find(
          (d) => d.id === summarised.id,
        )!;
        expect(revealed.folded).toBe(false);
        expect(revealed.text).toBe("奴婢谨奏：浙江诸事尚顺。");
      }
      await session.submit({
        audienceId: view.audience!.id,
        ...followAll(session.view, i),
      });
    }
    const state = session.state;
    expect(folded).toMatchObject({
      summary: "杨金水说浙江诸事尚顺。",
      text: "",
    });
    expect(oral).toContain("浙江诸事，奴婢都盯着。");

    const zheng = Object.values(state.documents).find(
      (d) => d.subject === "奉旨督办改稻为桑疏",
    )!;
    expect(zheng.returns).toHaveLength(1);
    expect(zheng.rescript?.disposition).toBe("proxy");
    expect(zheng.onDeskAt).toBeUndefined();
    const proxied = session.view.edicts.find((e) => e.proxy)!;
    expect(proxied.subject).toContain("奉旨督办改稻为桑疏");
    const yanSaw = state.observations.filter((o) => o.actorId === ids.yanSong);
    expect(
      yanSaw.find((o) => o.kind === "returned_by_directorate")?.payload,
    ).toMatchObject({ subject: "奉旨督办改稻为桑疏", note: "再议" });
    expect(JSON.stringify(yanSaw)).toContain('"disposition":"follow_draft"');
    expect(JSON.stringify(yanSaw)).not.toContain("proxy");

    const held = Object.values(state.documents).find(
      (d) => d.subject === "再请军饷疏",
    )!;
    expect(held.directorate?.action).toBe("hold");
    expect(held.readyForRulerAt).toBeUndefined();
    expect(JSON.stringify(yanSaw)).not.toContain("再请军饷疏");
    expect(
      state.observations.some(
        (o) => o.actorId === ids.hu && o.kind === "no_reply",
      ),
    ).toBe(true);
    expect(
      state.observations.some(
        (o) => o.actorId === ids.lvFang && o.kind === "original_called_for",
      ),
    ).toBe(true);
    const lvInputs = state.decisions
      .filter((d) => d.actorId === ids.lvFang)
      .map((d) => JSON.stringify(d.input));
    expect(lvInputs.some((i) => i.includes('"returnedBefore":1'))).toBe(true);
  });

  it("routes a field report through Lu Bing, honours seclusion and interruptions, and lets the emperor talk to Lü", async () => {
    let lvInterrupted = false;
    const scripts: Record<string, Script> = {
      ...defaultScripts,
      [ids.lvFang]: (input) => {
        if (input.emperorSays !== undefined)
          return {
            inner: "皇上问起，就把压着的也呈上。",
            reply: `奴婢遵旨：${String(input.emperorSays)}`,
            dispositions: ((input.held as { documentId: string }[]) ?? []).map(
              (d) => ({ documentId: d.documentId, action: "present" }),
            ),
          };
        const inbox =
          (input.inbox as { documentId: string; from: string }[]) ?? [];
        const fromZheng = inbox.some((d) => d.from === "郑泌昌");
        const interrupt = fromZheng && !lvInterrupted;
        if (interrupt) lvInterrupted = true;
        return {
          inner: "先压一压郑泌昌的本子。",
          dispositions: inbox.map((d) => ({
            documentId: d.documentId,
            action: d.from === "郑泌昌" ? "hold" : "present",
          })),
          ...(interrupt ? { interrupt: { reason: "浙江有本章到了。" } } : {}),
        };
      },
      [ids.luBing]: (input) => ({
        inner: "此事须当面奏明。",
        routes: (
          (input.reportsAwaitingRouting as { reportId: string }[]) ?? []
        ).map((r) => ({
          reportId: r.reportId,
          channel: "direct",
          note: "臣陆炳谨呈。",
          interrupt: true,
        })),
      }),
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(scripts).model,
    });
    const first = session.view;
    await session.submit({
      audienceId: first.audience!.id,
      ...followAll(first, 0),
      specials: [
        {
          edict: {
            kind: "order_inquiry",
            params: { countyId: "jiande", agent: "jinyiwei" },
          },
        },
      ],
      seclusionDays: 30,
    });
    expect(session.view.secludedUntil).toBe(at(30, 6));

    const lvCall = session.view;
    expect(lvCall.audience!.interruption).toMatchObject({
      byName: "吕芳",
      admitted: false,
    });
    expect(lvCall.audience!.documents).toHaveLength(0);
    await expect(
      session.submit({
        audienceId: lvCall.audience!.id,
        items: [],
        specials: [],
      }),
    ).rejects.toThrow("Admit or decline");
    await session.submit({
      audienceId: lvCall.audience!.id,
      items: [],
      specials: [],
      decline: true,
    });
    expect(
      session.state.observations.some(
        (o) => o.actorId === ids.lvFang && o.kind === "interruption_declined",
      ),
    ).toBe(true);

    const luCall = session.view;
    expect(luCall.time).toBeLessThan(at(30, 6));
    expect(luCall.audience!.interruption?.byName).toBe("陆炳");
    await session.act(luCall.audience!.id, { type: "admit" });
    const desk = session.view.audience!;
    const report = desk.documents.find((d) => d.kind === "report")!;
    expect(report).toMatchObject({ direct: true, luBingNote: "臣陆炳谨呈。" });
    expect(session.view.secludedUntil).toBeUndefined();
    expect(desk.documents.some((d) => d.fromName === "郑泌昌")).toBe(false);

    const lvBefore = session.state.actors[ids.lvFang]!.lastDecisionAt;
    for (const message of ["郑泌昌的本子呢？", "都拿来。", "还有吗？"])
      await session.act(desk.id, { type: "converse", message });
    await expect(
      session.act(desk.id, { type: "converse", message: "再说一句。" }),
    ).rejects.toThrow("No more rounds");
    const talked = session.view.audience!;
    expect(talked.roundsLeft).toBe(0);
    expect(talked.conversation[1]).toEqual({
      role: "lv",
      text: "奴婢遵旨：郑泌昌的本子呢？",
    });
    expect(talked.documents.some((d) => d.fromName === "郑泌昌")).toBe(true);
    expect(session.state.actors[ids.lvFang]!.lastDecisionAt).toBe(lvBefore);

    await play(session, followAll);
    const state = session.state;
    expect(
      state.observations.some(
        (o) => o.actorId === ids.lvFang && o.kind === "direct_audience",
      ),
    ).toBe(true);
    const reportDoc = state.documents[report.id]!;
    for (const d of state.decisions.filter((d) => d.actorId === ids.lvFang))
      expect(JSON.stringify(d.input)).not.toContain(reportDoc.text);
    expect(
      state.decisions.some(
        (d) =>
          d.actorId === ids.luBing &&
          JSON.stringify(d.input).includes(reportDoc.text),
      ),
    ).toBe(true);
    expect(reportDoc.sentAt).toBe(reportDoc.arrivals[ids.luBing]! - days(6));
    expect(
      replay(
        createInitialState(runId),
        await session.records(),
        reduceCourtState,
      ),
    ).toEqual(state);
  });

  it("does not let Lu Bing sit on a field report", async () => {
    const scripts: Record<string, Script> = {
      ...defaultScripts,
      [ids.luBing]: () => ({ inner: "先放一放。" }),
    };
    const session = await startCourtSession({
      runId,
      language: "zh-CN",
      model: scriptedModel(scripts).model,
    });
    let failure: unknown;
    for (let i = 0; i < 60 && !failure; i += 1) {
      const view = session.view;
      await session
        .submit({
          audienceId: view.audience!.id,
          ...followAll(view, i),
          specials:
            i === 0
              ? [
                  {
                    edict: {
                      kind: "order_inquiry",
                      params: { countyId: "jiande", agent: "jinyiwei" },
                    },
                  },
                ]
              : [],
        })
        .catch((error: unknown) => (failure = error));
    }
    expect(String(failure)).toContain("did not route");
    expect(session.failed).toBe(true);
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
