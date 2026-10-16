import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ids,
  imperialPresets,
  startCourtSession,
  courtSettingsSchema,
  type CourtSession,
  type RescriptSubmission,
  type SpecialEdict,
  type CourtSettings,
} from "@throne/court";
import type { LiveCallTrace } from "@throne/agent-runtime/live";
import type { SimulationRecord } from "@throne/shared-types";
import { CourtService, type CourtModelFactory } from "./court-service.ts";
import { saveOpeningPack, type OpeningPack } from "./opening-pack-store.ts";

import {
  openingBranches,
  openingPackPlan,
  openingTaskLabel,
  formatOpeningPlan,
  planEstimateNote,
  type OpeningChoice,
  type OpeningTask,
} from "./opening-pack-plan.ts";
export {
  branchChoices,
  openingBranches,
  type OpeningChoice,
} from "./opening-pack-plan.ts";

export function defaultSubmission(
  session: CourtSession,
  specials: readonly SpecialEdict[] = [],
): RescriptSubmission {
  return {
    audienceId: session.view.audience!.id,
    items: session.view.audience!.documents.map((d) => ({
      documentId: d.id,
      disposition: d.draft || d.hasDraft ? "follow_draft" : "hold",
    })),
    specials,
  };
}
export async function submitOpening(
  session: CourtSession,
  choices: readonly [OpeningChoice, OpeningChoice],
) {
  const values = new Map<string, OpeningChoice>([
    [ids.policyMemorial, choices[0]],
    [ids.armyMemorial, choices[1]],
  ]);
  for (const [documentId, choice] of values)
    if (choice === "reject")
      await session.act(session.view.audience!.id, {
        type: "open_message",
        documentId,
      });
  const base = defaultSubmission(session);
  await session.submit({
    ...base,
    items: base.items.map((item) => {
      const choice = values.get(item.documentId);
      return choice === "reject"
        ? {
            documentId: item.documentId,
            disposition: "custom",
            edict: { kind: "reject", params: {} },
          }
        : choice
          ? { ...item, disposition: choice }
          : item;
    }),
  });
}
export async function advanceDefault(
  session: CourtSession,
  throughDay: number,
) {
  while (Math.floor(session.view.time / 12) < throughDay) {
    if (!session.view.audience || session.failed || session.complete)
      throw new Error("Opening branch ended before requested day");
    await session.submit(defaultSubmission(session));
  }
}
export function usageReport(calls: readonly LiveCallTrace[]) {
  const total = (key: string) =>
    calls.reduce(
      (sum, c) =>
        sum +
        (typeof c.usage?.[key] === "number" ? (c.usage[key] as number) : 0),
      0,
    );
  const input = total("inputTokens"),
    cachedInput = total("cacheReadTokens"),
    output = total("outputTokens");
  return {
    calls: calls.length,
    hits: calls.filter((c) => c.cached).length,
    inputTokens: input,
    cacheReadTokens: cachedInput,
    outputTokens: output,
    estimatedUsdOffPeak:
      (input * 0.15 + cachedInput * 0.003 + output * 0.6) / 1e6,
    estimatedUsdPeak: (input * 0.3 + cachedInput * 0.006 + output * 1.2) / 1e6,
    pricingDate: "2026-10-15",
    pricingSource: "https://api-docs.deepseek.com/quick_start/pricing/",
  };
}
export async function buildOpeningPack(options: {
  root: string;
  settings: CourtSettings;
  seed?: string;
  id?: string;
  throughDay?: number;
  branches?: readonly (readonly [OpeningChoice, OpeningChoice])[];
  extras?: boolean;
  parallel?: number;
  modelFactory?: CourtModelFactory;
  modelIdentity?: string;
  onProgress?: (message: string) => void;
}) {
  const began = Date.now();
  const throughDay = options.throughDay ?? 5;
  if (
    !Number.isInteger(throughDay) ||
    throughDay < 1 ||
    !Number.isInteger(options.parallel ?? 2) ||
    (options.parallel ?? 2) < 1
  )
    throw new Error(
      "Opening pack days and parallelism must be positive integers",
    );
  const branches = options.branches ?? openingBranches;
  const id = options.id ?? randomUUID();
  const pack: OpeningPack = {
    version: 1,
    id,
    seed: options.seed ?? id,
    settings: options.settings,
    locale: "zh-CN",
    throughDay,
    branches: branches.map((b) => b.join("/")),
    complete:
      throughDay >= 5 &&
      openingBranches.every((b) =>
        branches.some((v) => v.join() === b.join()),
      ) &&
      options.extras !== false,
  };
  const calls: LiveCallTrace[] = [];
  const service = new CourtService(
    options.root,
    options.modelFactory,
    options.modelIdentity,
  );
  const session = (records?: readonly SimulationRecord[]) =>
    startCourtSession({
      runId: randomUUID(),
      seed: pack.seed,
      openingPackId: pack.id,
      settings: pack.settings,
      language: pack.locale,
      fullLog: service.fullLog,
      model: service.model(calls, new Set()),
      ...(records ? { records } : {}),
    });
  try {
    options.onProgress?.(`${pack.id}: opening seed=${pack.seed}`);
    const baseline = await session();
    const initial = await baseline.records();
    const plan = openingPackPlan({
      seed: pack.seed,
      throughDay,
      branches,
      ...(options.extras !== undefined ? { extras: options.extras } : {}),
    });
    if (
      options.extras !== false &&
      plan.tasks.filter((t) => t.type === "ponder").length !==
        baseline.view.audience!.documents.length
    )
      throw new Error(
        "Opening plan message count differs from the initial desk",
      );
    const checkpoints = new Map<number, readonly SimulationRecord[]>([
      [0, initial],
    ]);
    for (let day = 1; day <= plan.preparationThroughDay; day++) {
      await baseline.submit(defaultSubmission(baseline));
      checkpoints.set(day, await baseline.records());
    }
    const completedTasks: { task: OpeningTask; reachedDay: number }[] = [];
    const jobs = plan.tasks.map((task) => ({
      label: openingTaskLabel(task),
      run: async () => {
        const s = await session(checkpoints.get(task.day)!);
        switch (task.type) {
          case "opening":
            await submitOpening(s, task.choices);
            break;
          case "ponder": {
            const documentId =
              s.view.audience!.documents[task.messageIndex]!.id;
            await s.act(s.view.audience!.id, {
              type: "open_message",
              documentId,
            });
            await s.act(s.view.audience!.id, { type: "ponder", documentId });
            break;
          }
          case "talk":
            await s.act(s.view.audience!.id, {
              type: "converse",
              message: task.message,
            });
            break;
          case "question": {
            if (
              !s.view.options.questionable.some((a) => a.id === task.actorId) ||
              s.state.actors[task.actorId]?.location !== "beijing"
            )
              throw new Error(
                `Planned question target unavailable in Beijing: ${task.actorId}`,
              );
            await s.submit(
              defaultSubmission(s, [
                {
                  edict: {
                    kind: "request_memorial",
                    params: { actorId: task.actorId, question: task.message },
                  },
                },
              ]),
            );
            break;
          }
        }
        await advanceDefault(s, task.throughDay);
        completedTasks.push({ task, reachedDay: Math.floor(s.view.time / 12) });
      },
    }));
    let cursor = 0;
    const results = await Promise.allSettled(
      Array.from({ length: options.parallel ?? 2 }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++]!;
          options.onProgress?.(`${pack.id}: ${job.label}`);
          await job.run();
        }
      }),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const report = {
      pack,
      tasks: completedTasks,
      durationMs: Date.now() - began,
      ...usageReport(calls),
    };
    await mkdir(join(options.root, "runs", "cache", "reports"), {
      recursive: true,
    });
    await writeFile(
      join(options.root, "runs", "cache", "reports", `${pack.id}.json`),
      JSON.stringify({ ...report, calls }),
      { mode: 0o600 },
    );
    await saveOpeningPack(options.root, pack);
    return report;
  } catch (cause) {
    await mkdir(join(options.root, "runs", "cache", "reports"), {
      recursive: true,
    });
    await writeFile(
      join(
        options.root,
        "runs",
        "cache",
        "reports",
        `${pack.id}-failed-${Date.now()}.json`,
      ),
      JSON.stringify({
        pack,
        error: cause instanceof Error ? cause.message : String(cause),
        durationMs: Date.now() - began,
        ...usageReport(calls),
        calls,
      }),
      { mode: 0o600 },
    );
    throw cause;
  }
}

