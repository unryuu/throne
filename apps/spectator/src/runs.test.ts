import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Chronicle, TruthEntry } from "@throne/court";
import { runs } from "./runs.ts";

const load = (slug: string): Chronicle =>
  JSON.parse(
    readFileSync(
      new URL(`../public/runs/${slug}.json`, import.meta.url),
      "utf8",
    ),
  ) as Chronicle;

type Decision = Extract<TruthEntry, { type: "decision" }>;

describe("curated runs", () => {
  for (const run of runs) {
    it(`${run.slug} quotes only what the actors wrote`, () => {
      const chronicle = load(run.slug);
      expect(chronicle.id).toBe(run.id);
      for (const scene of run.scenes) {
        const day = chronicle.days[scene.day];
        expect(day, `${run.slug} day ${scene.day}`).toBeDefined();
        if (!scene.episode) continue;
        const decision = day!.truth.find(
          (e): e is Decision =>
            e.type === "decision" && e.episode === scene.episode,
        );
        expect(decision, `${scene.episode} on day ${scene.day}`).toBeDefined();
        if (scene.thought) expect(decision!.thought).toContain(scene.thought);
        if (scene.word) {
          const said = [
            ...decision!.documents.map((d) => d.text),
            ...decision!.drafts.map((d) => d.text),
            decision!.report ?? "",
          ];
          expect(
            said.some((t) => t.includes(scene.word!)),
            scene.word,
          ).toBe(true);
        }
        if (scene.deed)
          expect(
            decision!.actions.some((a) => a.description?.includes(scene.deed!)),
            scene.deed,
          ).toBe(true);
      }
      if (run.ending) expect(run.scenes[run.ending.highlight]).toBeDefined();
    });
  }
});
