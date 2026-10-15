import { describe, expect, it } from "vitest";
import { replay } from "@throne/sim-core";
import { at, dayOf } from "./calendar.ts";
import { buildChronicle } from "./chronicle.ts";
import { generateFacts, parseBureau } from "./information.ts";
import { createInitialState, ids } from "./jiajing.ts";
import { reduceCourtState } from "./model.ts";
import { buildNpcInput, type CourtModel } from "./npc.ts";
import { energyAvailable } from "./rules.ts";
import { startCourtSession, type CourtSession } from "./session.ts";
import type { IntelligenceFact } from "./types.ts";

const bureau: CourtModel = async (request) =>
  JSON.stringify({
    reports: (request.input.facts as unknown as IntelligenceFact[]).map(
      (f) => ({
        id: f.id,
        title: f.titles[0],
        opening: "通政司谨汇：",
        closing: "谨奏。",
      }),
    ),
  });
const quiet: CourtModel = async (r) =>
  r.bureau ? bureau(r) : JSON.stringify({ inner: "静候", reply: "奴婢在。" });
const start = (model = quiet) =>
  startCourtSession({ runId: "inbox-test", language: "zh-CN", model });
const close = (s: CourtSession) =>
  s.submit({ audienceId: s.view.audience!.id, items: [], specials: [] });

