import type { Visitor } from "./passcodes.ts";
import { runsDirectory } from "@throne/agent-runtime/live";
import { loadRoutineEntries } from "./routine-library.ts";
import { cachedCall, fingerprint } from "@throne/agent-runtime/live";
import { chooseOpeningPack, type OpeningPack } from "./opening-pack-store.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createLiveTextModel,
  type LiveCallTrace,
} from "@throne/agent-runtime/live";
import { replay } from "@throne/sim-core";
import {
  createInitialState,
  courtSettingsSchema,
  type CourtSettings,
  reduceCourtState,
  startCourtSession,
  type AudienceAction,
  type CourtModel,
  type CourtRulerView,
  type CourtSession,
  type CourtState,
  type RescriptSubmission,
} from "@throne/court";
import type { SimulationRecord } from "@throne/shared-types";
import type { Locale } from "@throne/localization";
import { createTerminalCourtModel } from "./terminal-model.ts";

export type CourtSnapshot = {
  id: string;
  status: "waiting" | "running" | "failed" | "complete";
  view: CourtRulerView;
  error?: string;
  calls: number;
  openingPackId?: string;
  busy?: readonly string[];
};
export type CourtOperation = "create" | "rescript" | "act" | "retry";
type RunTracking = Visitor & { readonly callOffset: number };
export type CourtLifecycle = {
  readonly beforeCreate: (id: string, identity: Visitor) => Promise<void>;
  readonly saved: (
    saved: SavedCourtRun,
    operation: CourtOperation,
    day: number,
  ) => Promise<void>;
};
export type SavedCourtRun = {
  analytics?: RunTracking;
  version: 1;
  id: string;
  locale: Locale;
  status: CourtSnapshot["status"];
  error?: string;
  calls: LiveCallTrace[];
  records: readonly SimulationRecord[];
  state: CourtState;
};
export type CourtReview = {
  id: string;
  state: CourtState;
  calls: LiveCallTrace[];
};
type Entry = {
  persisted: boolean;
  analytics?: RunTracking;
  id: string;
  locale: Locale;
  session: CourtSession;
  calls: LiveCallTrace[];
  status: CourtSnapshot["status"];
  submitted: Set<string>;
  error?: string;
  pending?: Promise<CourtSnapshot>;
  busy: Set<string>;
};
export type CourtModelFactory = (
  onTrace: (trace: LiveCallTrace) => void,
) => CourtModel;

