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

export type CourtSnapshot = {
  id: string;
  status: "waiting" | "running" | "failed" | "complete";
  view: CourtRulerView;
  error?: string;
  calls: number;
};
export type SavedCourtRun = {
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
  id: string;
  locale: Locale;
  session: CourtSession;
  calls: LiveCallTrace[];
  status: CourtSnapshot["status"];
  submitted: Set<string>;
  error?: string;
  pending?: Promise<CourtSnapshot>;
};
export type CourtModelFactory = (
  onTrace: (trace: LiveCallTrace) => void,
) => CourtModel;

export class CourtService {
  readonly entries = new Map<string, Entry>();
  constructor(
    readonly root: string,
    readonly modelFactory: CourtModelFactory = (trace) =>
      createLiveTextModel(root, trace),
  ) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run id");
    return join(this.root, "runs", "court", `${id}.json`);
  }

  async create(locale: Locale): Promise<CourtSnapshot> {
    if (this.entries.size >= 50)
      throw new Error(
        "Local session limit reached; restart the development server",
      );
    const id = randomUUID();
    const calls: LiveCallTrace[] = [];
    const session = await startCourtSession({
      runId: id,
      language: locale,
      model: this.modelFactory((trace) => calls.push(trace)),
    });
    const entry: Entry = {
      id,
      locale,
      session,
      calls,
      status: "waiting",
      submitted: new Set(),
    };
    this.entries.set(id, entry);
    await this.save(entry);
    return this.snapshot(entry);
  }

  async get(id: string): Promise<CourtSnapshot> {
    return this.snapshot(await this.load(id));
  }

  async submit(
    id: string,
    submission: RescriptSubmission,
  ): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.submitted.has(submission.audienceId))
      return entry.pending ?? this.snapshot(entry);
    if (entry.pending || entry.status !== "waiting")
      throw new Error("This audience is not open");
    const view = entry.session.view;
    if (view.audience?.id !== submission.audienceId)
      throw new Error("This audience is not open");
    entry.submitted.add(submission.audienceId);
    return this.execute(
      entry,
      () => entry.session.submit(submission),
      () => entry.submitted.delete(submission.audienceId),
    );
  }

  async act(
    id: string,
    audienceId: string,
    action: AudienceAction,
  ): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.pending || entry.status !== "waiting")
      throw new Error("This audience is not open");
    return this.execute(entry, () => entry.session.act(audienceId, action));
  }

  async retry(id: string): Promise<CourtSnapshot> {
    const entry = await this.load(id);
    if (entry.pending) return entry.pending;
    if (entry.status !== "failed")
      throw new Error("Only a failed step can be retried");
    return this.execute(entry, () => entry.session.retry());
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
    return saved;
  }

  private async load(id: string): Promise<Entry> {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const saved = await this.read(id);
    const calls = saved.calls;
    const session = await startCourtSession({
      runId: id,
      language: saved.locale,
      model: this.modelFactory((trace) => calls.push(trace)),
      records: saved.records,
    });
    const phase = session.state.phase;
    const entry: Entry = {
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
      ...(session.failed
        ? { error: saved.error ?? "Interrupted; retry to continue" }
        : {}),
    };
    this.entries.set(id, entry);
    return entry;
  }

  private execute(
    entry: Entry,
    run: () => Promise<void>,
    onFailure?: () => void,
  ): Promise<CourtSnapshot> {
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
        await this.save(entry).catch((error: unknown) => {
          entry.status = "failed";
          entry.error = `Could not save run: ${String(error)}`;
        });
        delete entry.pending;
      }
      return this.snapshot(entry);
    })();
    return entry.pending;
  }

  private async save(entry: Entry): Promise<void> {
    const saved: SavedCourtRun = {
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
    await mkdir(join(this.root, "runs", "court"), { recursive: true });
    await writeFile(path + ".tmp", JSON.stringify(saved), { mode: 0o600 });
    await rename(path + ".tmp", path);
  }

  private snapshot(entry: Entry): CourtSnapshot {
    return structuredClone({
      id: entry.id,
      status: entry.status,
      view: entry.session.view,
      calls: entry.calls.length,
      ...(entry.error ? { error: entry.error } : {}),
    });
  }
}
