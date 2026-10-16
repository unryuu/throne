import { describe, expect, it } from "vitest";
import { replay } from "@throne/sim-core";
import { generateFacts } from "./information.ts";
import { createInitialState } from "./jiajing.ts";
import { reduceCourtState } from "./model.ts";
import type { CourtModelRequest } from "./npc.ts";
import { parseRoutineLibrary, type RoutineEntry } from "./routine-library.ts";
import { startCourtSession } from "./session.ts";
import type { CourtState, IntelligenceFact } from "./types.ts";

const markdown = `### R001 · 宗室请封

- 标题：请封事
- 现代标题：请求封号
- 正文：礼部奏请核给宗室封号。
- 现代正文：礼部请求核实并发给宗室封号。
- 归纳：远房亲戚来要封号。
- 时令：不限
- 可信度：化用
- 出处：参考宗室请封制度。
- 作者注：宗室封爵需经题请。
`;
const parse = (text = markdown) =>
  parseRoutineLibrary([{ name: "甲 - 一.md", text }]);
const entry = (
  key: string,
  season: RoutineEntry["season"] = "不限",
): RoutineEntry => ({
  ...parse().entries[0]!,
  key,
  season,
  title: `公文${key}`,
  modernTitle: `现代${key}`,
});
const library = Array.from({ length: 80 }, (_, i) => entry(`甲/R${i}`));
const seed = "routine-test-7";
const initial = (): CourtState => ({ ...createInitialState("run"), seed });
const withFacts = (
  state: CourtState,
  facts: readonly IntelligenceFact[],
): CourtState => ({
  ...state,
  information: { version: 1, day: 0, remaining: 2, bureauDays: [], facts },
});
const reply = async (r: CourtModelRequest) => {
  if (r.bureau)
    return JSON.stringify({
      reports: (r.input.facts as unknown as IntelligenceFact[]).map((f) => ({
        id: f.id,
        title: "模型标题",
        text: "模型正文",
      })),
    });
  if (r.summaries)
    return JSON.stringify({
      summaries: (r.input.texts as string[]).map(() => "模型归纳"),
    });
  if (r.ponder)
    return "朕得想想，封爵不能没有规矩。\n游戏作者注：模型自写作者注。";
  return JSON.stringify({ inner: "静候", reply: "奴婢在。" });
};

