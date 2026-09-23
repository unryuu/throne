import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  createTierInitialState,
  reduceTierState,
  runTierCourt,
  tierIds,
} from "./three-tier-court.ts";

describe("three-tier court (reform + multi-level bribery)", () => {
  it("carries a reform decree down three tiers and distorts the return", async () => {
    const run = await runTierCourt();
    expect(run.view.ruleValue).toBe("new_law");
    expect(run.state.actors[tierIds.emperor]?.tier).toBe(1);
    expect(run.state.actors[tierIds.wang]?.tier).toBe(2);
    expect(run.state.actors[tierIds.governor]?.tier).toBe(3);
    expect(run.view.treasuryTruth).toBe(60);
    expect(run.view.treasuryReported).toBe(100);
    expect(run.view.treasuryVerified).toBe(100);
  });

  it("runs a cross-tier bribery chain and exposes it", async () => {
    const run = await runTierCourt();
    expect(run.view.chainHops).toBe(2);
    expect(run.view.chainDepth).toBe(1);
    expect(run.view.chainValue).toBe(60);
    expect(run.view.corruption).toBe(2);
    expect(run.view.patronageShare).toBe(40);
    expect(run.view.exposed).toBe(true);
    expect(run.view.findings).toBeGreaterThanOrEqual(3);
    expect(run.view.removals).toBeGreaterThanOrEqual(3);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runTierCourt();
    expect(
      replay(createTierInitialState(), run.records, reduceTierState),
    ).toEqual(run.state);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() => reduceTierState(createTierInitialState(), unknown)).toThrow(
      "Unhandled tier-court event",
    );
  });
});
