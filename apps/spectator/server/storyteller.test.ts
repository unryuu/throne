import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { Chronicle } from "@throne/court";
import type { LiveCallTrace } from "@throne/agent-runtime/live";
import { runs } from "../src/runs.ts";
import { parseStory, verifyStory } from "../shared/story.ts";
import { assertRunId, listLocalRuns } from "./local-runs.ts";
import { assertLocalRequest } from "./local-plugin.ts";
import { excerpt, summaryLimit, summarizeChronicle } from "./summary.ts";
import { Storyteller } from "./storyteller.ts";

const chronicle = JSON.parse(
  readFileSync(new URL("../public/runs/jiande.json", import.meta.url), "utf8"),
) as Chronicle;
const run = runs[0]!;
const validStory = { scenes: run.scenes.slice(0, 6), ending: run.ending! };

describe("storyteller quotes", () => {
  it("accepts exact and trimmed quotes, keeps unknown ones as retellings", () => {
    const scene = run.scenes[0]!;
    const verified = verifyStory(
      {
        scenes: [
          scene,
          {
            day: scene.day,
            episode: scene.episode!,
            title: "t",
            note: "",
            thought: "修桐庐之堤……断建德之堤",
            deed: scene.deed!,
          },
          { day: scene.day, title: "t", note: "", thought: "朕要的是钱" },
        ],
        ending: run.ending!,
      },
      chronicle,
    );
    expect(verified.scenes[0]).toEqual(scene);
    expect(verified.scenes[1]!.retold).toBeUndefined();
    expect(verified.scenes[2]!.retold).toEqual(["thought"]);
    expect(verified.verification).toEqual({ exact: 4, loose: 1, retold: 1 });
  });
  it("parses leniently: skips bad entries, maps names to actors, fixes highlight", () => {
    const story = parseStory(
      {
        scenes: [{ day: "x" }, { day: 12, title: "掘堤", thought: "" }],
        ending: {
          verdict: "朕知道了",
          deceivers: [
            { actor: "郑泌昌", line: "掘堤" },
            { actor: "ghost", line: "x" },
          ],
          highlight: 9,
        },
      },
      chronicle,
    );
    expect(story.scenes).toEqual([{ day: 12, title: "掘堤", note: "" }]);
    expect(story.ending?.deceivers).toEqual([
      { actor: "actor:zheng-bichang", line: "掘堤", exposed: false },
    ]);
    expect(story.ending?.highlight).toBe(0);
    expect(parseStory({}, chronicle)).toEqual({ scenes: [] });
    expect(parseStory(validStory, chronicle).scenes).toHaveLength(6);
  });
});

