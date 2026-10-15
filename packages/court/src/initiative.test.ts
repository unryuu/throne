import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replay } from "@throne/sim-core";
import type { JsonObject, SimulationRecord } from "@throne/shared-types";
import { at, dayOf } from "./calendar.ts";
import { buildChronicle } from "./chronicle.ts";
import { createInitialState, ids, travelDays } from "./jiajing.ts";
import { reduceCourtState } from "./model.ts";
import { buildNpcInput, type CourtModel } from "./npc.ts";
import { draftProblem, edictProblem } from "./rules.ts";
import { startCourtSession, type CourtSession } from "./session.ts";
import { shellFiles } from "./shell.ts";

const runId = "initiative-test";
const idle: CourtModel = async () => JSON.stringify({ inner: "静候。" });
const close = (s: CourtSession, skipEmptyAudiences = false) =>
  s.submit({
    audienceId: s.view.audience!.id,
    items: [],
    specials: [],
    skipEmptyAudiences,
  });
const restore = async (s: CourtSession, model = idle) =>
  startCourtSession({
    runId,
    language: "zh-CN",
    model,
    records: await s.records(),
  });

describe("imperial initiative", () => {
  it("wakes all six at day zero, lets Zhejiang act on day one without letters and replays exactly", async () => {
    const s = await startCourtSession({
      runId,
      language: "zh-CN",
      model: idle,
    });
    const actors = Object.values(s.state.actors).filter(
      (a) => a.llm && a.active,
    );
    expect(actors).toHaveLength(6);
    expect(actors.every((a) => dayOf(a.nextDecisionAt!) === 1)).toBe(true);
    const restored = await restore(s);
    await close(restored);
    expect(restored.state.decisions.map((d) => d.actorId).sort()).toEqual(
      actors.map((a) => a.id).sort(),
    );
    expect(restored.state.decisions.every((d) => dayOf(d.at) === 1)).toBe(true);
    expect(Object.values(restored.state.documents)).toHaveLength(2);
    expect(
      replay(
        createInitialState(runId),
        await restored.records(),
        reduceCourtState,
      ),
    ).toEqual(restored.state);
  });

  it("delivers questions by distance, wakes recipients, exposes them only on receipt and routes free-choice replies", async () => {
    const replied = new Set<string>();
    const model: CourtModel = async ({ input }) => {
      const actorId = String(input.actorId);
      const reply =
        (input.imperialQuestions as JsonObject[]).length > 0 &&
        !replied.has(actorId);
      if (reply) replied.add(actorId);
      return JSON.stringify({
        inner: "如实不如保身。",
        documents: reply
          ? [
              {
                kind: actorId === ids.hu ? "secret_memorial" : "memorial",
                subject: "奉垂询回奏",
                text: "堤防无虞。",
              },
            ]
          : [],
        ...(actorId === ids.yanSong
          ? {
              drafts: (input.memorialsAwaitingYourDraft as JsonObject[]).map(
                (d) => ({
                  memorialId: d.memorialId,
                  edict: { kind: "acknowledge", params: {} },
                  text: "知道了。",
                }),
              ),
            }
          : {}),
        ...(actorId === ids.lvFang
          ? {
              dispositions: (input.inbox as JsonObject[]).map((d) => ({
                documentId: d.documentId,
                action: "present",
              })),
            }
          : {}),
      });
    };
    const s = await startCourtSession({ runId, language: "zh-CN", model });
    const targets = s.view.options.questionable.map((a) => a.id);
    await s.submit({
      audienceId: s.view.audience!.id,
      items: [],
      specials: targets.map((actorId) => ({
        edict: {
          kind: "request_memorial",
          params: { actorId, question: "改桑与堤防如何？" },
        },
      })),
    });
    const edicts = Object.values(s.state.documents).filter(
      (d) => d.edict?.kind === "request_memorial",
    );
    expect(edicts).toHaveLength(6);
    for (const doc of edicts) {
      const id = String(doc.edict!.params.actorId);
      expect(doc.toIds).toEqual([id]);
      expect(doc.arrivals[id]).toBe(
        at(0, 6) +
          travelDays("beijing", s.state.actors[id]!.location, "edict") * 12,
      );
    }
    expect(
      buildNpcInput(s.state, ids.hu, s.view.time, runId, "zh-CN")
        .imperialQuestions,
    ).toEqual([]);
    while (s.view.time < at(20)) await close(s);
    expect(replied.size).toBe(6);
    for (const doc of edicts) {
      const id = String(doc.edict!.params.actorId);
      const decision = s.state.decisions.find(
        (d) =>
          d.actorId === id &&
          (d.input.imperialQuestions as JsonObject[]).length,
      )!;
      expect(decision.at).toBeGreaterThan(doc.arrivals[id]!);
      const text = shellFiles(decision.input).get("/desk/皇帝垂询.txt")!;
      expect(text).toContain("改桑与堤防如何？");
      expect(text).toContain("皇上亲问");
      expect(text).toContain("是否回奏");
    }
    const replies = Object.values(s.state.documents).filter(
      (d) => d.subject === "奉垂询回奏",
    );
    expect(replies).toHaveLength(6);
    for (const doc of replies) {
      expect(doc.readyForRulerAt).toBeDefined();
      if (doc.fromId === ids.hu) {
        expect(doc.draft).toBeUndefined();
        expect(doc.deliveredTo).not.toContain(ids.yanSong);
      } else if (doc.fromId !== ids.yanSong) expect(doc.draft).toBeDefined();
    }
    const chronicle = buildChronicle({
      id: runId,
      status: "waiting",
      state: s.state,
      records: await s.records(),
      calls: [],
    });
    expect(chronicle.days[0]!.ruler).toContainEqual(
      expect.objectContaining({
        type: "edict",
        subject: "垂询胡宗宪：改桑与堤防如何？",
      }),
    );
    expect(
      replay(createInitialState(runId), await s.records(), reduceCourtState),
    ).toEqual(s.state);
  });

  it("stops skipping when a memorial reaches the throne, after the cabinet and Directorate", async () => {
    const model: CourtModel = async ({ input }) =>
      JSON.stringify({
        inner: "照常办事。",
        documents:
          input.actorId === ids.hu &&
          (input.imperialQuestions as JsonObject[]).length
            ? [{ kind: "memorial", subject: "回奏堤防", text: "请加固。" }]
            : [],
        ...(input.actorId === ids.yanSong
          ? {
              drafts: (input.memorialsAwaitingYourDraft as JsonObject[]).map(
                (d) => ({
                  memorialId: d.memorialId,
                  edict: { kind: "acknowledge", params: {} },
                  text: "知道了。",
                }),
              ),
            }
          : {}),
        ...(input.actorId === ids.lvFang
          ? {
              dispositions: (input.inbox as JsonObject[]).map((d) => ({
                documentId: d.documentId,
                action: "present",
              })),
            }
          : {}),
      });
    const s = await startCourtSession({ runId, language: "zh-CN", model });
    // Ask Hu while disposing of Yan's memorial: the question must only go to Hu.
    await s.submit({
      audienceId: s.view.audience!.id,
      items: [
        {
          documentId: ids.policyMemorial,
          disposition: "custom",
          edict: {
            kind: "request_memorial",
            params: { actorId: ids.hu, question: "堤防如何？" },
          },
        },
      ],
      specials: [],
      skipEmptyAudiences: true,
    });
    expect(s.complete).toBe(false);
    expect(s.view.audience!.documents.map((d) => d.subject)).toEqual([
      "回奏堤防",
    ]);
    expect(s.view.audience!.documents[0]!.draft).toBeDefined();
    expect(s.view.audience!.oralReports).toEqual([]);
    expect(s.view.time).toBeGreaterThan(at(14));
    expect(
      Object.values(s.state.documents).find(
        (d) => d.edict?.kind === "request_memorial",
      )!.toIds,
    ).toEqual([ids.hu]);
  });

  it("rejects empty questions, inactive or non-player targets and cabinet proxies", () => {
    const state = createInitialState(runId);
    const edict = {
      kind: "request_memorial" as const,
      params: { actorId: ids.hu, question: "堤防如何？" },
    };
    expect(edictProblem(state, edict)).toBeUndefined();
    for (const params of [
      { ...edict.params, question: " " },
      { ...edict.params, actorId: ids.shen },
      { ...edict.params, question: "问".repeat(601) },
    ])
      expect(edictProblem(state, { ...edict, params })).toBeDefined();
    expect(
      edictProblem(
        {
          ...state,
          actors: {
            ...state.actors,
            [ids.hu]: { ...state.actors[ids.hu]!, active: false },
          },
        },
        edict,
      ),
    ).toBeDefined();
    expect(draftProblem(state, edict)).toContain("皇帝亲发");
  });

  it("skips empty days until oral business and preserves that intent through failure/restart", async () => {
    let fail = true;
    const model: CourtModel = async ({ input }) => {
      if (
        input.actorId === ids.lvFang &&
        (input.imperialQuestions as JsonObject[]).length
      ) {
        if (fail) throw new Error("provider unavailable");
        return JSON.stringify({ inner: "答皇上。", report: "臣候旨。" });
      }
      return JSON.stringify({ inner: "静候。" });
    };
    const s = await startCourtSession({ runId, language: "zh-CN", model });
    await close(s); // Day one opening decisions finish without replies.
    await expect(
      s.submit({
        audienceId: s.view.audience!.id,
        items: [],
        specials: [
          {
            edict: {
              kind: "request_memorial",
              params: { actorId: ids.lvFang, question: "何事？" },
            },
          },
        ],
        skipEmptyAudiences: true,
      }),
    ).rejects.toThrow("provider unavailable");
    expect(s.state.skipEmptyAudiences).toBe(true);
    fail = false;
    const resumed = await restore(s, model);
    await resumed.retry();
    expect(resumed.view.audience!.oralReports).toEqual(["臣候旨。"]);
    expect(resumed.state.skipEmptyAudiences).toBeUndefined();
    await close(resumed, true); // Silence is allowed; stop at the end, never fabricate a reply.
    expect(resumed.complete).toBe(true);
    expect(
      (await resumed.records()).some(
        (r) =>
          r.kind === "committed" && r.event.eventType === "court.empty_skipped",
      ),
    ).toBe(true);
    expect(
      buildChronicle({
        id: runId,
        status: "complete",
        state: resumed.state,
        records: await resumed.records(),
        calls: [],
      }).complete,
    ).toBe(true);
  });

  it("reads, resumes and exports an actual legacy opening without injecting new opening wakes", async () => {
    const legacy = JSON.parse(
      readFileSync(
        new URL("./fixtures/legacy-opening.json", import.meta.url),
        "utf8",
      ),
    ) as { id: string; records: SimulationRecord[] };
    let calls = 0;
    const s = await startCourtSession({
      runId: legacy.id,
      language: "zh-CN",
      records: legacy.records,
      model: async () => {
        calls++;
        return idle({} as never);
      },
    });
    expect(s.view.time).toBe(at(0, 6));
    expect(s.state).toEqual(
      replay(createInitialState(legacy.id), legacy.records, reduceCourtState),
    );
    await close(s);
    expect(calls).toBe(1); // Cabinet receives the original papers' hold notices.
    expect(s.view.time).toBe(at(1, 6));
    expect(s.state.decisions.map((d) => d.actorId)).toEqual([ids.yanSong]);
    const c = buildChronicle({
      id: legacy.id,
      status: "waiting",
      state: s.state,
      records: await s.records(),
      calls: [],
    });
    expect(c.days[0]!.ruler[0]).toMatchObject({
      type: "audience",
      papers: [{ id: ids.policyMemorial }, { id: ids.armyMemorial }],
    });
  });
});
