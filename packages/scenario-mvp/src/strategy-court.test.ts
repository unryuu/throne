import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import type {
  ActorActionPolicy,
  ActorAction,
} from "@throne/agent-runtime/action";
import {
  createStrategyInitialState,
  reduceStrategyState,
  runStrategyCourt,
  strategyIds,
} from "./strategy-court.ts";

const choose = (action: ActorAction): ActorActionPolicy => ({
  decide() {
    return action;
  },
});

describe("strategy court (unified action space)", () => {
  it("executes a bribe choice and resolves it with the bribe policy", async () => {
    const run = await runStrategyCourt(
      choose({
        kind: "bribe",
        recipientId: strategyIds.auditor,
        offerAmount: 40,
        targetRef: strategyIds.misconduct,
      }),
    );
    expect(run.state.chosen).toBe("bribe");
    const bribe = Object.values(run.state.bribes.bribes)[0];
    expect(bribe?.status).toBe("rejected");
    expect(run.state.bribes.corruption).toHaveLength(0);
  });

  it("executes a report choice", async () => {
    const run = await runStrategyCourt(
      choose({ kind: "report", subjectRef: strategyIds.misconduct }),
    );
    expect(run.state.chosen).toBe("report");
    expect(run.state.reports).toHaveLength(1);
  });

  it("rejects an action outside the actor's available set", async () => {
    await expect(runStrategyCourt(choose({ kind: "defect" }))).rejects.toThrow(
      "not available",
    );
  });

  it("rejects targeting an unknown subject", async () => {
    await expect(
      runStrategyCourt(
        choose({
          kind: "bribe",
          recipientId: strategyIds.auditor,
          offerAmount: 10,
          targetRef: "subject:unknown",
        }),
      ),
    ).rejects.toThrow("unknown subject");
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() =>
      reduceStrategyState(createStrategyInitialState(), unknown),
    ).toThrow("Unhandled strategy event");
  });
});