export class CourtService {
  readonly entries = new Map<string, Entry>();
  readonly progress = new Map<string, Set<string>>();
  busyMessages(id?: string): readonly string[] {
    return id
      ? [...(this.progress.get(id) ?? [])]
      : [...new Set([...this.progress.values()].flatMap((s) => [...s]))];
  }
  /** Terminal days read the log as files, so it is never cut short. */
  readonly fullLog = process.env.THRONE_NPC_MODE !== "form";
  constructor(
    readonly root: string,
    // THRONE_NPC_MODE=form keeps the one-shot reply for comparison runs.
    readonly modelFactory?: CourtModelFactory,
    readonly modelIdentity?: string,
    readonly lifecycle?: CourtLifecycle,
  ) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run id");
    return join(runsDirectory(this.root), "court", `${id}.json`);
  }

  model(calls: LiveCallTrace[], busy: Set<string>): CourtModel {
    const trace = (t: LiveCallTrace) => calls.push(t);
    const captures = new Map<string, (trace: LiveCallTrace) => void>();
    const underlying =
      this.modelFactory?.((t) => captures.get(t.decisionEpisodeId)?.(t)) ??
      (process.env.THRONE_NPC_MODE === "form"
        ? createLiveTextModel(this.root, trace)
        : createTerminalCourtModel(this.root, trace));
    return async (request) => {
      const name = request.bureau
        ? "通政司"
        : request.summaries
          ? "归纳书吏"
          : request.ponder
            ? "嘉靖"
            : String(
                (request.input.self as { name?: string } | undefined)?.name ??
                  "吕芳",
              );
      const key = `${name}正在忙碌……`;
      const onBusy = (active: boolean) => {
        if (active) busy.add(key);
        else busy.delete(key);
      };
      if (!this.modelFactory) return underlying({ ...request, onBusy });
      return cachedCall({
        root: this.root,
        episode: request.decisionEpisodeId,
        onTrace: trace,
        onBusy,
        validate: request.validate,
        request: {
          mode: "injected",
          model:
            this.modelIdentity ?? fingerprint(this.modelFactory.toString()),
          systemPrompt: request.systemPrompt,
          prompt: request.prompt,
          input: request.input,
        },
        run: async (emit) => {
          let recorded: LiveCallTrace | undefined;
          captures.set(request.decisionEpisodeId, (t) => {
            recorded = t;
          });
          const began = Date.now();
          let text: string;
          try {
            text = await underlying(request);
          } finally {
            captures.delete(request.decisionEpisodeId);
          }
          emit(
            recorded ?? {
              decisionEpisodeId: request.decisionEpisodeId,
              requestedProvider: "injected",
              requestedModel: this.modelIdentity ?? "injected",
              returnedProvider: null,
              returnedModel: null,
              thinking: "enabled",
              reasoningEffort: "high",
              thinkingObserved: false,
              durationMs: Date.now() - began,
              usage: {},
              status: "succeeded",
            },
          );
          return text;
        },
      });
    };
  }

  async create(
    locale: Locale,
    settings: Partial<CourtSettings> = {},
    options: {
      attribution?: Visitor;
      seed?: string;
      pack?: OpeningPack;
      excludePackIds?: readonly string[];
      usePacks?: boolean;
      operationId?: string;
    } = {},
  ): Promise<CourtSnapshot> {
    const preferences = courtSettingsSchema.parse(settings);
    const pack =
      options.pack ??
      (options.seed === undefined && options.usePacks !== false
        ? await chooseOpeningPack(
            this.root,
            preferences,
            locale,
            options.excludePackIds,
          )
        : undefined);
    if (
      pack &&
      (pack.locale !== locale ||
        JSON.stringify(pack.settings) !== JSON.stringify(preferences))
    )
      throw new Error("Opening pack settings mismatch");
    const id = randomUUID();
    if (options.attribution)
      await this.lifecycle?.beforeCreate(id, options.attribution);
    const busy = new Set<string>();
    this.progress.set(options.operationId ?? id, busy);
    this.progress.set(id, busy);
    const calls: LiveCallTrace[] = [];
    let initialError: string | undefined;
    const session = await startCourtSession({
      routineLibrary: loadRoutineEntries,
      runId: id,
      settings: preferences,
      ...(pack
        ? { seed: pack.seed, openingPackId: pack.id }
        : options.seed !== undefined
          ? { seed: options.seed }
          : {}),
      language: locale,
      model: this.model(calls, busy),
      fullLog: this.fullLog,
      onInitialFailure: (error) => {
        initialError = error instanceof Error ? error.message : String(error);
      },
    });
    const entry: Entry = {
      persisted: false,
      ...(options.attribution
        ? { analytics: { ...options.attribution, callOffset: 0 } }
        : {}),
      id,
      locale,
      session,
      calls,
      status: session.failed ? "failed" : "waiting",
      ...(initialError ? { error: initialError } : {}),
      submitted: new Set(),
      busy,
    };
    this.entries.set(id, entry);
    await this.save(entry, "create");
    return this.snapshot(entry);
  }

  async get(id: string): Promise<CourtSnapshot> {
    return this.snapshot(await this.load(id));
  }

  async submit(
    id: string,
    submission: RescriptSubmission,
    attribution?: Visitor,
  ): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.submitted.has(submission.audienceId))
      return entry.pending ?? this.snapshot(entry);
    if (entry.pending || entry.status !== "waiting")
      throw new Error("This audience is not open");
    const view = entry.session.view;
    if (view.audience?.id !== submission.audienceId)
      throw new Error("This audience is not open");
    this.attribute(entry, attribution);
    entry.submitted.add(submission.audienceId);
    return this.execute(
      entry,
      () => entry.session.submit(submission),
      "rescript",
      () => entry.submitted.delete(submission.audienceId),
    );
  }

  async act(
    id: string,
    audienceId: string,
    action: AudienceAction,
    attribution?: Visitor,
  ): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.pending || entry.status !== "waiting")
      throw new Error("This audience is not open");
    this.attribute(entry, attribution);
    return this.execute(
      entry,
      () => entry.session.act(audienceId, action),
      "act",
    );
  }

  async retry(id: string, attribution?: Visitor): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.pending) return entry.pending;
    if (entry.status !== "failed")
      throw new Error("Only a failed step can be retried");
    this.attribute(entry, attribution);
    return this.execute(entry, () => entry.session.retry(), "retry");
  }

  async review(id: string): Promise<CourtReview> {
    const saved = await this.read(id);
    if (saved.status !== "complete")
      throw new Error("Review is available after the reign segment ends");
    return { id, state: saved.state, calls: saved.calls };
  }

  async replay(id: string) {
    const saved = await this.read(id);
    if (saved.status !== "complete")
      throw new Error("Replay is available after the reign segment ends");
    const state = replay(
      createInitialState(id),
      saved.records,
      reduceCourtState,
    );
    if (JSON.stringify(state) !== JSON.stringify(saved.state))
      throw new Error("Replay differs from saved state");
    return {
      id,
      verified: true,
      committedEvents: saved.records.filter((r) => r.kind === "committed")
        .length,
    };
  }

  private async read(id: string): Promise<SavedCourtRun> {
    const saved = JSON.parse(
      await readFile(this.path(id), "utf8"),
    ) as SavedCourtRun;
    if (saved.version !== 1 || saved.id !== id || !Array.isArray(saved.records))
      throw new Error("Unsupported or damaged court record");
    if (
      saved.analytics &&
      (typeof saved.analytics.channel !== "string" ||
        !saved.analytics.channel ||
        typeof saved.analytics.visitor !== "string" ||
        !saved.analytics.visitor ||
        !Number.isSafeInteger(saved.analytics.callOffset) ||
        saved.analytics.callOffset < 0 ||
        saved.analytics.callOffset > saved.calls.length)
    )
      throw new Error("Invalid analytics attribution in court record");
    return saved;
  }

  private async load(id: string): Promise<Entry> {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const saved = await this.read(id);
    const calls = saved.calls;
    const busy = new Set<string>();
    this.progress.set(id, busy);
    const session = await startCourtSession({
      routineLibrary: loadRoutineEntries,
      runId: id,
      language: saved.locale,
      model: this.model(calls, busy),
      fullLog: this.fullLog,
      records: saved.records,
    });
    const phase = session.state.phase;
    const entry: Entry = {
      persisted: true,
      ...(saved.analytics ? { analytics: saved.analytics } : {}),
      id,
      locale: saved.locale,
      session,
      calls,
      status: session.failed
        ? "failed"
        : phase === "complete"
          ? "complete"
          : "waiting",
      submitted: new Set(),
      busy,
      ...(session.failed
        ? { error: saved.error ?? "Interrupted; retry to continue" }
        : {}),
    };
    this.entries.set(id, entry);
    this.trimMemory(entry);
    return entry;
  }

  private attribute(entry: Entry, attribution?: Visitor) {
    if (!entry.analytics && attribution)
      entry.analytics = { ...attribution, callOffset: entry.calls.length };
  }

  private execute(
    entry: Entry,
    run: () => Promise<void>,
    operation: CourtOperation,
    onFailure?: () => void,
  ): Promise<CourtSnapshot> {
    entry.persisted = false;
    entry.status = "running";
    delete entry.error;
    entry.pending = (async () => {
      try {
        await run();
        entry.status = entry.session.complete ? "complete" : "waiting";
      } catch (error) {
        entry.status = "failed";
        entry.error = error instanceof Error ? error.message : String(error);
        if (!entry.session.failed) {
          entry.status = "waiting";
          onFailure?.();
        }
      } finally {
        await this.save(entry, operation).catch((error: unknown) => {
          entry.status = "failed";
          entry.error = `Could not persist run or analytics: ${String(error)}`;
        });
        delete entry.pending;
      }
      return this.snapshot(entry);
    })();
    return entry.pending;
  }

  private async save(entry: Entry, operation: CourtOperation): Promise<void> {
    const saved: SavedCourtRun = {
      ...(entry.analytics ? { analytics: entry.analytics } : {}),
      version: 1,
      id: entry.id,
      locale: entry.locale,
      status: entry.status === "running" ? "failed" : entry.status,
      ...(entry.error ? { error: entry.error } : {}),
      calls: entry.calls,
      records: await entry.session.records(),
      state: entry.session.state,
    };
    const path = this.path(entry.id);
    await mkdir(join(runsDirectory(this.root), "court"), { recursive: true });
    await writeFile(path + ".tmp", JSON.stringify(saved), { mode: 0o600 });
    await rename(path + ".tmp", path);
    await this.lifecycle?.saved(
      saved,
      operation,
      Math.floor(entry.session.view.time / 12),
    );
    entry.persisted = true;
    this.trimMemory(entry);
  }

  private trimMemory(entry: Entry) {
    for (const [id, candidate] of this.entries) {
      if (this.entries.size <= 50) break;
      if (candidate === entry || candidate.pending || !candidate.persisted)
        continue;
      this.entries.delete(id);
      for (const [key, busy] of this.progress)
        if (busy === candidate.busy) this.progress.delete(key);
    }
  }

  private snapshot(entry: Entry): CourtSnapshot {
    return structuredClone({
      id: entry.id,
      status: entry.status,
      view: entry.session.view,
      calls: entry.calls.length,
      busy: [...entry.busy],
      ...(entry.session.state.openingPackId
        ? { openingPackId: entry.session.state.openingPackId }
        : {}),
      ...(entry.error ? { error: entry.error } : {}),
    });
  }
}
