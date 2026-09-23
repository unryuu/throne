import type {
  CausalLinks,
  DomainEvent,
  JsonObject,
  ScheduledEvent,
  SimTime,
  SimulationRecord,
} from "@throne/shared-types";
import { simTime } from "@throne/shared-types";
import type { EventStore } from "./event-store.ts";
import { DeterministicIdFactory } from "./id-factory.ts";

export type DomainEventDraft = CausalLinks & {
  readonly eventType: string;
  readonly actorId?: string;
  readonly targetIds?: readonly string[];
  readonly payload: JsonObject;
};

export type ScheduledEventDraft = CausalLinks & {
  readonly scheduledAt: SimTime;
  readonly eventType: string;
  readonly actorId?: string;
  readonly targetIds?: readonly string[];
  readonly payload: JsonObject;
};

export type MutationPlan = {
  readonly events: readonly DomainEventDraft[];
  readonly scheduled?: readonly ScheduledEventDraft[];
};

export type BatchResolutionInput<State> = {
  readonly time: SimTime;
  readonly state: Readonly<State>;
  readonly events: readonly ScheduledEvent[];
};

export interface DomainModel<State> {
  resolveBatch(
    input: BatchResolutionInput<State>,
  ): Promise<MutationPlan> | MutationPlan;
  reduce(state: Readonly<State>, event: DomainEvent): State;
  validate?(
    before: Readonly<State>,
    after: Readonly<State>,
    events: readonly DomainEvent[],
  ): void;
}

export type ScheduleInput = Omit<ScheduledEventDraft, "scheduledAt"> & {
  readonly scheduledAt: SimTime;
};

export class SimulationKernel<State> {
  readonly #queue: ScheduledEvent[] = [];
  #ids: DeterministicIdFactory;
  #state: State;
  #time = simTime(0);

  constructor(
    initialState: State,
    readonly model: DomainModel<State>,
    readonly store: EventStore,
    runId: string,
  ) {
    this.#state = structuredClone(initialState) as State;
    this.#ids = new DeterministicIdFactory(runId);
  }

  /** Rebuilds state, clock and pending queue from records already in `store`. */
  static async restore<State>(
    initialState: State,
    model: DomainModel<State>,
    store: EventStore,
    runId: string,
  ): Promise<SimulationKernel<State>> {
    const records = await store.readAll();
    const kernel = new SimulationKernel(initialState, model, store, runId);
    const consumed = new Set<string>();
    const scheduled: ScheduledEvent[] = [];
    let time = 0;
    for (const record of records) {
      if (record.kind === "scheduled") scheduled.push(record.event);
      else if (record.kind === "consumed") {
        consumed.add(record.eventId);
        time = Math.max(time, record.consumedAt);
      } else {
        kernel.#state = model.reduce(kernel.#state, record.event);
        time = Math.max(time, record.event.occurredAt);
      }
    }
    kernel.#queue.push(...scheduled.filter((e) => !consumed.has(e.id)));
    kernel.#time = simTime(time);
    kernel.#ids = new DeterministicIdFactory(
      runId,
      records.filter((r) => r.kind !== "consumed").length,
    );
    return kernel;
  }

  get time(): SimTime {
    return this.#time;
  }

  get state(): Readonly<State> {
    return structuredClone(this.#state) as State;
  }

  get pendingEventCount(): number {
    return this.#queue.length;
  }

  async schedule(input: ScheduleInput): Promise<ScheduledEvent> {
    if (input.scheduledAt < this.#time) {
      throw new RangeError("Cannot schedule an event in the simulation past");
    }

    const event = this.#materializeScheduled(input, this.#time);
    await this.store.append([{ kind: "scheduled", event }]);
    this.#queue.push(event);
    return event;
  }

  async step(): Promise<boolean> {
    if (this.#queue.length === 0) return false;

    const earliest = Math.min(...this.#queue.map((event) => event.scheduledAt));
    const time = simTime(earliest);
    const batch = this.#queue
      .filter((event) => event.scheduledAt === time)
      .sort((left, right) => left.id.localeCompare(right.id));

    const plan = await this.model.resolveBatch({
      time,
      state: this.state,
      events: batch,
    });
    const committed = plan.events.map((draft): DomainEvent =>
      this.#materializeDomain(draft, time),
    );
    const followUps = (plan.scheduled ?? []).map((draft) => {
      if (draft.scheduledAt < time) {
        throw new RangeError(
          "A batch resolver cannot schedule an event in the simulation past",
        );
      }
      return this.#materializeScheduled(draft, time);
    });

    let nextState = this.#state;
    for (const event of committed) {
      nextState = this.model.reduce(nextState, event);
    }
    this.model.validate?.(this.#state, nextState, committed);

    const records: SimulationRecord[] = [
      ...batch.map((event) => ({
        kind: "consumed" as const,
        eventId: event.id,
        consumedAt: time,
      })),
      ...committed.map((event) => ({ kind: "committed" as const, event })),
      ...followUps.map((event) => ({ kind: "scheduled" as const, event })),
    ];
    await this.store.append(records);

    const consumedIds = new Set(batch.map((event) => event.id));
    this.#queue.splice(
      0,
      this.#queue.length,
      ...this.#queue.filter((event) => !consumedIds.has(event.id)),
      ...followUps,
    );
    this.#state = nextState;
    this.#time = time;
    return true;
  }

  async runUntilIdle(maxBatches = 10_000): Promise<void> {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (!(await this.step())) return;
    }

    throw new Error(
      `Simulation did not become idle within ${maxBatches} event batches`,
    );
  }

  #materializeScheduled(
    draft: ScheduledEventDraft,
    createdAt: SimTime,
  ): ScheduledEvent {
    return {
      ...draft,
      id: this.#ids.next("scheduled"),
      createdAt,
    };
  }

  #materializeDomain(
    draft: DomainEventDraft,
    occurredAt: SimTime,
  ): DomainEvent {
    return {
      ...draft,
      id: this.#ids.next("domain"),
      occurredAt,
    };
  }
}
