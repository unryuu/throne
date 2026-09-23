import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  createNetworkInitialState,
  networkIds,
  reduceNetworkState,
  runNetworkCourt,
} from "./network-court.ts";

describe("patronage and corruption network", () => {
  it("runs a two-hop bribe chain that covers up the diversion", async () => {
    const run = await runNetworkCourt();
    expect(run.view.chainHops).toBe(2);
    expect(run.view.chainDepth).toBe(1);
    expect(run.view.chainValue).toBe(70);
    expect(run.view.obligations).toBe(2);
    expect(run.view.treasuryTruth).toBe(40);
    expect(run.view.treasuryReported).toBe(100);
    expect(run.view.treasuryVerified).toBe(100);
  });

  it("derives the patron's share and the network's protection", async () => {
    const run = await runNetworkCourt();
    expect(run.view.patronageShare).toBe(50);
    expect(run.view.protectionScore).toBeCloseTo(0.56, 5);
    expect(run.view.corruption).toBe(2);
  });

  it("lets the network dispute the finding against its member", async () => {
    const run = await runNetworkCourt();
    expect(run.view.disputes).toBe(1);
    expect(run.state.accountability.disputes).toContain(networkIds.finding);
  });

  it("exposes the chain and prosecutes every participant", async () => {
    const run = await runNetworkCourt();
    expect(run.view.exposed).toBe(true);
    expect(run.view.findings).toBeGreaterThanOrEqual(3);
    expect(run.view.removals).toBeGreaterThanOrEqual(3);
    expect(
      run.state.accountability.removals.every(
        (removal) =>
          removal.basis === "evidence" && removal.findingId !== undefined,
      ),
    ).toBe(true);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runNetworkCourt();
    expect(
      replay(createNetworkInitialState(), run.records, reduceNetworkState),
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
      reduceNetworkState(createNetworkInitialState(), unknown),
    ).toThrow("Unhandled network event");
  });
});
