import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  createBureaucracyInitialState,
  reduceBureaucracyState,
  runBureaucracyCycle,
} from "./bureaucracy-cycle.ts";

describe("bureaucracy cycle (5 ministers + 25 officers)", () => {
  it("builds a three-tier roster of one emperor, five ministers, twenty-five officers", async () => {
    const run = await runBureaucracyCycle({ rounds: 4 });
    const actors = Object.values(run.state.actors);
    expect(actors.filter((a) => a.tier === 1)).toHaveLength(1);
    expect(actors.filter((a) => a.tier === 2)).toHaveLength(5);
    expect(actors.filter((a) => a.tier === 3)).toHaveLength(25);
    const view = run.views.at(-1)!;
    expect(view.ministers.every((m) => m.officers === 5)).toBe(true);
  });

  it("logs explicit lobbying between ministers each round", async () => {
    const run = await runBureaucracyCycle({ rounds: 4 });
    expect(run.state.lobbyLog).toHaveLength(20);
    expect(run.views.at(-1)!.ministers.every((m) => m.lobbied === 4)).toBe(
      true,
    );
  });

  it("differentiates corruption by faction: reform falsifies, restore grafts", async () => {
    const view = (await runBureaucracyCycle({ rounds: 4 })).views.at(-1)!;
    expect(view.reformFalsification).toBeGreaterThan(view.restoreFalsification);
    expect(view.restoreGraft).toBeGreaterThan(view.reformGraft);
  });

  it("cascades distortion so the emperor sees more than was delivered", async () => {
    const view = (await runBureaucracyCycle({ rounds: 4 })).views.at(-1)!;
    expect(view.emperorReported).toBeGreaterThan(view.emperorActual);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runBureaucracyCycle({ rounds: 3 });
    expect(
      replay(
        createBureaucracyInitialState(),
        run.records,
        reduceBureaucracyState,
      ),
    ).toEqual(run.state);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() =>
      reduceBureaucracyState(createBureaucracyInitialState(), unknown),
    ).toThrow("Unhandled bureaucracy event");
  });
});
