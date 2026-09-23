# ADR 0008: Factional reform and balance

Status: proposed

A minimal slice exists in the fork (`packages/scenario-mvp/src/faction-reform.ts` and `packages/scenario-mvp/src/court.ts`); the decision remains proposed pending upstream review.

Depends on: ADR 0002 (resource and fiscal layer), ADR 0006 (accountability and removal), ADR 0007 (actor and relationship contract v2).

## Context

There is no policy or petition object, no way to change institutional rules, and no faction or opposition model. As a result the project cannot represent the political scene that motivates this work: a ruler balancing competing policy lines through the machinery of government, as in the Wang Anshi reforms and the later reversal. Reforms today would have to be scripted events, which SPEC section 2 forbids.

SPEC section 2 rejects the assumption that institutions are stable background rules; section 7 requires derived metrics and forbids a single power value; section 11 forbids fixed archetypes; section 26 excludes a realistic economy. DESIGN section 7 requires that the same event admit multiple interpretations and that the system not rule a single moral verdict.

## Decision

1. **Policy and petition are first-class.** A `Policy` proposes a rule change with stated beneficiaries and costs.
2. **Reform is a capability that emits rule changes and resource flows**, never a scripted effect. A reversal is the opposite events: old and new rules coexist in history and are never erased.
3. **A faction is an `Organization` of kind `faction`** with members and directed opposition relationships. Labels such as reformer or conservative are forbidden; alignment is derived.
4. **Stance is derived** from beliefs, interests, and relationships (ADR 0007). One policy admits Several interpretations.
5. **The ruler balances through the machinery of government**: appointment, documented removal, decrees, deferral, and rule change. Support, legitimacy, and resistance are all derived; there is no global balance scalar.
6. **Institutions are contestable and violable rules**, changeable by events, not engine assumptions.

## Data contracts

```ts
type Policy = {
  id: string;
  authorId: string;
  subject: string;
  ruleChange: RuleChange;
  beneficiaries: readonly string[];
  costs: readonly string[];
};

type RuleChange = {
  targetRef: string;
  previous: JsonValue;
  next: JsonValue;
};
```

## Events

- `petition.submitted`
- `policy.endorsed`, `policy.deferred`
- `rule.changed`, `rule.reverted`
- `faction.aligned` (optional, if an alignment event is needed for provenance)

## Derivation

- `deriveStance(state, actorId, policyId)`
- `deriveFactionBalance(state)`
- `deriveReformSupport(state, policyId)`

## Invariants

- Rule changes are event-sourced; replay reconstructs the same balance.
- A reversal does not delete the earlier rule or its consequences.
- No faction label is stored on an actor.

## Consequences

Positive:

- Reform, counter-reform, and the ruler's balancing act emerge from structure rather than scripts.
- Reuses the appointment, accountability, fiscal, and relationship layers.

Negative and risks:

- Large scope; it depends on three earlier ADRs and touches SPEC section 26 through the fiscal layer.
- Rule-change semantics must be versioned carefully so replay remains faithful.

## Out of scope

- A realistic economy or demography; a single moral verdict on any reform.

## Verification

- Two factions' derived support shifts with decrees, appointments, and rule changes.
- Over-pressing one faction raises resistance and lowers legitimacy, and can lead to loss of practical control.
- Old and new rules coexist and replay identically without model calls.

## Scenario sketch

A short "Xining / Yuanyou" scenario in which the ruler balances two policy lines, using appointment, documented removal, and decree, with the fiscal layer providing the material costs of reform.
