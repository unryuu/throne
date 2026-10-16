import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ids, imperialPresets } from "@throne/court";
import {
  beijingQuestionTargets,
  formatOpeningPlan,
  openingPackPlan,
} from "./opening-pack-plan.ts";

const exec = promisify(execFile);
describe("opening pack plan", () => {
  it("lists only Beijing questions and conversations, each ending at the next audience", () => {
    const plan = openingPackPlan({ seed: "opening-plain-true-1" });
    expect(beijingQuestionTargets.map((a) => a.id)).toEqual([
      ids.yanSong,
      ids.lvFang,
      ids.luBing,
    ]);
    expect(plan.tasks.filter((t) => t.type === "opening")).toHaveLength(9);
    expect(
      plan.tasks
        .filter((t) => t.type === "opening")
        .every((t) => t.throughDay === 5),
    ).toBe(true);
    for (let day = 0; day <= 2; day++) {
      const talks = plan.tasks.filter(
        (t) => t.type === "talk" && t.day === day,
      );
      const questions = plan.tasks.filter(
        (t) => t.type === "question" && t.day === day,
      );
      expect(talks.map((t) => t.type === "talk" && t.message)).toEqual(
        imperialPresets.talk,
      );
      expect(questions).toHaveLength(9);
      for (const actor of beijingQuestionTargets)
        expect(
          questions
            .filter((t) => t.type === "question" && t.actorId === actor.id)
            .map((t) => t.type === "question" && t.message),
        ).toEqual(imperialPresets.question);
      expect(
        [...talks, ...questions].every((t) => t.throughDay === day + 1),
      ).toBe(true);
    }
    expect(
      plan.tasks.every((t) =>
        ["opening", "ponder", "talk", "question"].includes(t.type),
      ),
    ).toBe(true);
    expect(plan.estimatedCalls).toBeGreaterThan(0);
    expect(formatOpeningPlan("test", plan)).toContain(
      `共 ${plan.tasks.length} 条`,
    );
  });
  it("honors a partial/default-only plan and estimates the measured smoke without extras", () => {
    const plan = openingPackPlan({
      seed: "smoke",
      throughDay: 2,
      branches: [["follow_draft", "follow_draft"]],
      extras: false,
    });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.preparationThroughDay).toBe(0);
    expect(plan.estimatedCalls).toBe(13);
    expect(plan.estimatedUsdPeak).toBeCloseTo(0.086512008, 9);
    expect(() => openingPackPlan({ seed: "bad", throughDay: 0 })).toThrow(
      "positive integer",
    );
  });
  it("runs --register=all --plan even with unusable model credentials and --verify, without building", async () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const { stdout, stderr } = await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "apps/web/server/opening-packs.ts",
        "--register=all",
        "--plan",
        "--verify",
      ],
      {
        cwd: root,
        env: { ...process.env, DEEPSEEK_API_KEY: "", THRONE_CACHE_ONLY: "1" },
      },
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("只规划，不调用模型");
    expect(stdout.match(/^opening-plain-/gm)).toHaveLength(6);
    expect(stdout.match(/^opening-classical-/gm)).toHaveLength(2);
    expect(stdout.match(/^opening-modern-/gm)).toHaveLength(2);
    expect(stdout).toContain("合计 10 组");
    expect(stdout).not.toContain('"runId"');
    expect(stdout).not.toContain("opening seed=");
  });
});
