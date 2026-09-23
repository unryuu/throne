import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { InMemoryEventStore } from "./event-store.ts";
import { SimulationKernel, type DomainModel } from "./kernel.ts";
import { replay } from "./replay.ts";

type State = { total: number; resolvedBatchSizes: number[] };

const initialState: State = { total: 0, resolvedBatchSizes: [] };

const model: DomainModel<State> = {
  resolveBatch({ events }) {
    return {
      events: [
        {
          eventType: "counter.increased",
          payload: {
            amount: events.reduce(
              (sum, event) => sum + Number(event.payload.amount),
              0,
            ),
            batchSize: events.length,
          },
        },
      ],
    };
  },
  reduce(state, event) {
    return {
      total: state.total + Number(event.payload.amount),
      resolvedBatchSizes: [
        ...state.resolvedBatchSizes,
        Number(event.payload.batchSize),
      ],
    };
  },
  validate(_before, after) {
    if (after.total < 0) throw new Error("total cannot be negative");
  },
};

describe("SimulationKernel", () => {
  it("resolves simultaneous events as one batch and replays committed history", async () => {
    const store = new InMemoryEventStore();
    const kernel = new SimulationKernel(initialState, model, store, "test-run");

    await kernel.schedule({
      eventType: "increase",
      scheduledAt: simTime(10),
      payload: { amount: 1 },
    });
    await kernel.schedule({
      eventType: "increase",
      scheduledAt: simTime(10),
      payload: { amount: 2 },
    });
    await kernel.runUntilIdle();

    expect(kernel.state).toEqual({ total: 3, resolvedBatchSizes: [2] });
    const records = await store.readAll();
    expect(replay(initialState, records, model.reduce)).toEqual(kernel.state);
  });

  it("does not commit an invalid transaction", async () => {
    const store = new InMemoryEventStore();
    const kernel = new SimulationKernel(
      initialState,
      model,
      store,
      "invalid-run",
    );
    await kernel.schedule({
      eventType: "increase",
      scheduledAt: simTime(1),
      payload: { amount: -1 },
    });

    await expect(kernel.step()).rejects.toThrow("total cannot be negative");
    const committed = (await store.readAll()).filter(
      (record): record is { kind: "committed"; event: DomainEvent } =>
        record.kind === "committed",
    );
    expect(committed).toHaveLength(0);
    expect(kernel.state).toEqual(initialState);
  });
});

describe("SimulationKernel.restore", () => {
  it("continues a partly run history with the same ids and results", async () => {
    const full = new SimulationKernel(
      initialState,
      model,
      new InMemoryEventStore(),
      "restore-run",
    );
    const partialStore = new InMemoryEventStore();
    const partial = new SimulationKernel(
      initialState,
      model,
      partialStore,
      "restore-run",
    );
    for (const kernel of [full, partial]) {
      await kernel.schedule({
        eventType: "increase",
        scheduledAt: simTime(5),
        payload: { amount: 1 },
      });
      await kernel.schedule({
        eventType: "increase",
        scheduledAt: simTime(9),
        payload: { amount: 4 },
      });
    }
    await full.runUntilIdle();
    await partial.step();

    const copy = new InMemoryEventStore();
    await copy.append(await partialStore.readAll());
    const restored = await SimulationKernel.restore(
      initialState,
      model,
      copy,
      "restore-run",
    );
    expect(restored.time).toBe(5);
    expect(restored.pendingEventCount).toBe(1);
    await restored.runUntilIdle();
    expect(restored.state).toEqual(full.state);
    expect(await copy.readAll()).toEqual(await full.store.readAll());
  });
});
