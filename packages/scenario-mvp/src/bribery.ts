import type {
  BribeRecord,
  CorruptionRecord,
  DomainEvent,
  MotivationProfile,
  ObligationRecord,
} from "@throne/shared-types";

export type BriberyActor = {
  readonly id: string;
  readonly motivations: MotivationProfile;
};

export type BriberyState = {
  readonly actors: Readonly<Record<string, BriberyActor>>;
  readonly bribes: Readonly<Record<string, BribeRecord>>;
  readonly corruption: readonly CorruptionRecord[];
  readonly obligations: readonly ObligationRecord[];
};

export const emptyBriberyState: BriberyState = {
  actors: {},
  bribes: {},
  corruption: [],
  obligations: [],
};

export type BriberyChain = {
  readonly chainId: string;
  readonly depth: number;
  readonly hops: number;
  readonly acceptedHops: number;
  readonly totalValue: number;
  readonly records: readonly BribeRecord[];
};

export function addBriberyActor(
  state: BriberyState,
  actor: BriberyActor,
): BriberyState {
  if (state.actors[actor.id]) {
    throw new Error(`Duplicate bribery actor: ${actor.id}`);
  }
  return { ...state, actors: { ...state.actors, [actor.id]: actor } };
}

export function reduceBriberyEvent(
  state: BriberyState,
  event: DomainEvent,
): BriberyState {
  switch (event.eventType) {
    case "bribe.offered": {
      const bribe = bribeFromEvent(state, event, "offered");
      if (state.bribes[bribe.id]) {
        throw new Error(`Duplicate bribe: ${bribe.id}`);
      }
      if (bribe.parentBribeId !== undefined) {
        const parent = requiredBribe(state, bribe.parentBribeId);
        if (parent.chainId !== bribe.chainId) {
          throw new Error(
            `Bribe ${bribe.id} parent chain mismatch: ${parent.chainId}`,
          );
        }
      }
      return { ...state, bribes: { ...state.bribes, [bribe.id]: bribe } };
    }
    case "bribe.accepted":
    case "bribe.rejected": {
      const bribeId = String(event.payload.bribeId);
      const bribe = requiredBribe(state, bribeId);
      if (bribe.status !== "offered") {
        throw new Error(`Bribe ${bribeId} already resolved`);
      }
      return {
        ...state,
        bribes: {
          ...state.bribes,
          [bribeId]: {
            ...bribe,
            status:
              event.eventType === "bribe.accepted" ? "accepted" : "rejected",
            reason: String(event.payload.reason),
          },
        },
      };
    }
    case "corruption.recorded": {
      const record: CorruptionRecord = {
        id: String(event.payload.corruptionId),
        actorId: String(event.payload.actorId),
        bribeId: String(event.payload.bribeId),
        amount: Number(event.payload.amount),
        evidenceRefs: readStringArray(event.payload.evidenceRefs),
        at: event.occurredAt,
      };
      requiredBribe(state, record.bribeId);
      return { ...state, corruption: [...state.corruption, record] };
    }
    case "obligation.incurred": {
      const obligation: ObligationRecord = {
        id: String(event.payload.obligationId),
        debtorId: String(event.payload.debtorId),
        creditorId: String(event.payload.creditorId),
        kind: obligationKind(event.payload.kind),
        value: Number(event.payload.value),
        at: event.occurredAt,
        eventId: event.id,
      };
      if (!state.actors[obligation.debtorId]) {
        throw new Error(`Unknown obligation debtor: ${obligation.debtorId}`);
      }
      if (!state.actors[obligation.creditorId]) {
        throw new Error(
          `Unknown obligation creditor: ${obligation.creditorId}`,
        );
      }
      return {
        ...state,
        obligations: [...state.obligations, obligation],
      };
    }
    default:
      throw new Error(
        `Unhandled bribery event ${event.eventType} (${event.id})`,
      );
  }
}

export function deriveBriberyChain(
  state: BriberyState,
  chainId: string,
): BriberyChain {
  const records = Object.values(state.bribes).filter(
    (bribe) => bribe.chainId === chainId,
  );
  if (records.length === 0) {
    throw new Error(`Unknown bribery chain: ${chainId}`);
  }
  const accepted = records.filter((bribe) => bribe.status === "accepted");
  const depth = records.reduce(
    (max, bribe) => Math.max(max, chainDepth(state, bribe)),
    0,
  );
  return {
    chainId,
    depth,
    hops: records.length,
    acceptedHops: accepted.length,
    totalValue: rounded(accepted.reduce((sum, bribe) => sum + bribe.amount, 0)),
    records,
  };
}

export function deriveObligations(
  state: BriberyState,
  debtorId: string,
): readonly ObligationRecord[] {
  return state.obligations.filter(
    (obligation) => obligation.debtorId === debtorId,
  );
}

export function deriveCorruptionEvidence(
  state: BriberyState,
  actorId: string,
): readonly string[] {
  return state.corruption
    .filter((record) => record.actorId === actorId)
    .map((record) => record.id);
}

export function derivePatronageShare(
  state: BriberyState,
  patronId: string,
): number {
  return rounded(
    state.obligations
      .filter(
        (obligation) =>
          obligation.creditorId === patronId && obligation.kind === "money",
      )
      .reduce((sum, obligation) => sum + obligation.value, 0),
  );
}

function chainDepth(state: BriberyState, bribe: BribeRecord): number {
  let depth = 0;
  let current: BribeRecord | undefined = bribe;
  const seen = new Set<string>();
  while (current?.parentBribeId !== undefined) {
    if (seen.has(current.id)) {
      throw new Error(`Cyclic bribe chain at ${current.id}`);
    }
    seen.add(current.id);
    current = state.bribes[current.parentBribeId];
    if (!current) {
      throw new Error(`Missing parent bribe for ${bribe.id}`);
    }
    depth += 1;
  }
  return depth;
}

function bribeFromEvent(
  state: BriberyState,
  event: DomainEvent,
  status: BribeRecord["status"],
): BribeRecord {
  const payload = event.payload;
  const fromId = String(payload.fromId);
  const toId = String(payload.toId);
  if (!state.actors[fromId]) throw new Error(`Unknown briber: ${fromId}`);
  if (!state.actors[toId]) throw new Error(`Unknown bribe recipient: ${toId}`);
  return {
    id: String(payload.bribeId),
    chainId: String(payload.chainId),
    ...(payload.parentBribeId === undefined
      ? {}
      : { parentBribeId: String(payload.parentBribeId) }),
    ...(payload.instruction === undefined
      ? {}
      : { instruction: String(payload.instruction) }),
    fromId,
    toId,
    amount: Number(payload.amount),
    targetRef: String(payload.targetRef),
    status,
    at: event.occurredAt,
    reason: "",
  };
}

function requiredBribe(state: BriberyState, id: string): BribeRecord {
  const bribe = state.bribes[id];
  if (!bribe) throw new Error(`Unknown bribe: ${id}`);
  return bribe;
}

function obligationKind(value: unknown): ObligationRecord["kind"] {
  if (
    value === "office" ||
    value === "money" ||
    value === "pardon" ||
    value === "protection"
  ) {
    return value;
  }
  throw new Error(`Invalid obligation kind: ${String(value)}`);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("corruption evidenceRefs must be an array");
  }
  return value.map(String);
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
