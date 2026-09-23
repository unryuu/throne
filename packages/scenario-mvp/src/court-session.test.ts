import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  courtSessionIds,
  courtSessionInitialState,
  reduceCourtSessionState,
  runCourtSession,
} from "./court-session.ts";

describe("court session", () => {
  it("lets officials change each other's stance through private lobbying", async () => {
    const run = await runCourtSession();
    const initialFan = courtSessionInitialState.actors[courtSessionIds.fan];
    const initialChancellor =
      courtSessionInitialState.actors[courtSessionIds.chancellor];
    expect(run.state.actors[courtSessionIds.fan]?.ideology).toBeGreaterThan(
      initialFan!.ideology,
    );
    expect(run.state.actors[courtSessionIds.chancellor]?.ideology).toBeLessThan(
      initialChancellor!.ideology,
    );
    expect(run.finalView.ruleValue).toBeDefined();
  });

  it("delivers lobbying to recipients only, never to the emperor", async () => {
    const run = await runCourtSession();
    const messages = Object.values(run.state.messages);
    expect(messages).toHaveLength(4);
    expect(messages.every((message) => message.status === "delivered")).toBe(
      true,
    );
    expect(run.state.observations).toHaveLength(4);
    expect(
      run.state.observations.every(
        (observation) => observation.actorId !== courtSessionIds.emperor,
      ),
    ).toBe(true);
    expect(run.finalView.emperorObservations).toHaveLength(0);
  });

  it("lets the emperor decide from the public tally", async () => {
    const run = await runCourtSession();
    const vote = run.state.vote;
    expect(vote).toBeDefined();
    expect(vote!.support).toBeGreaterThan(0);
    expect(vote!.oppose).toBeGreaterThan(0);
    const endorsed = vote!.support > vote!.oppose;
    expect(run.finalView.ruleValue).toBe(endorsed ? "new_law" : "old_law");
  });

  it("replays from committed records without model calls", async () => {
    const run = await runCourtSession();
    expect(
      replay(courtSessionInitialState, run.records, reduceCourtSessionState),
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
      reduceCourtSessionState(courtSessionInitialState, unknown),
    ).toThrow("Unhandled court-session event");
  });
});
