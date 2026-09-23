import type { SimulationRecord } from "@throne/shared-types";
import { InMemoryEventStore, SimulationKernel } from "@throne/sim-core";
import { createInitialState, firstWorldCheckAt } from "./jiajing.ts";
import { createCourtModel, type RescriptSubmission } from "./model.ts";
import { parseCourtDecision, type CourtModel } from "./npc.ts";
import type { CourtState } from "./types.ts";
import {
  courtRulerView,
  parseSubmission,
  submissionProblem,
  type CourtRulerView,
} from "./views.ts";

export type CourtSession = {
  readonly view: CourtRulerView;
  readonly complete: boolean;
  /** True after a step failed; the queue still holds the failed batch. */
  readonly failed: boolean;
  submit(submission: RescriptSubmission): Promise<void>;
  retry(): Promise<void>;
  records(): Promise<readonly SimulationRecord[]>;
  /** Full objective state; callers must only expose it after completion. */
  readonly state: CourtState;
};

export async function startCourtSession(options: {
  runId: string;
  language: string;
  model: CourtModel;
  records?: readonly SimulationRecord[];
}): Promise<CourtSession> {
  const memo = new Map<string, string>();
  const model: CourtModel = async (request) => {
    const cached = memo.get(request.decisionEpisodeId);
    if (cached !== undefined) return cached;
    // One re-ask on malformed output; provider errors surface immediately.
    for (let attempt = 1; ; attempt += 1) {
      const text = await options.model(request);
      try {
        parseCourtDecision(text);
      } catch (error) {
        if (attempt < 2) continue;
        throw error;
      }
      memo.set(request.decisionEpisodeId, text);
      return text;
    }
  };
  const initial = createInitialState(options.runId);
  const domain = createCourtModel({
    runId: options.runId,
    language: options.language,
    model,
  });
  const store = new InMemoryEventStore();
  let kernel: SimulationKernel<CourtState>;
  if (options.records) {
    await store.append(options.records);
    kernel = await SimulationKernel.restore(
      initial,
      domain,
      store,
      options.runId,
    );
  } else {
    kernel = new SimulationKernel(initial, domain, store, options.runId);
    for (const [eventType, scheduledAt] of [
      ["court.audience_open", initial.audienceScheduledAt!],
      ["world.flood", initial.flood.at],
      ["world.check", firstWorldCheckAt],
      ["world.end", initial.endsAt],
    ] as const)
      await kernel.schedule({ eventType, scheduledAt, payload: {} });
  }
  let busy = false;
  const consumed = new Set(
    (options.records ?? []).flatMap((r) =>
      r.kind === "consumed" ? [r.eventId] : [],
    ),
  );
  let failed =
    kernel.state.phase === "running"
      ? Boolean(options.records)
      : (options.records ?? []).some(
          (r) =>
            r.kind === "scheduled" &&
            r.event.eventType === "court.rescript" &&
            !consumed.has(r.event.id),
        );
  const advance = async (before?: () => Promise<unknown>) => {
    if (busy) throw new Error("The court is already advancing");
    busy = true;
    try {
      await before?.();
      failed = true;
      do if (!(await kernel.step())) break;
      while (kernel.state.phase === "running");
      failed = false;
    } finally {
      busy = false;
    }
  };
  if (!options.records) await advance();
  return {
    get view() {
      return courtRulerView(kernel.state, kernel.time);
    },
    get complete() {
      return kernel.state.phase === "complete";
    },
    get failed() {
      return failed;
    },
    get state() {
      return kernel.state;
    },
    async submit(input) {
      if (busy) throw new Error("The court is already advancing");
      const submission = parseSubmission(input);
      const problem = submissionProblem(kernel.state, submission);
      if (problem) throw new Error(problem);
      await advance(() =>
        kernel.schedule({
          eventType: "court.rescript",
          scheduledAt: kernel.time,
          payload: { submission: structuredClone(submission) as never },
        }),
      );
    },
    async retry() {
      if (!failed) throw new Error("There is no failed step to retry");
      await advance();
    },
    records: () => store.readAll(),
  };
}