describe("imperial information", () => {
  it("charges actual reading, archives unread papers without leaking bodies, and replays energy and reads", async () => {
    const s = await start();
    const a = s.view.audience!;
    expect(a.documents.length).toBeGreaterThanOrEqual(5);
    expect(a.documents.length).toBeLessThanOrEqual(10);
    expect(s.view.energy).toBe(3);
    expect(
      a.documents.every(
        (d) => d.opened === false && d.text === "" && d.draft === undefined,
      ),
    ).toBe(true);
    const doc = a.documents[0]!;
    await s.act(a.id, { type: "open_message", documentId: doc.id });
    expect(s.view.energy).toBe(2);
    expect(s.view.audience!.documents[0]!.text).not.toBe("");
    await expect(
      s.act(a.id, { type: "open_message", documentId: doc.id }),
    ).rejects.toThrow();
    await s.act(a.id, { type: "converse", message: "今日如何" });
    await s.act(a.id, { type: "converse", message: "接着说" });
    expect(s.view.energy).toBe(1);
    await s.submit({
      audienceId: a.id,
      items: a.documents
        .filter((d) => d.draft || d.hasDraft)
        .map((d) => ({ documentId: d.id, disposition: "follow_draft" })),
      specials: [
        {
          edict: {
            kind: "request_memorial",
            params: { actorId: ids.hu, question: "堤上如何" },
          },
        },
      ],
    });
    expect(s.view.energy).toBe(3);
    expect(
      s.view.archive
        .filter((d) => d.opened === false)
        .every((d) => d.text === ""),
    ).toBe(true);
    const records = await s.records();
    expect(
      records.some(
        (r) =>
          r.kind === "committed" &&
          r.event.eventType === "information.reading_closed",
      ),
    ).toBe(true);
    expect(
      replay(createInitialState("inbox-test"), records, reduceCourtState),
    ).toEqual(s.state);
    const restored = await startCourtSession({
      runId: "inbox-test",
      language: "zh-CN",
      model: quiet,
      records,
    });
    expect(restored.view).toEqual(s.view);
    const c = buildChronicle({
      id: "inbox-test",
      status: "waiting",
      records,
      state: s.state,
      calls: [],
    });
    const papers = c.days[0]!.ruler.flatMap((e) =>
      e.type === "audience" ? e.papers : [],
    );
    expect(papers.find((p) => p.id === doc.id)?.opened).toBe(true);
    expect(
      papers.filter((p) => p.opened === false).every((p) => p.text === ""),
    ).toBe(true);
    expect(
      c.days[0]!.truth.some(
        (t) => t.type === "intelligence" && typeof t.fact.true === "boolean",
      ),
    ).toBe(true);
  });

  it("blocks overspending before submission, leaves follow-draft free and does not reveal read status to actors", async () => {
    const s = await start();
    const a = s.view.audience!;
    const before = buildNpcInput(
      s.state,
      ids.lvFang,
      at(0, 6),
      "inbox-test",
      "zh-CN",
    );
    for (const d of a.documents.slice(0, 3))
      await s.act(a.id, { type: "open_message", documentId: d.id });
    expect(s.view.energy).toBe(0);
    await expect(
      s.submit({
        audienceId: a.id,
        items: [
          {
            documentId: ids.policyMemorial,
            disposition: "follow_draft",
            text: "借依拟之名另发命令",
          },
        ],
        specials: [],
      }),
    ).rejects.toThrow("改写票拟");
    expect(
      buildNpcInput(s.state, ids.lvFang, at(0, 6), "inbox-test", "zh-CN"),
    ).toEqual(before);
    await expect(
      s.act(a.id, { type: "open_message", documentId: a.documents[3]!.id }),
    ).rejects.toThrow("精力");
    await expect(
      s.submit({
        audienceId: a.id,
        items: [],
        specials: [{ edict: { kind: "acknowledge", params: {} } }],
      }),
    ).rejects.toThrow("精力");
    await s.submit({
      audienceId: a.id,
      items: a.documents
        .filter((d) => d.draft || d.hasDraft)
        .map((d) => ({ documentId: d.id, disposition: "follow_draft" })),
      specials: [],
    });
    expect(s.view.energy).toBe(3);
  });

  it("delivers free briefs directly, rejects duplicates and invalid lengths, and wakes the three without mail", async () => {
    const model: CourtModel = async (r) => {
      if (r.bureau) return bureau(r);
      return JSON.stringify({
        inner: "瞒下半句",
        documents: r.input.briefInstruction
          ? [
              {
                kind: "brief",
                subject: "堤上无事",
                text: "平安",
                ...(r.input.actorId === ids.luBing
                  ? { rumorIds: [(r.input.rumors as { id: string }[])[0]!.id] }
                  : {}),
              },
              { kind: "brief", subject: "再报", text: "再报" },
            ]
          : [],
      });
    };
    const s = await start(model);
    await close(s);
    const briefs = s.view.audience!.documents.filter((d) => d.kind === "brief");
    expect(briefs).toHaveLength(3);
    for (const b of briefs) {
      expect(s.state.documents[b.id]!.directorate).toBeUndefined();
      expect(energyAvailable(s.state, b.fromId, s.view.time)).toBe(3);
      if (b.fromId === ids.luBing)
        expect(s.state.documents[b.id]!.rumorIds).toHaveLength(1);
    }
    expect(
      s.state.decisions.filter((d) =>
        d.rejected.some((r) => String(r.reason).includes("条子")),
      ),
    ).toHaveLength(3);
    await close(s);
    expect(
      s.state.decisions.filter((d) => dayOf(d.at) === 2).map((d) => d.actorId),
    ).toEqual([ids.lvFang]);
    await close(s);
    expect(
      s.state.decisions.filter((d) => dayOf(d.at) === 3).map((d) => d.actorId),
    ).toEqual(expect.arrayContaining([ids.lvFang, ids.yanSong, ids.luBing]));
  });

  it("generates seeded truths, false claims and vague leaks, exposing no labels to Lu Bing", async () => {
    const state = createInitialState("facts");
    const facts = generateFacts(state, 7, "bureau", 100);
    expect(generateFacts(state, 7, "bureau", 100)).toEqual(facts);
    expect(facts.some((f) => f.category === "routine")).toBe(true);
    expect(facts.some((f) => !f.true)).toBe(true);
    expect(facts.some((f) => f.true && f.vague)).toBe(true);
    for (const f of facts.filter((f) => !f.true))
      expect(f.claim).not.toBe(f.actual);
    const s = await start();
    await close(s);
    const input = buildNpcInput(
      s.state,
      ids.luBing,
      s.view.time,
      "inbox-test",
      "zh-CN",
    );
    const rumors = input.rumors as { id: string; text: string }[];
    expect(rumors.length).toBeGreaterThanOrEqual(2);
    expect(
      rumors.every(
        (r) => !Object.hasOwn(r, "true") && !Object.hasOwn(r, "actual"),
      ),
    ).toBe(true);
    expect(
      s.state
        .information!.facts.filter((f) => f.channel === "rumor")
        .every((f) => typeof f.true === "boolean"),
    ).toBe(true);
    // The clerk writes freely; old-format saves still read; gaps fall back to the gist.
    const [a, b] = facts;
    const reports = parseBureau(
      JSON.stringify({
        reports: [
          { id: a!.id, title: "严州府米价腾贵", text: "据报米价三日一涨。" },
          {
            id: b!.id,
            title: "旧式",
            opening: "通政司谨汇：",
            closing: "谨奏。",
          },
          { id: "invented", title: "x", text: "y" },
        ],
      }),
      facts.slice(0, 3),
    );
    expect(reports.map((r) => r.text)).toEqual([
      "据报米价三日一涨。",
      `通政司谨汇：${b!.claim}谨奏。`,
      facts[2]!.claim,
    ]);
    for (const f of facts)
      expect(f.claim).not.toMatch(/%|0\.|(?<![0-9.])0(?![0-9.])万/);
  });

  it("persists facts before a failed composition and retries the same edition", async () => {
    let fail = false;
    const s = await start(async (r) => {
      if (r.bureau && fail) throw new Error("provider failed");
      return quiet(r);
    });
    fail = true;
    await expect(close(s)).rejects.toThrow("provider failed");
    const facts = s.state.information!.facts;
    expect(facts.some((f) => f.channel === "bureau" && f.day === 1)).toBe(true);
    const restored = await startCourtSession({
      runId: "inbox-test",
      language: "zh-CN",
      model: quiet,
      records: await s.records(),
    });
    await restored.retry();
    expect(restored.state.information!.facts).toEqual(facts);
    expect(restored.view.audience!.documents.length).toBeGreaterThanOrEqual(5);
  });
});

