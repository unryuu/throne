import { describe, expect, it } from "vitest";
import {
  simTime,
  type DomainEvent,
  type RelationshipEdge,
} from "@throne/shared-types";
import {
  addAccountabilityActor,
  deriveEvidenceStrength,
  deriveResistanceToRemoval,
  emptyAccountabilityState,
  recordFinding,
  reduceAccountabilityEvent,
  type AccountabilityState,
} from "./accountability.ts";

const patronEdge: RelationshipEdge = {
  id: "relationship:patron-supports-loyal",
  sourceId: "actor:patron",
  targetId: "actor:loyal",
  kind: "informal_influence",
  strength: 0.9,
  valence: 0.8,
  updatedAt: simTime(0),
  evidenceRefs: [],
};

function base(): AccountabilityState {
  let state = addAccountabilityActor(emptyAccountabilityState, {
    id: "actor:loyal",
    influence: 1,
    loyaltyToRuler: 0.9,
  });
  state = addAccountabilityActor(state, {
    id: "actor:cold",
    influence: 1,
    loyaltyToRuler: 0.2,
  });
  state = addAccountabilityActor(state, {
    id: "actor:patron",
    influence: 0.8,
    loyaltyToRuler: 0.5,
  });
  state = {
    ...state,
    relationships: { [patronEdge.id]: patronEdge },
  };
  return recordFinding(state, {
    id: "finding:ledger",
    actorId: "actor:loyal",
    officeId: "office:chancellery",
    subject: "diverted payroll",
    claimRefs: ["return:1"],
    evidenceRefs: ["evidence:sealed-ledger"],
    strength: 0.9,
  });
}

describe("accountability layer", () => {
  it("derives evidence strength and halves it when disputed", () => {
    const state = base();
    expect(deriveEvidenceStrength(state, "finding:ledger")).toBe(0.9);
    const disputed = reduceAccountabilityEvent(state, {
      id: "d1",
      occurredAt: simTime(10),
      eventType: "finding.disputed",
      payload: { findingId: "finding:ledger" },
    });
    expect(deriveEvidenceStrength(disputed, "finding:ledger")).toBe(0.45);
  });

  it("makes an evidence-backed removal cheaper than a flat one", () => {
    const state = base();
    const backed = deriveResistanceToRemoval(
      state,
      "actor:loyal",
      "evidence",
      "finding:ledger",
    );
    const flat = deriveResistanceToRemoval(state, "actor:loyal", "flat");
    expect(backed.score).toBeLessThan(flat.score);
    expect(backed.evidenceStrength).toBe(0.9);
    expect(flat.evidenceStrength).toBe(0);
  });

  it("makes a loyal, well-backed actor harder to remove than an isolated one", () => {
    const state = base();
    const loyal = deriveResistanceToRemoval(state, "actor:loyal", "flat");
    const cold = deriveResistanceToRemoval(state, "actor:cold", "flat");
    expect(loyal.score).toBeGreaterThan(cold.score);
    expect(loyal.relationSupport).toBeGreaterThan(0);
  });

  it("requires a finding for an evidence-based removal", () => {
    const state = base();
    expect(() =>
      reduceAccountabilityEvent(state, {
        id: "r0",
        occurredAt: simTime(20),
        eventType: "removal.recorded",
        payload: {
          removalId: "removal:bad",
          actorId: "actor:loyal",
          officeId: "office:chancellery",
          basis: "evidence",
        },
      }),
    ).toThrow("requires a finding");

    const removed = reduceAccountabilityEvent(state, {
      id: "r1",
      occurredAt: simTime(20),
      eventType: "removal.recorded",
      payload: {
        removalId: "removal:1",
        actorId: "actor:loyal",
        officeId: "office:chancellery",
        basis: "evidence",
        findingId: "finding:ledger",
      },
    });
    expect(removed.removals).toHaveLength(1);
  });

  it("rejects unknown events", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() =>
      reduceAccountabilityEvent(emptyAccountabilityState, unknown),
    ).toThrow("Unhandled accountability event");
  });
});
