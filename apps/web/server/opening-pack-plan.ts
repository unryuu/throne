import {
  createInitialState,
  imperialPresets,
  imperialRules,
  roll,
} from "@throne/court";

export const branchChoices = ["follow_draft", "hold", "reject"] as const;
export type OpeningChoice = (typeof branchChoices)[number];
export const openingBranches = branchChoices.flatMap((a) =>
  branchChoices.map((b) => [a, b] as const),
);
export type OpeningPlanOptions = {
  readonly seed: string;
  readonly throughDay?: number;
  readonly branches?: readonly (readonly [OpeningChoice, OpeningChoice])[];
  readonly extras?: boolean;
};
export type OpeningTask =
  | {
      readonly type: "opening";
      readonly day: 0;
      readonly throughDay: number;
      readonly choices: readonly [OpeningChoice, OpeningChoice];
    }
  | {
      readonly type: "ponder";
      readonly day: 0;
      readonly throughDay: 0;
      readonly messageIndex: number;
    }
  | {
      readonly type: "talk";
      readonly day: number;
      readonly throughDay: number;
      readonly message: string;
    }
  | {
      readonly type: "question";
      readonly day: number;
      readonly throughDay: number;
      readonly message: string;
      readonly actorId: string;
      readonly actorName: string;
    };

export const beijingQuestionTargets = Object.values(
  createInitialState("plan").actors,
)
  .filter((a) => a.llm && a.active && a.location === "beijing")
  .map((a) => ({ id: a.id, name: a.name }));

/** Historical measurement, not current pricing; see docs/issues/active/opening-packs.md. */
const smoke = {
  calls: 13,
  openingCalls: 2,
  days: 2,
  usdOffPeak: 0.043256004,
  usdPeak: 0.086512008,
};

export function openingPackPlan(options: OpeningPlanOptions) {
  const throughDay = options.throughDay ?? 5;
  if (!Number.isInteger(throughDay) || throughDay < 1)
    throw new Error("Opening pack days must be a positive integer");
  const branches = options.branches ?? openingBranches;
  const tasks: OpeningTask[] = branches.map((choices) => ({
    type: "opening",
    day: 0,
    throughDay,
    choices,
  }));
  if (options.extras !== false) {
    // The initial desk has two memorials; its total size is fixed before any model writes.
    const messages =
      imperialRules.minMessages +
      Math.floor(
        roll(options.seed, "inbox-size:0") *
          (imperialRules.maxMessages - imperialRules.minMessages + 1),
      );
    for (let messageIndex = 0; messageIndex < messages; messageIndex++)
      tasks.push({ type: "ponder", day: 0, throughDay: 0, messageIndex });
    for (let day = 0; day <= Math.min(2, throughDay); day++) {
      for (const message of imperialPresets.talk)
        tasks.push({ type: "talk", day, throughDay: day + 1, message });
      for (const actor of beijingQuestionTargets)
        for (const message of imperialPresets.question)
          tasks.push({
            type: "question",
            day,
            throughDay: day + 1,
            message,
            actorId: actor.id,
            actorName: actor.name,
          });
    }
  }
  const preparationThroughDay = Math.max(0, ...tasks.map((t) => t.day));
  const advances =
    preparationThroughDay +
    tasks.reduce((sum, t) => sum + t.throughDay - t.day, 0);
  const direct = tasks.filter(
    (t) => t.type === "talk" || t.type === "ponder",
  ).length;
  const estimatedCalls = Math.ceil(
    smoke.openingCalls +
      (advances * (smoke.calls - smoke.openingCalls)) / smoke.days +
      direct,
  );
  return {
    tasks: tasks as readonly OpeningTask[],
    preparationThroughDay,
    estimatedCalls,
    estimatedUsdOffPeak: (estimatedCalls * smoke.usdOffPeak) / smoke.calls,
    estimatedUsdPeak: (estimatedCalls * smoke.usdPeak) / smoke.calls,
  };
}

export function openingTaskLabel(task: OpeningTask): string {
  switch (task.type) {
    case "opening":
      return `day0 ${task.choices.join("/")} → day${task.throughDay}`;
    case "ponder":
      return `day0 ponder message#${task.messageIndex + 1}`;
    case "talk":
      return `day${task.day} 召吕芳：${task.message} → day${task.throughDay}`;
    case "question":
      return `day${task.day} 问${task.actorName}：${task.message} → day${task.throughDay}`;
  }
}

export function formatOpeningPlan(
  id: string,
  plan: ReturnType<typeof openingPackPlan>,
): string {
  const count = (type: OpeningTask["type"]) =>
    plan.tasks.filter((t) => t.type === type).length;
  const lines = [
    id,
    `  准备：开局 → 默认 day${plan.preparationThroughDay}（共享，不计入分叉条数）`,
  ];
  lines.push(
    `  主分支：${plan.tasks
      .filter((t) => t.type === "opening")
      .map((t) => t.choices.join("/"))
      .join(
        "、",
      )} → day${plan.tasks.find((t) => t.type === "opening")?.throughDay ?? 0}`,
  );
  if (count("ponder"))
    lines.push(`  深思：day0 消息 #1–#${count("ponder")}，每条独立展开并深思`);
  for (let day = 0; day <= plan.preparationThroughDay; day++) {
    const talks = plan.tasks.filter((t) => t.type === "talk" && t.day === day);
    const questions = plan.tasks.filter(
      (t) => t.type === "question" && t.day === day,
    );
    if (talks.length || questions.length)
      lines.push(
        `  day${day} → day${day + 1}：召吕芳 T1–T${talks.length}；${beijingQuestionTargets.map((a) => a.name).join("、")}各问 Q1–Q${imperialPresets.question.length}（${talks.length + questions.length} 条）`,
      );
  }
  lines.push(
    `  共 ${plan.tasks.length} 条 = 主分支 ${count("opening")} + 深思 ${count("ponder")} + 召见 ${count("talk")} + 发问 ${count("question")}`,
  );
  lines.push(
    `  粗估 ${plan.estimatedCalls} 次整日/文本调用，US$${plan.estimatedUsdOffPeak.toFixed(2)}–${plan.estimatedUsdPeak.toFixed(2)}`,
  );
  return lines.join("\n");
}
export const planEstimateNote =
  "估算依据：2026-10-16 浅白、归纳开启的冒烟到 day2 共13次（开局2次，其后均摊5.5次/推进日）；费用 US$0.043256004–0.086512008/13次。未扣指纹命中，按浅白样本外推各语体；不是报价或上限，终端整日计1次、不是HTTP请求数。";