it("persists an admitted interruption's facts before calling and can resume it", async () => {
  let fail = false;
  const model: CourtModel = async (r) => {
    if (r.bureau) {
      if (fail) throw new Error("offline");
      return bureau(r);
    }
    return JSON.stringify({ inner: "要禀报", interrupt: { reason: "有事" } });
  };
  const s = await start(model);
  await s.submit({
    audienceId: s.view.audience!.id,
    items: [],
    specials: [],
    seclusionDays: 5,
  });
  expect(s.view.audience!.interruption?.admitted).toBe(false);
  fail = true;
  await expect(s.act(s.view.audience!.id, { type: "admit" })).rejects.toThrow(
    "offline",
  );
  const facts = s.state.information!.facts;
  fail = false;
  await s.retry();
  expect(s.state.information!.facts).toEqual(facts);
  expect(s.view.audience!.interruption?.admitted).toBe(true);
  expect(s.view.audience!.documents.length).toBeGreaterThanOrEqual(5);
});

it("charges a summarized original separately and never tells Lü which paper was read", async () => {
  const s = await start(async (r) => {
    if (r.bureau) return bureau(r);
    return JSON.stringify({
      inner: "只说一半",
      documents:
        r.input.actorId === ids.yanSong
          ? [{ kind: "memorial", subject: "真账", text: "正文是秘闻" }]
          : [],
      dispositions:
        r.input.actorId === ids.lvFang
          ? (r.input.inbox as { documentId: string }[]).map((d) => ({
              documentId: d.documentId,
              action: "summarize",
              text: "只报平安",
            }))
          : [],
    });
  });
  await close(s);
  await close(s);
  const doc = s.view.audience!.documents.find((d) => d.subject === "真账")!;
  expect(doc).toBeDefined();
  const before = buildNpcInput(
    s.state,
    ids.lvFang,
    s.view.time,
    "inbox-test",
    "zh-CN",
  );
  await s.act(s.view.audience!.id, {
    type: "open_message",
    documentId: doc.id,
  });
  const opened = s.view.audience!.documents.find((d) => d.id === doc.id)!;
  expect(opened.summary).toBe("只报平安");
  expect(opened.text).toBe("");
  await s.act(s.view.audience!.id, { type: "reveal", documentId: doc.id });
  expect(s.view.energy).toBe(1);
  expect(s.view.audience!.documents.find((d) => d.id === doc.id)!.text).toBe(
    "正文是秘闻",
  );
  expect(
    buildNpcInput(s.state, ids.lvFang, s.view.time, "inbox-test", "zh-CN"),
  ).toEqual(before);
});

it("explicitly reads the pre-Directorate audience and retired scheduling events", () => {
  let state = createInitialState("legacy-inbox");
  const event = (
    eventType: string,
    payload: import("@throne/shared-types").JsonObject,
  ) => ({ id: eventType, eventType, payload, occurredAt: at(0, 6) });
  state = reduceCourtState(
    state,
    event("court.audience_opened", {
      audience: {
        id: "audience-1",
        openedAt: 6,
        documentIds: [ids.policyMemorial],
      },
    }),
  );
  expect(state.audience!.oralReportIds).toEqual([]);
  expect(state.audience!.conversation).toEqual([]);
  state = reduceCourtState(
    state,
    event("court.audience_scheduled", { at: 30 }),
  );
  expect(state.nextAudienceAt).toBe(30);
  state = reduceCourtState(state, event("court.audience_skipped", {}));
  expect(state.nextAudienceAt).toBeUndefined();
  expect(state.information).toBeUndefined();
});
