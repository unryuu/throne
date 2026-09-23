# ADR 0009: Patronage and corruption networks

Status: proposed

Depends on: ADR 0002 (resource and fiscal layer), ADR 0003 (appointment layer), ADR 0006 (accountability and removal), ADR 0008 (factional reform and balance).

## Context

The bribery layer models a single offer between two actors: a recipient decides to accept or reject, and acceptance moves a resource and records corruption evidence. Lobbying changes stance through private messages, and factions are derived from ideology and valenced relationships. Three political behaviours are therefore still out of reach:

- **Multi-level bribery.** There is no intermediary topology, no pass-through, and no way for one payment to induce a further payment or coercion downstream.
- **Benefit conveyance.** Fiscal flows (`transfer`, `graft`, `payroll`, `requisition`, `loss`) and office appointments exist, but they are not connected. Installing an ally in office does not produce income, and nothing carries a return favour back to the patron.
- **Faction self-dealing.** Factions are a derived aggregate of stance. There is no obligation that survives a favour, no coordinated action by members, and no protection of members when a finding is raised.

SPEC section 7 requires practical power to remain relational rather than a stored scalar; section 11 forbids a single dishonesty stat and fixed archetypes; section 18 requires flows to have identifiable source and destination. DESIGN section 4 requires that favours be remembered by the people who benefited or were harmed.

## Decision

1. **Bribery becomes a directed graph.** A `BribeRecord` gains `parentBribeId`, `chainId`, and an `instruction`. After accepting, the recipient may, as a decision, pass part of the value onward to a third party to pressure or reward them. Each hop commits its own event and its own corruption evidence.
2. **Favours, offices, income, and kickbacks are one wiring.** Installing an ally in office, paying that office, and returning a share to the patron are ordinary flows with source and destination. `derivePatronageShare` reports what a patron actually receives; it is derived, never stored.
3. **Obligations are first-class and persist.** Receiving a favour (an office, a pardon, money, or protection) records an `ObligationRecord` that later decisions weigh. It is a memory with a value, not a scalar loyalty.
4. **Faction action is coordinated and protective.** Members may act in the same decision batch, and a finding against a member may be disputed or suppressed by others according to their obligations and relationships. Protection is derived, not a hard block.
5. **No corruption scalar.** Every hop is a decision, an event, and evidence. Aggregate measures such as `deriveBriberyChain`, `deriveFactionCohesion`, and `deriveProtectionScore` are derived for debugging and administration only.

## Data contracts

Extend the bribery contract in `packages/shared-types`:

```ts
type BribeRecord = {
  // existing fields...
  readonly parentBribeId?: string;
  readonly chainId: string;
  readonly instruction?: string;
};

type ObligationRecord = {
  readonly id: string;
  readonly debtorId: string;
  readonly creditorId: string;
  readonly kind: "office" | "money" | "pardon" | "protection";
  readonly value: number;
  readonly occurredAt: SimTime;
  readonly eventId: string;
};
```

## Events

- `bribe.offered` (extended with `parentBribeId`, `chainId`, `instruction`)
- `bribe.passed_on`
- `obligation.incurred`
- `kickback.transferred` (a resource flow with a patronage reason)
- `finding.disputed` (existing; reused for faction protection)

## Derivation

- `deriveBriberyChain(state, chainId)` — depth, total value, value retained per hop.
- `derivePatronageShare(state, patronId)` — value actually returned to a patron.
- `deriveObligations(state, debtorId)` — outstanding obligations weighted by their kind.
- `deriveProtectionScore(state, actorId)` — the ability of a network to shield a member from a finding.
- `deriveFactionCohesion(state, factionRef)` — degree of coordinated stance and reciprocal obligation.

## Invariants

- Every hop commits its own `corruption` evidence; nothing is laundered out of the log.
- Every flow has a source and a destination (SPEC section 18).
- Protection and coercion never hard-block a finding or a removal; they change derived resistance and dispute records.
- Replay reproduces the network state without model calls.

## Consequences

Positive:

- Multi-level bribery, benefit conveyance, and faction self-dealing become expressible as ordinary decisions and events.
- Ties the fiscal, appointment, accountability, and bribery layers into a single patronage network.

Negative and risks:

- Adds a graph dimension to bribery and an obligation record type.
- Requires care so that derived aggregates are never read as objective truth by the player.
- Expands MVP scope and touches SPEC sections 7, 11, 18, and 26.

## Out of scope

- A full organised-crime or illicit-market simulation.
- A realistic economy or logistics network.

## Verification

- A chain of two or more bribes records each hop and exposes total value and retention.
- Installing an ally produces office income and a derived patron share; the ally accrues an obligation.
- A finding against a protected member is disputed rather than silently suppressed, and derived resistance rises.
- Replay reproduces the network state without model calls.
