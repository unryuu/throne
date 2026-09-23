# ADR 0007: Actor and relationship contract v2

Status: proposed

The v2 contracts exist additively in the fork (`packages/shared-types/src/actor-contract.ts`) without replacing `PersistentActor`; the decision remains proposed pending upstream review.

## Context

`PersistentActor` carries `motivations: JsonObject` (`packages/shared-types/src/agents.ts:103-110`), an untyped map that invites drift. The relationship contract defines seven kinds (`ControlRelationshipKind`, `organizations.ts:16-23`) with a `strength` in `[0, 1]`, so it cannot express opposition, enmity, or factional rivalry. There is no kinship relationship, no typed motivation profile, and no derived policy stance. This blocks modelling party conflict, patronage networks, and the ruler's dilemma between loyalty, competence, and policy alignment.

SPEC section 5.4 lists structured motivational dimensions and forbids moral labels. Section 7 lists eleven relationship kinds and requires practical power to be derived. Section 10 requires identity continuity across cognition changes. Section 11 forbids fixed archetypes.

## Decision

1. **Motivations become a typed profile.** Map the SPEC section 5.4 dimensions into `MotivationProfile`. They are motivations, not moral labels.
2. **Relationships extend to the eleven SPEC section 7 kinds and gain direction and valence.** Add `communication_access`, `information_access`, `physical_access`, and `control_over_infrastructure`, and a signed or separate opposition axis.
3. **Capabilities are derived** from office grants and access, never stored on the actor.
4. **Three axes are separate and derived: loyalty, competence, and policy stance.** They may conflict, which is what produces a genuine dilemma. None is stored as a scalar.
5. **Cognition tiers remain, with identity continuity.** Tier 0 aggregate groups, Tier 1 lightweight persistent actors, and Tier 2 LLM actors keep the identity and history defined in ADR 0003 and SPEC section 10.

## Data contracts

```ts
type MotivationProfile = {
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

type RelationshipEdge = {
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: RelationshipKind;
  readonly strength: number;
  readonly valence: number; // negative for opposition
  readonly history: readonly RelationshipStrengthEntry[];
};
```

## Events

- `relationship.formed`, `relationship.severed`
- `relationship.strength_changed` (existing)
- `belief.asserted` (a source of policy stance)

## Derivation

- `deriveStance(state, actorId, policyRef)` from beliefs, interests, and relationships.
- `deriveFactionAffinity(state, actorId)`; the value is derived, never a stored field.
- `deriveCapabilities(state, actorId)` from office grants and access.

## Invariants

- `strength` and `valence` are range-checked.
- Relationships change only through explicit events; decay, if wanted, is an explicit event rather than an implicit per-tick adjustment.
- No archetype labels; stance and affinity are derived.

## Consequences

Positive:

- Party conflict, kinship, patronage, and the loyalty/competence/stance dilemma become expressible without labels.
- Removes the untyped `motivations` map.

Negative and risks:

- Touches almost every scenario that authors actors.
- The negative axis needs consistent handling in obedience and control derivation.

## Out of scope

- Physiological or emotional simulation (DESIGN section 5 is a later goal).

## Verification

- Stance is derived from beliefs and interests, not from a label.
- Opposition relationships affect obedience expectations without hard-blocking attempts.
- Replay reproduces relationship and stance state without model calls.