describe("routine library parsing", () => {
  it("ignores prose and blank lines, accepts CRLF and optional notes, and namespaces repeated ids", () => {
    const result = parseRoutineLibrary([
      { name: "甲 - 一.md", text: `说明\n${markdown}\n尾声` },
      {
        name: "乙.md",
        text: markdown
          .replace("请封事", "请禄事")
          .replace(/- 作者注：.*\n/, "")
          .replaceAll("\n", "\r\n"),
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.entries.map((e) => e.key)).toEqual(["甲/R001", "乙.md/R001"]);
    expect(result.entries[1]!.authorNote).toBe("");
    expect(
      generateFacts(initial(), 0, "bureau", 4, result.entries)
        .filter((f) => f.routine)
        .map((f) => f.routine!.key)
        .sort(),
    ).toEqual(["乙.md/R001", "甲/R001"].sort());
  });

  it.each([
    ["必填", markdown.replace("- 归纳：远房亲戚来要封号。", "")],
    ["阿拉伯数字", markdown.replace("参考宗室请封制度。", "卷123")],
    ["时令", markdown.replace("时令：不限", "时令：七月")],
    ["可信度", markdown.replace("可信度：化用", "可信度：未知")],
    ["标题", markdown.replace("标题：请封事", `标题：${"字".repeat(21)}`)],
    [
      "正文",
      markdown.replace(
        "正文：礼部奏请核给宗室封号。",
        `正文：${"字".repeat(121)}`,
      ),
    ],
  ])("skips invalid %s with a located warning", (field, text) => {
    const result = parse(text);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join()).toContain(field);
    expect(result.warnings.join()).toContain("甲 - 一.md: 甲/R001: 跳过");
  });

  it("keeps long modern versions with a warning", () => {
    const result = parse(
      markdown
        .replace("现代标题：请求封号", `现代标题：${"字".repeat(21)}`)
        .replace(
          "现代正文：礼部请求核实并发给宗室封号。",
          `现代正文：${"字".repeat(121)}`,
        ),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.warnings.join()).toContain(
      "「现代标题」21字，超过20字（仅警告）",
    );
    expect(result.warnings.join()).toContain(
      "「现代正文」121字，超过120字（仅警告）",
    );
  });

  it("keeps long notes, retains the first duplicate title across sources, and rejects duplicate keys", () => {
    const result = parseRoutineLibrary([
      {
        name: "甲 - 一.md",
        text: markdown.replace("宗室封爵需经题请。", "字".repeat(61)),
      },
      { name: "乙 - 一.md", text: markdown },
      { name: "甲 - 二.md", text: markdown.replace("请封事", "请禄事") },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.authorNote).toHaveLength(61);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join()).toContain("标题重复，保留先出现的 甲/R001");
    expect(result.warnings.join()).toContain("来源/编号重复");
  });
});

describe("routine selection", () => {
  it("draws deterministically without replacement within and across days, preserving a snapshot", () => {
    const facts = generateFacts(initial(), 0, "bureau", 4, library);
    expect(facts.every((f) => f.routine)).toBe(true);
    expect(generateFacts(initial(), 0, "bureau", 4, library)).toEqual(facts);
    expect(facts[0]!.routine).not.toBe(
      library.find((e) => e.key === facts[0]!.routine!.key),
    );
    const later = generateFacts(
      withFacts(initial(), facts),
      1,
      "bureau",
      30,
      library,
    );
    const keys = [...facts, ...later].flatMap((f) =>
      f.routine ? [f.routine.key] : [],
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(later.some((f) => f.routine)).toBe(true);
    expect(
      generateFacts(initial(), 0, "rumor", 20, library).some((f) => f.routine),
    ).toBe(false);
  });

  it.each([
    [0, "四月"],
    [29, "四月"],
    [30, "五月"],
    [59, "五月"],
    [60, "六月"],
  ] as const)("filters month at day %i", (day, month) => {
    const seasonal = [
      entry("四", "四月"),
      entry("五", "五月"),
      entry("六", "六月"),
      entry("常"),
    ];
    const drawn = generateFacts(
      initial(),
      day,
      "bureau",
      100,
      seasonal,
    ).flatMap((f) => (f.routine ? [f.routine] : []));
    expect(drawn.map((e) => e.season).sort()).toEqual([month, "不限"].sort());
  });

  it("falls back when absent or exhausted, including previously used keys", () => {
    const facts = generateFacts(initial(), 0, "bureau", 4, [library[0]!]);
    expect(facts.filter((f) => f.routine)).toHaveLength(1);
    expect(
      facts
        .filter((f) => !f.routine)
        .every((f) => f.claim.includes("具体事由自拟")),
    ).toBe(true);
    expect(
      generateFacts(withFacts(initial(), facts), 0, "bureau", 4, [
        library[0]!,
      ]).every((f) => !f.routine),
    ).toBe(true);
    expect(
      generateFacts(initial(), 0, "bureau", 4).every(
        (f) => f.category === "routine" && !f.routine,
      ),
    ).toBe(true);
  });
});

describe("routine documents through the engine", () => {
  it("loads a server library once per session and does not repeat entries on later days", async () => {
    let loads = 0;
    const s = await startCourtSession({
      runId: "routine-lazy",
      seed,
      language: "zh-CN",
      routineLibrary: async () => {
        loads++;
        return library;
      },
      settings: { summaries: false },
      model: reply,
    });
    for (let day = 0; day < 2; day++) {
      await s.submit({
        audienceId: s.view.audience!.id,
        items: [],
        specials: [],
      });
    }
    expect(loads).toBe(1);
    const keys = s.state.information!.facts.flatMap((f) =>
      f.routine ? [f.routine.key] : [],
    );
    expect(keys.length).toBeGreaterThan(4);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(["classical", "plain", "modern"] as const)(
    "uses %s text with zero model calls when every bureau fact is from the library",
    async (register) => {
      const s = await startCourtSession({
        runId: "routine",
        seed,
        language: "zh-CN",
        routineLibrary: library,
        settings: { register, summaries: false },
        model: async () => {
          throw new Error("unexpected model call");
        },
      });
      const docs = Object.values(s.state.documents).filter(
        (d) => d.kind === "bureau",
      );
      expect(docs).toHaveLength(4);
      for (const d of docs) {
        const e = s.state.information!.facts.find(
          (f) => f.id === d.factId,
        )!.routine!;
        expect(d.subject).toBe(register === "modern" ? e.modernTitle : e.title);
        expect(d.text).toBe(register === "modern" ? e.modernText : e.text);
        expect(d.gloss).toBe(e.gloss);
      }
      await s.act(s.view.audience!.id, {
        type: "open_message",
        documentId: docs[0]!.id,
      });
      expect(
        s.view.audience!.documents.find((d) => d.id === docs[0]!.id)!.gloss,
      ).toBeUndefined();
    },
  );

  it("excludes library facts and glosses from model requests, but generates exhausted routine reports normally", async () => {
    const requests: CourtModelRequest[] = [];
    const s = await startCourtSession({
      runId: "routine-mixed",
      seed,
      language: "zh-CN",
      routineLibrary: [library[0]!],
      model: async (r) => {
        requests.push(r);
        return reply(r);
      },
    });
    const bureau = requests.filter((r) => r.bureau);
    expect(bureau).toHaveLength(1);
    expect(bureau[0]!.input.facts).toHaveLength(3);
    expect(JSON.stringify(bureau)).not.toContain(library[0]!.text);
    const texts = requests
      .filter((r) => r.summaries)
      .flatMap((r) => r.input.texts as string[]);
    expect(texts).toHaveLength(5);
    expect(texts.filter((t) => t === "模型正文")).toHaveLength(3);
    expect(texts).not.toContain(library[0]!.text);
    const doc = Object.values(s.state.documents).find(
      (d) => d.gloss === library[0]!.gloss,
    )!;
    await s.act(s.view.audience!.id, {
      type: "open_message",
      documentId: doc.id,
    });
    expect(s.view.audience!.documents.find((d) => d.id === doc.id)!.gloss).toBe(
      library[0]!.gloss,
    );
  });

  it.each(["库作者注", ""])(
    "persists complete facts and applies note %j after restoring without a library",
    async (authorNote) => {
      const s = await startCourtSession({
        runId: "routine-saved",
        seed,
        language: "zh-CN",
        routineLibrary: library.map((e) => ({ ...e, authorNote })),
        settings: { summaries: false },
        model: reply,
      });
      const doc = Object.values(s.state.documents).find(
        (d) => d.kind === "bureau",
      )!;
      await s.act(s.view.audience!.id, {
        type: "open_message",
        documentId: doc.id,
      });
      const records = JSON.parse(JSON.stringify(await s.records()));
      const requests: CourtModelRequest[] = [];
      const restored = await startCourtSession({
        runId: "routine-saved",
        records,
        ...(authorNote
          ? {
              routineLibrary: async () => {
                throw new Error("saved facts must not load files");
              },
            }
          : {}),
        language: "zh-CN",
        model: async (r) => {
          requests.push(r);
          return reply(r);
        },
      });
      expect(restored.state).toEqual(s.state);
      expect(requests).toEqual([]);
      await restored.act(restored.view.audience!.id, {
        type: "ponder",
        documentId: doc.id,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.ponder).toBe(true);
      expect(restored.state.documents[doc.id]!.ponders![0]).toMatchObject({
        text: "朕得想想，封爵不能没有规矩。",
        authorNote: authorNote || "模型自写作者注。",
      });
      expect(
        replay(
          createInitialState("routine-saved"),
          await restored.records(),
          reduceCourtState,
        ),
      ).toEqual(restored.state);
    },
  );
});
