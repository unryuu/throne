import { describe, expect, it } from "vitest";
import { replay } from "@throne/sim-core";
import { buildChronicle } from "./chronicle.ts";
import { createInitialState, ids } from "./jiajing.ts";
import { reduceCourtState } from "./model.ts";
import {
  buildNpcInput,
  systemPrompt,
  conversationSystemPrompt,
  type CourtModel,
  type CourtModelRequest,
} from "./npc.ts";
import { parsePonder, parseSummaries } from "./information.ts";
import { registerInstruction } from "./preferences.ts";
import { shellSystemPrompt } from "./shell.ts";
import { startCourtSession, type CourtSession } from "./session.ts";
import type { IntelligenceFact } from "./types.ts";

const quiet: CourtModel = async (r) => {
  if (r.summaries)
    return JSON.stringify({
      summaries: (r.input.texts as string[]).map(
        () => "想让皇帝掏钱，还想少担责任",
      ),
    });
  if (r.ponder)
    return "朕看这人是来要钱的。按规矩要户部核实，可开了这口子，别处都来讨要，国库还撑得住吗？这衙门近来倒很会喊穷，先问清旧账，免得耽误朕修玄。";
  if (r.bureau)
    return JSON.stringify({
      reports: (r.input.facts as unknown as IntelligenceFact[]).map((f) => ({
        id: f.id,
        title: f.titles[0],
        text: f.claim,
      })),
    });
  return JSON.stringify({
    inner: "实情标记：我偷偷毁堤，绝不能让皇帝知道",
    reply: "奴婢只听说没有事情。",
  });
};
const close = (s: CourtSession) =>
  s.submit({ audienceId: s.view.audience!.id, items: [], specials: [] });