async function main() {
  const flag = (name: string, fallback: string) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3) ?? fallback;
  const integer = (name: string, fallback: string, minimum: number) => {
    const value = Number(flag(name, fallback));
    if (!Number.isInteger(value) || value < minimum)
      throw new Error(`Invalid --${name}`);
    return value;
  };
  const register = flag("register", "plain");
  const registers =
    register === "all" ? ["plain", "classical", "modern"] : [register];
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const summaries = flag("summaries", "true");
  if (!["true", "false"].includes(summaries))
    throw new Error("Invalid --summaries");
  const onlyDefault = process.argv.includes("--default-only");
  const throughDay = integer("days", "5", 1);
  const parallel = integer("parallel", "2", 1);
  const planning = process.argv.includes("--plan");
  const totals = { tasks: 0, calls: 0, low: 0, high: 0, groups: 0 };
  if (planning) {
    console.log("只规划，不调用模型、不写入缓存或开局包。");
    imperialPresets.talk.forEach((text, i) => console.log(`T${i + 1} ${text}`));
    imperialPresets.question.forEach((text, i) =>
      console.log(`Q${i + 1} ${text}`),
    );
    console.log(planEstimateNote);
  }
  for (const register of registers)
    for (
      let i = 0;
      i < integer("groups", register === "plain" ? "6" : "2", 1);
      i++
    ) {
      const id = onlyDefault
        ? planning
          ? `default-${register}-${summaries}-${i + 1}`
          : randomUUID()
        : `opening-${register}-${summaries}-${i + 1}`;
      const settings = courtSettingsSchema.parse({
        register,
        summaries: summaries === "true",
      });
      if (planning) {
        const plan = openingPackPlan({
          seed: id,
          throughDay,
          ...(onlyDefault
            ? {
                branches: [["follow_draft", "follow_draft"]] as const,
                extras: false,
              }
            : {}),
        });
        console.log(formatOpeningPlan(id, plan));
        totals.groups++;
        totals.tasks += plan.tasks.length;
        totals.calls += plan.estimatedCalls;
        totals.low += plan.estimatedUsdOffPeak;
        totals.high += plan.estimatedUsdPeak;
        continue;
      }
      const result = await buildOpeningPack({
        root,
        id,
        settings,
        throughDay,
        parallel,
        ...(onlyDefault
          ? {
              branches: [["follow_draft", "follow_draft"]] as const,
              extras: false,
            }
          : {}),
        onProgress: console.log,
      });
      console.log(JSON.stringify(result));
      if (process.argv.includes("--verify")) {
        const previous = process.env.THRONE_CACHE_ONLY;
        process.env.THRONE_CACHE_ONLY = "1";
        try {
          const service = new CourtService(root);
          const began = Date.now();
          let snap = await service.create("zh-CN", result.pack.settings, {
            pack: result.pack,
          });
          if (snap.status !== "waiting")
            throw new Error(snap.error ?? "Cached opening failed");
          const timings = [{ day: 0, durationMs: Date.now() - began }];
          while (Math.floor(snap.view.time / 12) < throughDay) {
            const started = Date.now();
            snap = await service.submit(
              snap.id,
              defaultSubmission(service.entries.get(snap.id)!.session),
            );
            if (snap.status !== "waiting")
              throw new Error(snap.error ?? "Cached advance failed");
            timings.push({
              day: Math.floor(snap.view.time / 12),
              durationMs: Date.now() - started,
            });
          }
          const calls = service.entries.get(snap.id)!.calls;
          if (calls.some((c) => !c.cached))
            throw new Error("Verification made a live call");
          const verification = {
            packId: result.pack.id,
            runId: snap.id,
            timings,
            ...usageReport(calls),
          };
          await writeFile(
            join(
              root,
              "runs",
              "cache",
              "reports",
              `${result.pack.id}-verification.json`,
            ),
            JSON.stringify(verification),
          );
          console.log(JSON.stringify(verification));
        } finally {
          if (previous === undefined) delete process.env.THRONE_CACHE_ONLY;
          else process.env.THRONE_CACHE_ONLY = previous;
        }
      }
    }
  if (planning)
    console.log(
      `合计 ${totals.groups} 组，${totals.tasks} 条分叉；粗估 ${totals.calls} 次调用，US$${totals.low.toFixed(2)}–${totals.high.toFixed(2)}。`,
    );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main();
