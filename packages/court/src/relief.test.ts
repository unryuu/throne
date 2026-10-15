import { describe, expect, it } from "vitest";
import { InMemoryEventStore, SimulationKernel, replay } from "@throne/sim-core";
import { at } from "./calendar.ts";
import { createInitialState, ids } from "./jiajing.ts";
import { createCourtModel, reduceCourtState } from "./model.ts";
import type { CourtState } from "./types.ts";

describe("merchant relief settlement", () => {
  it.each([
    { homeless: 0, floodedMu: 0, succeeds: false },
    { homeless: 2, floodedMu: 0, succeeds: true },
    { homeless: 0, floodedMu: 3, succeeds: true },
    { homeless: 2, floodedMu: 3, succeeds: true },
  ])(
    "checks current disaster conditions: %j",
    async ({ homeless, floodedMu, succeeds }) => {
      const { initial, kernel, store } = await settle(
        "relief_merchant",
        homeless,
        floodedMu,
      );
      const state = kernel.state;
      const action = state.actions.relief!;
      expect(action.status).toBe(succeeds ? "succeeded" : "failed");
      if (succeeds) {
        expect(action.outcome).toEqual({ amount: 2, landTakenMu: 2 });
        expect(state.merchantGrain).toBe(initial.merchantGrain - 2);
        expect(state.counties.jiande.paddyMu).toBe(
          initial.counties.jiande.paddyMu - 2,
        );
        expect(state.counties.jiande.annexedMu).toBe(
          initial.counties.jiande.annexedMu + 2,
        );
        expect(state.counties.jiande.merchantGrainDelivered).toBe(2);
      } else {
        expect(action.outcome?.reason).toBe(
          "县中既无灾民也无淹田，办不成以粮换田",
        );
        expect(state.merchantGrain).toBe(initial.merchantGrain);
        expect(state.counties).toEqual(initial.counties);
        expect(JSON.stringify(state.observations)).toContain(
          String(action.outcome?.reason),
        );
      }
      expect(replay(initial, await store.readAll(), reduceCourtState)).toEqual(
        state,
      );
    },
  );

  it.each(["relief_granary", "relief_military"])(
    "leaves ordinary %s deliveries unchanged",
    async (capability) => {
      const { initial, kernel } = await settle(capability, 0, 0);
      expect(kernel.state.actions.relief!.status).toBe("succeeded");
      expect(kernel.state.counties.jiande.reliefDelivered).toBe(2);
      expect(kernel.state.counties.jiande.paddyMu).toBe(
        initial.counties.jiande.paddyMu,
      );
    },
  );
});

async function settle(
  capabilityId: string,
  homeless: number,
  floodedMu: number,
) {
  const base = createInitialState("relief-test");
  const initial: CourtState = {
    ...base,
    counties: {
      ...base.counties,
      jiande: { ...base.counties.jiande, homeless, floodedMu },
    },
    actions: {
      relief: {
        id: "relief",
        actorId: ids.zheng,
        capabilityId,
        parameters: { countyId: "jiande", amount: 2 },
        status: "started",
        startedAt: at(0),
        resolveAt: at(3),
        decisionEpisodeId: "relief-decision",
      },
    },
  };
  const model = createCourtModel({
    runId: "relief-test",
    language: "zh-CN",
    model: async () => {
      throw new Error("Settlement must not call a model");
    },
  });
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(initial, model, store, "relief-test");
  await kernel.schedule({
    eventType: "action.resolve",
    scheduledAt: at(3),
    payload: { actionId: "relief" },
  });
  await kernel.step();
  return { initial, kernel, store };
}
