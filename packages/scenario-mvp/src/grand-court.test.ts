import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  createGrandInitialState,
  grandIds,
  grandView,
  reduceGrandState,
  runGrandCourt,
} from "./grand-court.ts";

describe("grand court (full pipeline)", () => {
  it("runs fiscal, accountability, lobbying, and faction balance in one game", async () => {
    const run = await runGrandCourt();
    const v = run.finalView;
    expect(v.treasuryTruth).toBe(60);
    expect(v.treasuryReported).toBe(100);
    expect(v.treasuryVerified).toBe(60);
    expect(v.resistanceEvidence).toBeDefined();
    expect(v.resistanceEvidence!).toBeLessThan(v.resistanceFlat);
    expect(v.removals).toBe(1);
    expect(v.privateMessages).toBe(2);
    expect(v.emperorInbox).toBe(0);
    expect(v.bribeStatus).toBe("rejected");
    expect(v.corruptionCount).toBe(0);
    expect(v.factionSupport.reform).toBeGreaterThan(0);
    expect(v.factionSupport.restore).toBeGreaterThan(0);
    expect(v.support).toBeGreaterThan(0);
    expect(v.oppose).toBeGreaterThan(0);
  });

  it("lobbies officials privately, changing their stance", async () => {
    const run = await runGrandCourt();
    expect(run.state.actors[grandIds.lv]?.ideology).not.toBe(0.6);
    expect(run.state.actors[grandIds.chancellor]?.ideology).toBeLessThan(-0.4);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runGrandCourt();
    expect(
      replay(createGrandInitialState(), run.records, reduceGrandState),
    ).toEqual(run.state);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() => reduceGrandState(createGrandInitialState(), unknown)).toThrow(
      "Unhandled grand-court event",
    );
  });

  it("exposes a view derived from state", async () => {
    const run = await runGrandCourt();
    expect(grandView(run.state, simTime(55)).removals).toBe(1);
  });
});
