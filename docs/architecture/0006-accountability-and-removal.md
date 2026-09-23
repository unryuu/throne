# ADR 0006: Accountability and evidence-based removal

Status: proposed

A minimal slice exists in the fork (`packages/scenario-mvp/src/accountability.ts`); the decision remains proposed pending upstream review.

Depends on: ADR 0002 (fiscal return and audit), ADR 0003 (appointment layer).

## Context

The appointment layer records whether a removal is authorized by appointment authority, and nothing else. `resolveOfficeBatch` (`packages/scenario-mvp/src/appointments.ts:108-151`) marks a removal `office.removed` when the actor holds appointment authority and `office.removal_contested` otherwise. There is no evidence, no stated reason, and no consequence function. As a result, "replace a minister for a documented failure" and "replace a minister arbitrarily" have identical mechanical weight, and the project cannot express the ruler behaviour the design calls for: exposing a minister's error from several sources and removing them on a legitimate ground, thereby lowering the resistance that an arbitrary replacement provokes.

SPEC section 6 states that legal authority is not a hard permission; it influences expected obedience, reputational consequences, and third-party cooperation. Section 7 requires practical judgements to be derived rather than stored. Section 11 forbids fixed archetypes.

## Decision

1. **Misconduct findings are first-class.** A `MisconductFinding` is composed from an objective action that differs from an actor's claim plus independent observations, reusing the claim/actual/verified pattern of `partial-implementation` and the contradiction handling of `false-report`.
2. **Removal may carry a reason.** `office.remove` gains an optional `findingId`. It is recorded, not adjudicated: it does not change the authorization check.
3. **Resistance is derived.** `deriveResistanceToRemoval` is a function of evidence strength, procedural validity, third-party trust, the removed actor's network, and the method of removal. It is not stored.
4. **Legitimacy perception is derived and propagates only through knowledge.** Only actors who learned of the process update their attitude (DESIGN section 4).
5. **A weak accusation of a loyal actor backfires.** Weak evidence combined with high loyalty raises resistance and lowers trust instead of lowering it.

## Data contracts

```ts
type MisconductFinding = {
  id: string;
  actorId: string;
  officeId: string;
  subject: string;
  claimRefs: readonly string[];
  evidenceRefs: readonly string[];
  strength: number;
};
```

## Events

- `finding.recorded`
- `finding.disputed`
- `office.remove` (extended with optional `findingId`)

## Derivation

- `deriveEvidenceStrength(state, findingId)`.
- `deriveResistanceToRemoval(state, appointmentId)`.
- `deriveRemovalLegitimacy(state, appointmentId)`.

Each returns candidates with evidence references, in the style of `assessPracticalControl`.

## Invariants

- Every `evidenceRefs` entry resolves to a committed record.
- Removal appends history and never deletes it.
- No hard block: an unsupported removal may still be attempted; it simply carries a higher derived cost.

## Consequences

Positive:

- The distinction between a justified and an arbitrary replacement becomes mechanical rather than narrated.
- Ties the information layer to the appointment layer, which previously did not meet.

Negative and risks:

- Adds finding and legitimacy contracts.
- Requires careful propagation rules so that only informed actors update.

## Out of scope

- An automatic guilt adjudicator. The system does not decide a single moral truth; findings are evidence records and may be disputed (DESIGN section 7).

## Verification

- A documented removal yields lower derived resistance than an arbitrary removal of the same actor.
- A weak finding against a loyal actor raises resistance.
- Replay reproduces removal outcomes without model calls.