describe("bounded whole-run summary", () => {
  it("shortens private letters before touching full thoughts, imperial papers, oral reports or deeds", () => {
    const sample = chronicle.days
      .flatMap((d) => d.truth)
      .find((e) => e.type === "decision")!;
    if (sample.type !== "decision") throw new Error("fixture");
    const thought = "先想全局。".repeat(800) + "所想末尾也要保留。";
    const report = "奴婢谨奏。".repeat(800) + "口奏末尾也要保留。";
    const paper = "臣有本奏。".repeat(800) + "奏疏末尾也要保留。";
    const deed = "暗遣差役。".repeat(800) + "行动末尾也要保留。";
    const letter = "私信次要材料。".repeat(4000);
    const result = summarizeChronicle(
      {
        ...chronicle,
        days: [
          {
            ...chronicle.days[0]!,
            ruler: [],
            truth: [
              {
                ...sample,
                thought,
                report,
                documents: [
                  {
                    kind: "memorial",
                    to: ["嘉靖"],
                    subject: "奏疏",
                    text: paper,
                  },
                  {
                    kind: "letter",
                    to: ["严嵩"],
                    subject: "私信",
                    text: letter,
                  },
                ],
                actions: [{ capability: "breach_dike", description: deed }],
                terminal: [
                  { command: "不要保留的终端", output: letter, error: false },
                ],
              },
            ],
          },
        ],
      },
      22000,
    );
    for (const source of [thought, report, paper, deed])
      expect(result.text).toContain(source);
    expect(result.text).not.toContain(letter);
    expect(result.text).not.toContain("不要保留的终端");
    expect(result.truncatedFields).toBeGreaterThan(0);
    expect(result.chars).toBeLessThanOrEqual(22000);
  });

  it("fits hundreds of distinct decisions without dropping the final day or actors", () => {
    const sample = chronicle.days
      .flatMap((d) => d.truth)
      .find((e) => e.type === "decision")!;
    if (sample.type !== "decision") throw new Error("fixture");
    const large: Chronicle = {
      ...chronicle,
      days: Array.from({ length: 81 }, (_, day) => ({
        ...chronicle.days[0]!,
        day,
        ruler: [],
        truth: Array.from({ length: 3 }, (_, actor) => ({
          ...sample,
          episode: `episode-${day}-${actor}`,
          actor: `actor-${actor}`,
          thought:
            `${day}/${actor}：` + "事情已败，先隐瞒，再暗中补救。".repeat(100),
          documents: [
            {
              kind: "letter" as const,
              to: ["严嵩"],
              subject: "密报",
              text:
                `${day}/${actor}：` +
                "臣已查明夜掘之事，却恐惊动上意。".repeat(100),
            },
          ],
          drafts: [],
          actions: [],
          dispositions: [],
          routes: [],
          rejected: [],
        })),
      })),
    };
    const result = summarizeChronicle(large, 500000);
    expect(result.chars).toBeLessThanOrEqual(summaryLimit);
    expect(result.truncatedFields).toBeGreaterThan(0);
    for (const day of large.days)
      for (const entry of day.truth) {
        if (entry.type === "decision") {
          expect(result.text).toContain(entry.episode);
          expect(result.text).toContain(entry.thought);
        }
      }
    expect(result.text).toContain("episode-80-2");
    expect(result.text).toContain("actor-2");
  });

  it("keeps a contiguous source excerpt around contrast rather than joining ceremonial openings and closings", () => {
    const text =
      "臣谨奏".repeat(30) +
      "若事败则自危，须先隐瞒夜掘之事，再密令补救。" +
      "伏乞圣裁".repeat(30);
    const clipped = excerpt(text, 30);
    expect(clipped).toContain("隐瞒");
    expect(text).toContain(clipped.replace("〔节录〕", ""));
    expect(excerpt("原文", 30)).toBe("原文");
  });

  it("keeps all days, episodes, outcomes and ruler perspective, strips terminals and preserves final numbers", () => {
    const huge = {
      ...chronicle,
      days: chronicle.days.map((d) => ({
        ...d,
        truth: d.truth.map((e) =>
          e.type === "decision"
            ? {
                ...e,
                terminal: [
                  {
                    command: "SECRET_TERMINAL",
                    output: "x".repeat(100000),
                    error: false,
                  },
                ],
                thought: e.thought + "长".repeat(3000),
              }
            : e,
        ),
      })),
    };
    const result = summarizeChronicle(huge);
    expect(result.chars).toBeLessThanOrEqual(summaryLimit);
    expect(result.truncatedFields).toBe(0);
    expect(result.text).not.toContain("SECRET_TERMINAL");
    const encoded = JSON.parse(result.text);
    const expand = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(expand);
      if (value && typeof value === "object") {
        if ("$text" in value)
          return encoded.texts[(value as { $text: number }).$text];
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            encoded.fields?.[k] ?? k,
            expand(v),
          ]),
        );
      }
      return value;
    };
    const parsed = expand(encoded.data) as Chronicle;
    for (const [index, day] of huge.days.entries()) {
      const actual = parsed.days[index]!.truth.filter(
        (e) => e.type === "decision",
      );
      const expected = day.truth.filter((e) => e.type === "decision");
      expect(actual.map((e) => e.thought)).toEqual(
        expected.map((e) => e.thought),
      );
      expect(actual.map((e) => e.report)).toEqual(
        expected.map((e) => e.report),
      );
      expect(actual.map((e) => e.actions ?? [])).toEqual(
        expected.map((e) => e.actions),
      );
      expect(actual.map((e) => (e.documents ?? []).map((d) => d.text))).toEqual(
        expected.map((e) => e.documents.map((d) => d.text)),
      );
    }
    expect(parsed.days.map((d) => d.day)).toEqual(
      chronicle.days.map((d) => d.day),
    );
    const episodes = (c: Chronicle) =>
      c.days.flatMap((d) =>
        d.truth.filter((e) => e.type === "decision").map((e) => e.episode),
      );
    expect(episodes(parsed)).toEqual(episodes(chronicle));
    expect(
      parsed.days.flatMap((d) => d.truth).filter((e) => e.type === "result")
        .length,
    ).toBe(
      chronicle.days.flatMap((d) => d.truth).filter((e) => e.type === "result")
        .length,
    );
    expect(parsed.summary).toEqual(chronicle.summary);
    expect(parsed.days[0]!.ruler.length).toBeGreaterThan(0);
    expect(() => summarizeChronicle(huge, 100)).toThrow("未丢弃日期或决策");
  });
  it("does not present a hidden original paper as something the emperor read", () => {
    const day = chronicle.days[0]!;
    const summary = summarizeChronicle({
      ...chronicle,
      days: [
        {
          ...day,
          ruler: [
            {
              type: "audience",
              at: 1,
              oral: [],
              papers: [
                {
                  id: "p",
                  kind: "memorial",
                  from: "a",
                  subject: "s",
                  text: "隐藏全文",
                  summary: "口奏摘要",
                  revealed: false,
                  direct: false,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(summary.text).toContain("口奏摘要");
    expect(summary.text).not.toContain("隐藏全文");
  });
});

const trace: LiveCallTrace = {
  decisionEpisodeId: "test",
  requestedProvider: "test",
  requestedModel: "test",
  returnedProvider: null,
  returnedModel: null,
  thinking: "enabled",
  reasoningEffort: "high",
  thinkingObserved: false,
  durationMs: 1,
  usage: { inputTokens: 10, outputTokens: 20 },
  status: "succeeded",
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "throne-story-test-"));
  await mkdir(join(root, "runs/court"), { recursive: true });
  // A minimal valid saved world; use only the authoritative initial-world fixture.
  const { createInitialState } =
    await import("../../../packages/court/src/jiajing.ts");
  await writeFile(
    join(root, "runs/court/test.json"),
    JSON.stringify({
      id: "test",
      status: "complete",
      records: [],
      calls: [],
      state: createInitialState("test"),
    }),
  );
  return root;
}

describe("local cache and service boundaries", () => {
  it("rejects paths and foreign origins, allows local requests", () => {
    expect(() => assertRunId("../secret")).toThrow();
    expect(() =>
      assertLocalRequest({
        headers: { host: "localhost:4174", origin: "https://evil.example" },
      } as unknown as IncomingMessage),
    ).toThrow();
    expect(() =>
      assertLocalRequest({
        headers: { host: "evil.example:4174" },
      } as unknown as IncomingMessage),
    ).toThrow();
    expect(() =>
      assertLocalRequest({
        method: "POST",
        headers: { host: "localhost:4174" },
      } as unknown as IncomingMessage),
    ).toThrow();
    expect(() =>
      assertLocalRequest({
        method: "POST",
        headers: { host: "localhost:4174", "x-throne-client": "local" },
      } as unknown as IncomingMessage),
    ).not.toThrow();
  });
  it("deduplicates concurrent services, persists usage, reads cache, and regenerates only on force", async () => {
    const root = await fixture();
    let calls = 0;
    const factory =
      (_root: string, onTrace: (t: LiveCallTrace) => void) => async () => {
        calls++;
        onTrace(trace);
        return JSON.stringify({
          scenes: [],
          ending: { verdict: "朕未见新事。", deceivers: [], highlight: -1 },
        });
      };
    const a = new Storyteller(root, factory);
    const b = new Storyteller(root, factory);
    const [first, second] = await Promise.all([
      a.generate("test"),
      b.generate("test"),
    ]);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect((await a.generate("test")).trace.usage).toEqual(trace.usage);
    expect(calls).toBe(1);
    await b.generate("test", true);
    expect(calls).toBe(2);
    expect(JSON.parse(await readFile(a.path("test"), "utf8")).status).toBe(
      "succeeded",
    );
  });
  it("records failed generation without retrying spend, and reports unreadable runs", async () => {
    const root = await fixture();
    let calls = 0;
    const service = new Storyteller(root, (_root, onTrace) => async () => {
      calls++;
      onTrace(trace);
      return "not JSON";
    });
    await expect(service.generate("test")).rejects.toThrow();
    await expect(service.generate("test")).rejects.toThrow("上次说书失败");
    expect(calls).toBe(1);
    await writeFile(join(root, "runs/court/bad.json"), "{");
    const listed = await listLocalRuns(root);
    expect(listed.runs).toEqual([
      { id: "test", complete: true, days: 0, calls: 0 },
    ]);
    expect(listed.errors[0]?.id).toBe("bad");
  });
});
