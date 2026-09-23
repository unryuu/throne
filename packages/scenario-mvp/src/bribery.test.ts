import { describe, expect, it } from "vitest";
import {
  simTime,
  type BribeOfferView,
  type DomainEvent,
  type MotivationProfile,
} from "@throne/shared-types";
import {
  HarnessBribePolicy,
  HeuristicBribePolicy,
  RecordedBribePolicy,
  assertActorInstructions,
  evaluateBribe,
} from "@throne/agent-runtime/bribe";
import {
  addBriberyActor,
  deriveCorruptionEvidence,
  emptyBriberyState,
  reduceBriberyEvent,
  type BriberyState,
} from "./bribery.ts";

function profile(overrides: Partial<MotivationProfile>): MotivationProfile {
  return {
    selfPreservation: 0.5,
    wealth: 0.5,
    officeRetention: 0.5,
    ambition: 0.5,
    loyaltyToRuler: 0.5,
    loyaltyToState: 0.5,
    loyaltyToFamily: 0.5,
    loyaltyToOrganization: 0.5,
    ideologicalCommitment: 0.5,
    regionalAttachment: 0.5,
    reputation: 0.5,
    concernForSubordinates: 0.5,
    riskTolerance: 0.5,
    revenge: 0.5,
    fearOfDisorder: 0.5,
    proceduralLegality: 0.5,
    ...overrides,
  };
}

const principled = profile({
  wealth: 0.4,
  proceduralLegality: 0.9,
  riskTolerance: 0.4,
});
const corrupt = profile({
  wealth: 0.9,
  proceduralLegality: 0.2,
  riskTolerance: 0.7,
});

function view(
  recipientMotivations: MotivationProfile,
  offerAmount = 40,
): BribeOfferView {
  return {
    offerId: "bribe:1",
    briberId: "actor:briber",
    recipientId: "actor:recipient",
    offerAmount,
    targetRef: "audit:governor",
    recipientMotivations,
    recipientInfluence: 1,
  };
}

function base(): BriberyState {
  let state = addBriberyActor(emptyBriberyState, {
    id: "actor:briber",
    motivations: profile({}),
  });
  state = addBriberyActor(state, {
    id: "actor:principled",
    motivations: principled,
  });
  state = addBriberyActor(state, {
    id: "actor:corrupt",
    motivations: corrupt,
  });
  return state;
}

function event(
  eventType: string,
  id: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return { id, occurredAt: simTime(10), eventType, payload: payload as never };
}

describe("bribery layer", () => {
  it("derives benefit and risk from actor-visible motivations", () => {
    const p = evaluateBribe(view(principled));
    const c = evaluateBribe(view(corrupt));
    expect(c.benefit).toBeGreaterThan(p.benefit);
    expect(c.risk).toBeLessThan(p.risk);
  });

  it("rejects a principled official and accepts a corrupt one", () => {
    const policy = new HeuristicBribePolicy();
    expect(policy.decide(view(principled)).accept).toBe(false);
    expect(policy.decide(view(corrupt)).accept).toBe(true);
  });

  it("raises acceptance monotonically with wealth and lowers it with legality", () => {
    const policy = new HeuristicBribePolicy();
    const lowWealth = policy.decide(view(profile({ wealth: 0.2 }))).accept;
    const highWealth = policy.decide(view(profile({ wealth: 0.95 }))).accept;
    expect(Number(highWealth)).toBeGreaterThanOrEqual(Number(lowWealth));
    const lawful = policy.decide(view(profile({ proceduralLegality: 0.95 })));
    const lawless = policy.decide(view(profile({ proceduralLegality: 0.05 })));
    expect(Number(lawless.accept)).toBeGreaterThanOrEqual(
      Number(lawful.accept),
    );
  });

  it("records offers, resolutions, and corruption evidence", () => {
    let state = base();
    state = reduceBriberyEvent(
      state,
      event("bribe.offered", "b1", {
        bribeId: "bribe:1",
        chainId: "chain:1",
        fromId: "actor:briber",
        toId: "actor:corrupt",
        amount: 40,
        targetRef: "audit:governor",
      }),
    );
    expect(state.bribes["bribe:1"]?.status).toBe("offered");
    state = reduceBriberyEvent(
      state,
      event("bribe.accepted", "b2", {
        bribeId: "bribe:1",
        reason: "gain outweighs risk",
      }),
    );
    expect(state.bribes["bribe:1"]?.status).toBe("accepted");
    state = reduceBriberyEvent(
      state,
      event("corruption.recorded", "b3", {
        corruptionId: "corruption:1",
        actorId: "actor:corrupt",
        bribeId: "bribe:1",
        amount: 40,
        evidenceRefs: ["bribe:1"],
      }),
    );
    expect(deriveCorruptionEvidence(state, "actor:corrupt")).toEqual([
      "corruption:1",
    ]);
  });

  it("replays from a recorded decision and fails when none exists", () => {
    const recorded = new RecordedBribePolicy(
      new Map([["bribe:1", { accept: true, reason: "recorded" }]]),
    );
    expect(recorded.decide(view(corrupt)).accept).toBe(true);
    expect(() =>
      recorded.decide({ ...view(principled), offerId: "bribe:missing" }),
    ).toThrow("No recorded bribe decision");
  });

  it("requires non-empty actor instructions for a harness policy", () => {
    expect(() => assertActorInstructions("")).toThrow(
      "non-empty actor instructions",
    );
    expect(
      () =>
        new HarnessBribePolicy(
          async () => ({ accept: false, reason: "x" }),
          "",
        ),
    ).toThrow("non-empty actor instructions");
  });

  it("rejects unknown events and unresolvable bribes", () => {
    expect(() =>
      reduceBriberyEvent(base(), event("typo.unknown", "x", {})),
    ).toThrow("Unhandled bribery event");
    expect(() =>
      reduceBriberyEvent(
        base(),
        event("bribe.rejected", "y", { bribeId: "missing", reason: "no" }),
      ),
    ).toThrow("Unknown bribe");
  });
});
