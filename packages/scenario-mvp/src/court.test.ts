import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  courtIds,
  createCourtInitialState,
  deriveCourtFactionSupport,
  deriveCourtStance,
  reduceCourtState,
  runCourtScenario,
} from "./court.ts";

describe("court scenario", () => {
  it("separates objective balance from the reported and audited figures", async () => {
    const run = await runCourtScenario();
    expect(run.finalView.treasuryTruth).toBe(60);
    expect(run.finalView.treasuryReported).toBe(100);
    expect(run.finalView.treasuryVerified).toBe(60);
  });

  it("records a documented removal that resists less than a flat one", async () => {
    const run = await runCourtScenario();
    expect(run.state.accountability.removals).toHaveLength(1);
    expect(run.finalView.resistanceEvidence).toBeLessThan(
      run.finalView.resistanceFlat,
    );
  });

  it("derives faction support and stance from typed motivations", async () => {
    const state = (await runCourtScenario()).state;
    const support = deriveCourtFactionSupport(state);
    expect(support.reform).toBeGreaterThan(0);
    expect(support.restore).toBeGreaterThan(0);
    expect(deriveCourtStance(state, courtIds.wang, "reform")).toBeGreaterThan(
      0,
    );
    expect(deriveCourtStance(state, courtIds.sima, "reform")).toBeLessThan(0);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runCourtScenario();
    expect(
      replay(createCourtInitialState(), run.records, reduceCourtState),
    ).toEqual(run.state);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() => reduceCourtState(createCourtInitialState(), unknown)).toThrow(
      "Unhandled court event",
    );
  });
});
