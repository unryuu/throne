import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  cycleInitialState,
  deriveAuthority,
  reducePolicyCycleState,
  runPolicyCycle,
  strongEmperorPolicy,
  weakEmperorPolicy,
} from "./policy-cycle.ts";

describe("policy cycle (oscillation and power shift)", () => {
  it("swings policy repeatedly under a strong emperor while authority rises", async () => {
    const run = await runPolicyCycle({
      policy: strongEmperorPolicy,
      sessions: 16,
    });
    const changes = run.state.acts.filter(
      (act) => act.kind === "endorse" || act.kind === "revert",
    ).length;
    expect(changes).toBeGreaterThanOrEqual(3);
    expect(run.state.acts.some((act) => act.kind === "imposed")).toBe(false);
    expect(deriveAuthority(run.state)).toBeGreaterThan(0.9);
  });

  it("collapses imperial authority under a deferring emperor so ministers impose policy", async () => {
    const run = await runPolicyCycle({
      policy: weakEmperorPolicy,
      sessions: 16,
    });
    expect(run.state.acts.some((act) => act.kind === "imposed")).toBe(true);
    expect(deriveAuthority(run.state)).toBeLessThan(0.2);
    expect(run.state.ruleValue).toBeDefined();
  });

  it("makes a deferring emperor strictly weaker than an asserting one", async () => {
    const strong = await runPolicyCycle({
      policy: strongEmperorPolicy,
      sessions: 16,
    });
    const weak = await runPolicyCycle({
      policy: weakEmperorPolicy,
      sessions: 16,
    });
    expect(deriveAuthority(weak.state)).toBeLessThan(
      deriveAuthority(strong.state),
    );
  });

  it("replays from committed records without model calls", async () => {
    const run = await runPolicyCycle({
      policy: weakEmperorPolicy,
      sessions: 8,
    });
    expect(
      replay(cycleInitialState, run.records, reducePolicyCycleState),
    ).toEqual(run.state);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() => reducePolicyCycleState(cycleInitialState, unknown)).toThrow(
      "Unhandled policy-cycle event",
    );
  });
});
