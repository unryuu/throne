# ADR 0002: Resource and fiscal layer

Status: proposed

This number was reserved by ADR 0003. A minimal slice exists in the fork (`packages/scenario-mvp/src/fiscal.ts`); the decision remains proposed pending upstream review.

## Context

Resources today are scenario-local: `partial-implementation` models grain as accounts (`ResourceAccount`, `partial-implementation.ts:20`), `loss-of-control` models money as accounts with an owner (`ControlResourceAccount`, `loss-of-control.ts:74`), and `false-report` stores grain directly on a `Region` (`false-report.ts:26`). Only one flow event exists, `resource.transferred`. There is no levy, harvest, payroll, spoilage, or graft, no periodic settlement, and no separation between the objective balance and the fiscal return a ruler sees. This blocks modelling reform costs, carrying capacity, and fiscal distortion.

SPEC section 21 lists money, grain or generic provisions, administrative capacity, manpower, and communication capacity as suggested resources. Section 8 gives organizations resource accounts. Section 14.1 names transfer primitives. Section 18 requires identifiable source and destination and forbids negative physical stock unless debt is explicit. Section 26 excludes realistic logistics, Victoria-style POP economics, and global trade.

## Decision

1. Resource kinds are the five of SPEC section 21. The MVP implements `money` and `grain`; the remaining kinds are reserved names.
2. **Accounts are the atomic unit.** A balance lives on an account; any aggregate (a treasury total, a national figure) is derived, never stored.
3. **Only flow events mutate balances.** The initial set is `levy`, `harvest`, `requisition`, `payroll`, `transfer`, `loss`, and `graft`. There are no price, market, or production functions.
4. **Periodic settlement is scheduled**, at monthly or seasonal resolution, never per tick (SPEC section 9.1).
5. **The report layer is separate from truth.** An objective balance, a reported fiscal return, and an audited value are three distinct records. A ruler reads returns, not balances.

## Data contracts

Owned by `packages/shared-types`:

```ts
type ResourceKind =
  | "money"
  | "grain"
  | "manpower"
  | "administrative_capacity"
  | "communication";

type ResourceAccount = {
  id: string;
  ownerId: string;
  kind: ResourceKind;
  balance: number;
  locationId?: string;
};

type ResourceFlow = {
  id: string;
  kind:
    | "levy"
    | "harvest"
    | "requisition"
    | "payroll"
    | "transfer"
    | "loss"
    | "graft";
  fromAccountId?: string;
  toAccountId?: string;
  amount: number;
  occurredAt: SimTime;
  reason: string;
};

type FiscalReturn = {
  id: string;
  authorId: string;
  subjectRef: string;
  claimedBalance: number;
  basis: "administrative_return" | "independent_audit";
};
```

## Events

Names follow `namespace.action`:

- `resource.levied`, `resource.harvested`, `resource.requisitioned`
- `resource.payrolled`, `resource.transferred`, `resource.lost`, `resource.grafted`
- `fiscal.returned`, `audit.recorded`
- `settlement.due` (scheduled periodic trigger)

## Derivation

- `deriveBalance(state, accountId)` returns objective truth.
- `deriveReportedRevenue(state, subjectRef)` folds the returns a ruler has received, with provenance; this is the only fiscal figure a player sees.
- `deriveExtractableCapacity(state, organizationId)` is derived from stock, control relationships, accessibility, and obedience, in the style of `assessPracticalControl`. It is a function, never a stored scalar (SPEC section 7).

## Invariants

- Physical goods (grain) are conserved unless an explicit `loss` or `graft` flow removes them.
- Balances are non-negative; debt is modelled only if a debt record is introduced explicitly.
- Every flow has identifiable source and destination (SPEC section 18).

## Consequences

Positive:

- Reform cost, famine relief, payroll, and fiscal distortion become expressible.
- Fiscal data a ruler sees can differ from objective balances by construction.

Negative and risks:

- Expands MVP scope and touches SPEC section 26; the layer must stay abstract (accounts and flows) and must not grow into an economic simulator.
- Adds periodic scheduling, which the kernel currently does not use.

## Out of scope

- Prices, markets, production functions, population, demography, logistics networks, global trade.

## Verification

- Conservation and non-negativity invariants across settlement batches.
- A reported return can differ from the objective balance without changing it.
- Monthly settlement is deterministic and replay reproduces the same balances without model calls.
