import type { BribeDecision, BribeOfferView } from "@throne/shared-types";

export type BribeDecisionPolicy = {
  decide(view: BribeOfferView): Promise<BribeDecision> | BribeDecision;
};

const reference = 100;

export function evaluateBribe(view: BribeOfferView): {
  readonly benefit: number;
  readonly risk: number;
} {
  const motivations = view.recipientMotivations;
  const ratio = view.offerAmount / (view.offerAmount + reference);
  const relationshipPull =
    view.relationshipValence === undefined
      ? 0
      : Math.max(0, view.relationshipValence) * 0.2;
  const benefit = rounded(
    ratio * (0.5 + motivations.wealth) + relationshipPull,
  );
  const detection = view.detectionHint ?? 0.5;
  const risk = rounded(
    motivations.proceduralLegality * 0.8 +
      (1 - motivations.riskTolerance) * 0.3 +
      detection * 0.2,
  );
  return { benefit, risk };
}

export class HeuristicBribePolicy implements BribeDecisionPolicy {
  decide(view: BribeOfferView): BribeDecision {
    const { benefit, risk } = evaluateBribe(view);
    return {
      accept: benefit > risk,
      reason: `gain ${benefit} vs risk ${risk}`,
    };
  }
}

export class RecordedBribePolicy implements BribeDecisionPolicy {
  readonly #decisions: ReadonlyMap<string, BribeDecision>;
  constructor(decisions: ReadonlyMap<string, BribeDecision>) {
    this.#decisions = decisions;
  }
  decide(view: BribeOfferView): BribeDecision {
    const decision = this.#decisions.get(view.offerId);
    if (!decision) {
      throw new Error(`No recorded bribe decision for ${view.offerId}`);
    }
    return decision;
  }
}

export type BribeDecisionRunner = (
  view: BribeOfferView,
) => Promise<BribeDecision>;

export const bribeSystemPrompt = [
  "You are a political actor inside a simulation, not an assistant to the player.",
  "You are deciding whether to accept or reject a private payment tied to a specific request.",
  "Neither acceptance nor refusal is preselected. Weigh the gain against exposure risk, your own safety, your legal scruples, your obligations, and the counterparty's standing.",
  "Use only the supplied actor-visible information. Do not assume facts you were not given.",
  "Return a structured decision: { accept: boolean, reason: string } with a brief reason, not a chain of thought.",
].join("\n");

export function assertActorInstructions(instructions: string): void {
  if (instructions.trim().length === 0) {
    throw new Error("Bribe decision requires non-empty actor instructions");
  }
}

export class HarnessBribePolicy implements BribeDecisionPolicy {
  constructor(
    readonly runner: BribeDecisionRunner,
    readonly actorInstructions: string = bribeSystemPrompt,
  ) {
    assertActorInstructions(actorInstructions);
  }
  decide(view: BribeOfferView): Promise<BribeDecision> {
    return this.runner(view);
  }
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
