import type { JsonValue } from "./json.ts";
import type { SimTime } from "./time.ts";

export type MotivationProfile = {
  readonly selfPreservation: number;
  readonly wealth: number;
  readonly officeRetention: number;
  readonly ambition: number;
  readonly loyaltyToRuler: number;
  readonly loyaltyToState: number;
  readonly loyaltyToFamily: number;
  readonly loyaltyToOrganization: number;
  readonly ideologicalCommitment: number;
  readonly regionalAttachment: number;
  readonly reputation: number;
  readonly concernForSubordinates: number;
  readonly riskTolerance: number;
  readonly revenge: number;
  readonly fearOfDisorder: number;
  readonly proceduralLegality: number;
};

export const motivationKeys: readonly (keyof MotivationProfile)[] = [
  "selfPreservation",
  "wealth",
  "officeRetention",
  "ambition",
  "loyaltyToRuler",
  "loyaltyToState",
  "loyaltyToFamily",
  "loyaltyToOrganization",
  "ideologicalCommitment",
  "regionalAttachment",
  "reputation",
  "concernForSubordinates",
  "riskTolerance",
  "revenge",
  "fearOfDisorder",
  "proceduralLegality",
];

export type RelationshipKindV2 =
  | "formal_command"
  | "legal_recognition"
  | "funding"
  | "appointment"
  | "personal_loyalty"
  | "informal_influence"
  | "organizational_membership"
  | "communication_access"
  | "information_access"
  | "physical_access"
  | "control_over_infrastructure";

export const relationshipKindsV2: readonly RelationshipKindV2[] = [
  "formal_command",
  "legal_recognition",
  "funding",
  "appointment",
  "personal_loyalty",
  "informal_influence",
  "organizational_membership",
  "communication_access",
  "information_access",
  "physical_access",
  "control_over_infrastructure",
];

export type RelationshipEdge = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: RelationshipKindV2;
  readonly strength: number;
  readonly valence: number;
  readonly updatedAt: SimTime;
  readonly evidenceRefs: readonly string[];
};

export type PolicyStance = "support" | "oppose" | "neutral";

export type StanceAssessment = {
  readonly actorId: string;
  readonly subjectRef: string;
  readonly stance: PolicyStance;
  readonly score: number;
  readonly relationshipRefs: readonly string[];
  readonly beliefRefs: readonly string[];
};

export function validateMotivationProfile(
  profile: MotivationProfile,
): MotivationProfile {
  for (const key of motivationKeys) {
    const value = profile[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Motivation ${key} must be a number`);
    }
    if (value < 0 || value > 1) {
      throw new Error(`Motivation ${key} must be within [0, 1]; got ${value}`);
    }
  }
  return profile;
}

export function validateRelationshipEdge(
  edge: RelationshipEdge,
): RelationshipEdge {
  if (edge.strength < 0 || edge.strength > 1) {
    throw new Error(`Relationship strength must be within [0, 1]: ${edge.id}`);
  }
  if (edge.valence < -1 || edge.valence > 1) {
    throw new Error(`Relationship valence must be within [-1, 1]: ${edge.id}`);
  }
  return edge;
}

export type BeliefProposition = {
  readonly subjectRef: string;
  readonly predicate: string;
  readonly value: JsonValue;
  readonly confidence: number;
};