describe("ADR 0011", () => {
  it("batches summaries, reads freely at zero energy, charges pondering and only the first conversation round, and replays without models", async () => {
    const requests: CourtModelRequest[] = [];
    const s = await startCourtSession({
      runId: "ponder",
      language: "zh-CN",
      model: async (r) => {
        requests.push(r);
        return quiet(r);
      },
    });
    expect(s.view.settings).toEqual({ register: "classical", summaries: true });
    expect(s.view.energy).toBe(2);
    const a = s.view.audience!;
    const doc = a.documents[0]!;
    expect(doc.gloss).toBeUndefined();
    expect(requests.filter((r) => r.summaries)).toHaveLength(1);
    expect(Object.keys(requests.find((r) => r.summaries)!.input)).toEqual([
      "texts",
    ]);
    await expect(
      s.act(a.id, { type: "ponder", documentId: doc.id }),
    ).rejects.toThrow("展开");
    await s.act(a.id, { type: "open_message", documentId: doc.id });
    expect(s.view.energy).toBe(2);
    expect(s.view.audience!.documents[0]!.gloss).toContain("掏钱");
    const before = buildNpcInput(
      s.state,
      ids.lvFang,
      s.view.time,
      "ponder",
      "zh-CN",
    );
    await s.act(a.id, { type: "ponder", documentId: doc.id });
    expect(s.view.energy).toBe(1);
    expect(s.view.audience!.documents[0]!.ponders).toHaveLength(1);
    expect(
      buildNpcInput(s.state, ids.lvFang, s.view.time, "ponder", "zh-CN"),
    ).toEqual(before);
    await s.act(a.id, { type: "converse", message: "哪里要钱？" });
    await s.act(a.id, { type: "converse", message: "接着说。" });
    await s.act(a.id, { type: "converse", message: "还有吗？" });
    expect(s.view.energy).toBe(0);
    await expect(
      s.act(a.id, { type: "converse", message: "第四轮" }),
    ).rejects.toThrow("rounds");
    await expect(
      s.act(a.id, { type: "ponder", documentId: doc.id }),
    ).rejects.toThrow("精力");
    await expect(
      s.submit({
        audienceId: a.id,
        items: [],
        specials: [{ edict: { kind: "acknowledge", params: {} } }],
      }),
    ).rejects.toThrow("精力");
    await s.act(a.id, { type: "open_message", documentId: a.documents[1]!.id });
    expect(s.view.energy).toBe(0);
    const records = await s.records();
    expect(
      replay(createInitialState("ponder"), records, reduceCourtState),
    ).toEqual(s.state);
    const restored = await startCourtSession({
      runId: "ponder",
      language: "zh-CN",
      records,
      model: async () => {
        throw new Error("must not call during restore");
      },
    });
    expect(restored.view).toEqual(s.view);
    const c = buildChronicle({
      id: "ponder",
      status: "waiting",
      records,
      state: s.state,
      calls: [],
    });
    expect(
      c.days[0]!.ruler.some(
        (e) => e.type === "ponder" && e.text.includes("户部"),
      ),
    ).toBe(true);
    await close(s);
    expect(s.view.energy).toBe(2);
    expect(requests.filter((r) => r.summaries)).toHaveLength(2);
    expect(s.view.conversations).toHaveLength(3);
    const unreadArchive = s.view.archive.find((d) => !d.opened)!;
    await s.act(s.view.audience!.id, {
      type: "open_message",
      documentId: unreadArchive.id,
    });
    expect(s.view.energy).toBe(2);
  });

  it("sends only the emperor's view to ponder: no truth, private thoughts, original behind a summary, or rumor metadata", async () => {
    const requests: CourtModelRequest[] = [];
    const s = await startCourtSession({
      runId: "privacy",
      language: "zh-CN",
      model: async (r) => {
        requests.push(r);
        if (r.bureau || r.summaries || r.ponder) return quiet(r);
        return JSON.stringify({
          inner: "PRIVATE_THOUGHT_DO_NOT_LEAK",
          reply: "谈话可见",
          documents:
            r.input.actorId === ids.yanSong
              ? [
                  {
                    kind: "memorial",
                    subject: "隐蔽原文",
                    text: "HIDDEN_ORIGINAL_DO_NOT_LEAK",
                  },
                ]
              : [],
          dispositions:
            r.input.actorId === ids.lvFang
              ? (r.input.inbox as { documentId: string }[]).map((d) => ({
                  documentId: d.documentId,
                  action: "summarize",
                  text: "吕芳只说一切平安",
                }))
              : [],
        });
      },
    });
    await close(s);
    await close(s);
    expect(s.state.decisions.length).toBeGreaterThan(0);
    expect(s.state.information!.facts.length).toBeGreaterThan(0);
    const a = s.view.audience!;
    const doc = a.documents.find((d) => d.subject === "隐蔽原文")!;
    await s.act(a.id, { type: "open_message", documentId: doc.id });
    await s.act(a.id, { type: "converse", message: "旧账呢？" });
    await s.act(a.id, { type: "ponder", documentId: doc.id });
    const request = requests.find((r) => r.ponder)!;
    const wire = JSON.stringify(request);
    for (const secret of [
      "PRIVATE_THOUGHT_DO_NOT_LEAK",
      "HIDDEN_ORIGINAL_DO_NOT_LEAK",
      '"actual"',
      '"true"',
      '"category"',
      '"factId"',
      '"rumorIds"',
      '"evidence"',
      '"counties"',
      '"decisions"',
      '"inner"',
    ])
      expect(wire).not.toContain(secret);
    // Slow-changing context first, the pondered paper last, for the prompt cache.
    expect(Object.keys(request.input)[0]).toBe("archive");
    expect(Object.keys(request.input).at(-1)).toBe("document");
    expect(request.prompt).toContain("吕芳只说一切平安");
    expect(request.prompt).toContain("旧账呢");
    const { ponders: _, ...visible } = s.view.audience!.documents.find(
      (d) => d.id === doc.id,
    )!;
    expect(request.input.document).toEqual(visible);
    expect(
      JSON.stringify(requests.filter((r) => r.summaries).map((r) => r.input)),
    ).not.toContain("HIDDEN_ORIGINAL_DO_NOT_LEAK");
    await s.act(a.id, { type: "reveal", documentId: doc.id });
    expect(s.view.energy).toBe(0);
    expect(s.view.audience!.documents.find((d) => d.id === doc.id)!.text).toBe(
      "HIDDEN_ORIGINAL_DO_NOT_LEAK",
    );
  });

  it("never calls disabled summaries; persists settings and propagates all three registers", async () => {
    for (const register of ["classical", "plain", "modern"] as const) {
      const requests: CourtModelRequest[] = [];
      const s = await startCourtSession({
        runId: register,
        language: "zh-CN",
        settings: { register, summaries: false },
        model: async (r) => {
          requests.push(r);
          return quiet(r);
        },
      });
      expect(requests.some((r) => r.summaries)).toBe(false);
      const instruction = registerInstruction(register);
      for (const actor of [ids.yanSong, ids.lvFang, ids.luBing, ids.hu]) {
        expect(systemPrompt(s.state, actor, "zh-CN")).toContain(instruction);
        expect(
          shellSystemPrompt(
            buildNpcInput(s.state, actor, s.view.time, register, "zh-CN"),
          ),
        ).toContain(instruction);
      }
      expect(conversationSystemPrompt(s.state, "zh-CN")).toContain(instruction);
      expect(requests.find((r) => r.bureau)!.systemPrompt).toContain(
        instruction,
      );
      if (register === "modern")
        expect(s.state.documents[ids.policyMemorial]!.text).toContain(
          "请皇上裁定",
        );
      const restored = await startCourtSession({
        runId: register,
        language: "zh-CN",
        model: quiet,
        records: await s.records(),
        settings: { register: "classical", summaries: true },
      });
      expect(restored.state.settings).toEqual({ register, summaries: false });
    }
  });

  it("uses modern fixed edict and Guard-report text without changing their effects", async () => {
    const s = await startCourtSession({
      runId: "modern-fixed",
      language: "zh-CN",
      settings: { register: "modern", summaries: false },
      decisionBudget: 0,
      model: quiet,
    });
    await s.submit({
      audienceId: s.view.audience!.id,
      items: [],
      specials: [
        {
          edict: {
            kind: "order_inquiry",
            params: { countyId: "jiande", agent: "jinyiwei" },
          },
        },
      ],
    });
    expect(s.view.edicts[0]!.text).toBe("立即调查，如实汇报。");
    for (let i = 0; i < 14; i++) await close(s);
    const report = Object.values(s.state.documents).find(
      (d) => d.fromId === ids.jinyiwei,
    )!;
    expect(report.text).toContain("臣等奉旨调查了建德");
    expect(report.text).toContain("官府累计发放救济粮0万石");
    expect(report.text).not.toContain("谨奏");
    expect(
      replay(
        createInitialState("modern-fixed", 0),
        await s.records(),
        reduceCourtState,
      ),
    ).toEqual(s.state);
  });

  it("retries failed ponder after restart without losing energy or making up results", async () => {
    const s = await startCourtSession({
      runId: "failed-ponder",
      language: "zh-CN",
      model: async (r) => {
        if (r.ponder) throw new Error("offline");
        return quiet(r);
      },
    });
    const a = s.view.audience!;
    const id = a.documents[0]!.id;
    await s.act(a.id, { type: "open_message", documentId: id });
    await expect(
      s.act(a.id, { type: "ponder", documentId: id }),
    ).rejects.toThrow("offline");
    expect(s.view.energy).toBe(2);
    expect(s.state.documents[id]!.ponders).toBeUndefined();
    const restored = await startCourtSession({
      runId: "failed-ponder",
      language: "zh-CN",
      records: await s.records(),
      model: quiet,
    });
    expect(restored.failed).toBe(true);
    await restored.retry();
    expect(restored.view.energy).toBe(1);
    expect(restored.state.documents[id]!.ponders).toHaveLength(1);
    expect(
      replay(
        createInitialState("failed-ponder"),
        await restored.records(),
        reduceCourtState,
      ),
    ).toEqual(restored.state);
  });

  it("persists the presented batch before summaries, and retries just that call after restart", async () => {
    let error: unknown;
    const s = await startCourtSession({
      runId: "failed-summary",
      language: "zh-CN",
      model: async (r) => {
        if (r.summaries) throw new Error("summary offline");
        return quiet(r);
      },
      onInitialFailure: (e) => {
        error = e;
      },
    });
    expect(String(error)).toContain("summary offline");
    expect(s.failed).toBe(true);
    const documents = s.state.documents;
    const requests: CourtModelRequest[] = [];
    const restored = await startCourtSession({
      runId: "failed-summary",
      language: "zh-CN",
      records: await s.records(),
      model: async (r) => {
        requests.push(r);
        return quiet(r);
      },
    });
    await restored.retry();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.summaries).toBe(true);
    expect(restored.view.energy).toBe(2);
    for (const d of Object.values(documents))
      expect(restored.state.documents[d.id]!.text).toBe(d.text);
  });

  it("rejects malformed or empty assistant output without imposing content templates", () => {
    expect(parseSummaries('{"summaries":["远房宗室找你要钱"]}', 1)).toEqual([
      "远房宗室找你要钱",
    ]);
    expect(() => parseSummaries('{"summaries":[""]}', 1)).toThrow();
    expect(() => parseSummaries('{"summaries":[]}', 1)).toThrow();
    expect(() => parsePonder(" ")).toThrow();
  });
});

it("keeps the author note outside the emperor's monologue in events, replay, view and spectator", async () => {
  const s = await startCourtSession({
    runId: "author-note",
    language: "zh-CN",
    model: (r) =>
      r.ponder
        ? Promise.resolve(
            "朕得问清旧账。\n\n游戏作者注：明代内阁票拟，通常仍须经皇帝或司礼监批红。",
          )
        : quiet(r),
  });
  const documentId = s.view.audience!.documents[0]!.id;
  await s.act(s.view.audience!.id, { type: "open_message", documentId });
  await s.act(s.view.audience!.id, { type: "ponder", documentId });
  const ponder = s.view.audience!.documents[0]!.ponders![0]!;
  expect(ponder.text).toBe("朕得问清旧账。");
  expect(ponder.authorNote).toContain("内阁票拟");
  const records = await s.records();
  expect(
    replay(createInitialState("author-note"), records, reduceCourtState),
  ).toEqual(s.state);
  const chronicle = buildChronicle({
    status: "waiting",
    id: "author-note",
    state: s.state,
    records,
    calls: [],
  });
  expect(JSON.stringify(chronicle)).toContain('"authorNote":"明代内阁票拟');
});
