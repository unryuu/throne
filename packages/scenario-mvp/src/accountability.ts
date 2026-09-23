import type {
  DomainEvent,
  MisconductFinding,
  RelationshipEdge,
  ResistanceCandidate,
  SimTime,
} from "@throne/shared-types";

export type AccountabilityActor = {
  readonly id: string;
  readonly influence: number;
  readonly loyaltyToRuler: number;
};

export type RemovalRecord = {
  readonly id: string;
  readonly actorId: string;
  readonly officeId: string;
  readonly basis: "evidence" | "flat";
  readonly findingId?: string;
  readonly at: SimTime;
};

export type AccountabilityState = {
  readonly actors: Readonly<Record<string, AccountabilityActor>>;
  readonly findings: Readonly<Record<string, MisconductFinding>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly removals: readonly RemovalRecord[];
  readonly disputes: readonly string[];
};

export const emptyAccountabilityState: AccountabilityState = {
  actors: {},
  findings: {},
  relationships: {},
  removals: [],
  disputes: [],
};

export function addAccountabilityActor(
  state: AccountabilityState,
  actor: AccountabilityActor,
): AccountabilityState {
  if (state.actors[actor.id]) {
    throw new Error(`Duplicate accountability actor: ${actor.id}`);
  }
  validateUnit(actor.loyaltyToRuler, `${actor.id}.loyaltyToRuler`);
  if (actor.influence < 0) {
    throw new Error(`${actor.id}.influence cannot be negative`);
  }
  return { ...state, actors: { ...state.actors, [actor.id]: actor } };
}

export function recordFinding(
  state: AccountabilityState,
  finding: MisconductFinding,
): AccountabilityState {
  if (state.findings[finding.id]) {
    throw new Error(`Duplicate finding: ${finding.id}`);
  }
  requiredActor(state, finding.actorId);
  if (finding.strength < 0 || finding.strength > 1) {
    throw new Error(`Finding ${finding.id} strength must be within [0, 1]`);
  }
  if (finding.evidenceRefs.length === 0) {
    throw new Error(`Finding ${finding.id} requires at least one evidence ref`);
  }
  return { ...state, findings: { ...state.findings, [finding.id]: finding } };
}

export function disputeFinding(
  state: AccountabilityState,
  findingId: string,
): AccountabilityState {
  if (!state.findings[findingId]) {
    throw new Error(`Unknown finding: ${findingId}`);
  }
  return { ...state, disputes: [...state.disputes, findingId] };
}

export function recordRemoval(
  state: AccountabilityState,
  removal: RemovalRecord,
): AccountabilityState {
  requiredActor(state, removal.actorId);
  if (state.removals.some((entry) => entry.id === removal.id)) {
    throw new Error(`Duplicate removal: ${removal.id}`);
  }
  if (removal.basis === "evidence") {
    if (!removal.findingId) {
      throw new Error(
        `Evidence-based removal ${removal.id} requires a finding`,
      );
    }
    if (!state.findings[removal.findingId]) {
      throw new Error(`Removal ${removal.id} references unknown finding`);
    }
  }
  return { ...state, removals: [...state.removals, removal] };
}

export function deriveEvidenceStrength(
  state: AccountabilityState,
  findingId: string,
): number {
  const finding = state.findings[findingId];
  if (!finding) throw new Error(`Unknown finding: ${findingId}`);
  const disputed = state.disputes.includes(findingId) ? 0.5 : 1;
  return rounded(finding.strength * disputed);
}

export function deriveProtectionScore(
  state: AccountabilityState,
  actorId: string,
): number {
  const backers = Object.values(state.relationships).filter(
    (edge) => edge.targetId === actorId,
  );
  return rounded(
    backers.reduce(
      (sum, edge) => sum + Math.max(0, edge.valence) * edge.strength,
      0,
    ),
  );
}

export function deriveResistanceToRemoval(
  state: AccountabilityState,
  actorId: string,
  basis: "evidence" | "flat",
  findingId?: string,
): ResistanceCandidate {
  const actor = requiredActor(state, actorId);
  const backers = Object.values(state.relationships).filter(
    (edge) => edge.targetId === actorId,
  );
  const relationSupport = rounded(
    backers.reduce(
      (sum, edge) => sum + Math.max(0, edge.valence) * edge.strength,
      0,
    ),
  );
  const evidenceStrength =
    basis === "evidence" && findingId
      ? deriveEvidenceStrength(state, findingId)
      : 0;
  const loyaltyLoad = actor.influence * (0.4 + 0.6 * actor.loyaltyToRuler);
  const mitigation = evidenceStrength * (basis === "evidence" ? 1.2 : 0.5);
  const score = rounded(
    Math.max(0, loyaltyLoad + relationSupport - mitigation),
  );
  return {
    actorId,
    influence: actor.influence,
    loyalty: actor.loyaltyToRuler,
    relationSupport,
    evidenceStrength,
    basis,
    score,
    evidenceIds: backers.map((edge) => edge.id),
  };
}

export function reduceAccountabilityEvent(
  state: AccountabilityState,
  event: DomainEvent,
): AccountabilityState {
  switch (event.eventType) {
    case "finding.recorded": {
      const finding = findingFromEvent(state, event);
      return recordFinding(state, finding);
    }
    case "finding.disputed":
      return disputeFinding(state, String(event.payload.findingId));
    case "removal.recorded": {
      const basis = event.payload.basis;
      if (basis !== "evidence" && basis !== "flat") {
        throw new Error(`Invalid removal basis: ${String(basis)}`);
      }
      return recordRemoval(state, {
        id: String(event.payload.removalId),
        actorId: String(event.payload.actorId),
        officeId: String(event.payload.officeId),
        basis,
        ...(event.payload.findingId === undefined
          ? {}
          : { findingId: String(event.payload.findingId) }),
        at: event.occurredAt,
      });
    }
    default:
      throw new Error(
        `Unhandled accountability event ${event.eventType} (${event.id})`,
      );
  }
}

function findingFromEvent(
  state: AccountabilityState,
  event: DomainEvent,
): MisconductFinding {
  const payload = event.payload;
  const evidenceRefs = payload.evidenceRefs;
  if (!Array.isArray(evidenceRefs)) {
    throw new Error(`Finding ${String(payload.findingId)} needs evidenceRefs`);
  }
  const claimRefs = Array.isArray(payload.claimRefs) ? payload.claimRefs : [];
  return {
    id: String(payload.findingId),
    actorId: String(payload.actorId),
    officeId: String(payload.officeId),
    subject: String(payload.subject),
    claimRefs: claimRefs.map(String),
    evidenceRefs: evidenceRefs.map(String),
    strength: Number(payload.strength),
  };
}

function requiredActor(
  state: AccountabilityState,
  id: string,
): AccountabilityActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown accountability actor: ${id}`);
  return actor;
}

function validateUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be within [0, 1]`);
  }
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
