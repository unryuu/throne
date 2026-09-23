import {
  simTime,
  validateMotivationProfile,
  type DomainEvent,
  type MotivationProfile,
  type RelationshipEdge,
  type SimTime,
  type SimulationRecord,
} from "@throne/shared-types";
import {
  InMemoryEventStore,
  SimulationKernel,
  replay,
  type DomainEventDraft,
  type DomainModel,
  type ScheduledEventDraft,
} from "@throne/sim-core";
import {
  createAccount,
  deriveBalance,
  deriveReportedBalance,
  deriveVerifiedBalance,
  emptyFiscalState,
  reduceFiscalEvent,
  type FiscalState,
} from "./fiscal.ts";
import {
  addAccountabilityActor,
  deriveResistanceToRemoval,
  emptyAccountabilityState,
  reduceAccountabilityEvent,
  type AccountabilityState,
} from "./accountability.ts";

export type CourtActor = {
  readonly id: string;
  readonly name: string;
  readonly office: string;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
};

export type CourtTimelineItem = {
  readonly at: SimTime;
  readonly text: string;
};

export type CourtState = {
  readonly actors: Readonly<Record<string, CourtActor>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly fiscal: FiscalState;
  readonly accountability: AccountabilityState;
  readonly ruleValue: "new_law" | "old_law";
  readonly timeline: readonly CourtTimelineItem[];
};

export type CourtView = {
  readonly simulationTime: SimTime;
  readonly ruleValue: "new_law" | "old_law";
  readonly treasuryTruth: number;
  readonly treasuryReported: number | undefined;
  readonly treasuryVerified: number | undefined;
  readonly factionSupport: {
    readonly reform: number;
    readonly restore: number;
  };
  readonly resistanceEvidence: number;
  readonly resistanceFlat: number;
  readonly timeline: readonly CourtTimelineItem[];
};

export type CourtRun = {
  readonly state: CourtState;
  readonly records: readonly SimulationRecord[];
  readonly finalView: CourtView;
};

export const courtIds = {
  emperor: "actor:emperor",
  wang: "actor:wang",
  sima: "actor:sima",
  chancellor: "actor:chancellor",
  governor: "actor:governor",
  treasury: "account:treasury",
  governorAccount: "account:governor",
  governorship: "office:governorship",
  fundRelationship: "relationship:chancellor-backing-governor",
} as const;

const ids = courtIds;

function motivations(
  start: Partial<MotivationProfile> = {},
): MotivationProfile {
  return validateMotivationProfile({
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
    ...start,
  });
}

const backerRelationship: RelationshipEdge = {
  id: ids.fundRelationship,
  sourceId: ids.chancellor,
  targetId: ids.governor,
  kind: "informal_influence",
  strength: 0.7,
  valence: 0.8,
  updatedAt: simTime(0),
  evidenceRefs: [],
};

export function createCourtInitialState(): CourtState {
  const actors: Record<string, CourtActor> = {
    [ids.emperor]: {
      id: ids.emperor,
      name: "The Emperor",
      office: "office:sovereign",
      influence: 0.4,
      ideology: 0,
      motivations: motivations({
        loyaltyToState: 0.9,
        proceduralLegality: 0.8,
      }),
    },
    [ids.wang]: {
      id: ids.wang,
      name: "Wang",
      office: "office:chancellery",
      influence: 1,
      ideology: 0.9,
      motivations: motivations({ ideologicalCommitment: 0.95, ambition: 0.8 }),
    },
    [ids.sima]: {
      id: ids.sima,
      name: "Sima",
      office: "office:censorate",
      influence: 1,
      ideology: -0.85,
      motivations: motivations({
        ideologicalCommitment: 0.9,
        proceduralLegality: 0.85,
      }),
    },
    [ids.chancellor]: {
      id: ids.chancellor,
      name: "Chancellor",
      office: "office:grand-chancellor",
      influence: 0.9,
      ideology: -0.4,
      motivations: motivations({ officeRetention: 0.9, wealth: 0.7 }),
    },
    [ids.governor]: {
      id: ids.governor,
      name: "Governor",
      office: ids.governorship,
      influence: 1,
      ideology: -0.3,
      motivations: motivations({ wealth: 0.9, selfPreservation: 0.8 }),
    },
  };

  let fiscal = createAccount(emptyFiscalState, {
    id: ids.treasury,
    ownerId: "organization:court",
    kind: "money",
    balance: 0,
  });
  fiscal = createAccount(fiscal, {
    id: ids.governorAccount,
    ownerId: ids.governor,
    kind: "money",
    balance: 0,
  });

  return {
    actors,
    relationships: { [backerRelationship.id]: backerRelationship },
    fiscal,
    accountability: {
      ...emptyAccountabilityState,
      actors: {
        [ids.governor]: { id: ids.governor, influence: 1, loyaltyToRuler: 0.4 },
        [ids.chancellor]: {
          id: ids.chancellor,
          influence: 0.9,
          loyaltyToRuler: 0.5,
        },
      },
      relationships: { [backerRelationship.id]: backerRelationship },
    },
    ruleValue: "old_law",
    timeline: [],
  };
}

export function createCourtModel(): DomainModel<CourtState> {
  return {
    resolveBatch({ events, time }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];
      for (const event of events) {
        switch (event.eventType) {
          case "court.levy": {
            committed.push({
              eventType: "resource.flowed",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: {
                flowId: `flow:levy:${time}`,
                kind: "levy",
                toAccountId: String(event.payload.accountId),
                amount: Number(event.payload.amount),
                reason: "provincial levy",
              },
            });
            break;
          }
          case "court.graft": {
            committed.push({
              eventType: "resource.flowed",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                flowId: `flow:graft:${time}`,
                kind: "graft",
                fromAccountId: String(event.payload.fromAccountId),
                toAccountId: String(event.payload.toAccountId),
                amount: Number(event.payload.amount),
                reason: "silent diversion",
              },
            });
            break;
          }
          case "court.return": {
            committed.push({
              eventType: "fiscal.returned",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                returnId: String(event.payload.returnId),
                authorId: ids.governor,
                subjectRef: String(event.payload.subjectRef),
                claimedBalance: Number(event.payload.claimedBalance),
                basis: "administrative_return",
              },
            });
            break;
          }
          case "court.audit": {
            committed.push({
              eventType: "audit.recorded",
              actorId: ids.sima,
              causalEventId: event.id,
              payload: {
                returnId: String(event.payload.returnId),
                verifiedBalance: Number(event.payload.verifiedBalance),
              },
            });
            break;
          }
          case "court.finding": {
            committed.push({
              eventType: "finding.recorded",
              actorId: ids.sima,
              causalEventId: event.id,
              payload: {
                findingId: String(event.payload.findingId),
                actorId: ids.governor,
                officeId: ids.governorship,
                subject: String(event.payload.subject),
                claimRefs: [String(event.payload.returnId)],
                evidenceRefs: [
                  String(event.payload.returnId),
                  String(event.payload.auditRef),
                ],
                strength: Number(event.payload.strength),
              },
            });
            break;
          }
          case "court.remove": {
            committed.push({
              eventType: "removal.recorded",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: {
                removalId: String(event.payload.removalId),
                actorId: String(event.payload.actorId),
                officeId: ids.governorship,
                basis: String(event.payload.basis),
                ...(event.payload.findingId === undefined
                  ? {}
                  : { findingId: String(event.payload.findingId) }),
              },
            });
            break;
          }
          case "court.endorse": {
            committed.push({
              eventType: "rule.endorsed",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: { direction: String(event.payload.direction) },
            });
            break;
          }
          default:
            throw new Error(`Unknown court event: ${event.eventType}`);
        }
      }
      return { events: committed, scheduled };
    },
    reduce: reduceCourtState,
    validate(_before, after) {
      if (after.ruleValue !== "new_law" && after.ruleValue !== "old_law") {
        throw new Error(`Invalid court rule value: ${String(after.ruleValue)}`);
      }
    },
  };
}

export function reduceCourtState(
  state: CourtState,
  event: DomainEvent,
): CourtState {
  if (isFiscalEvent(event.eventType)) {
    return {
      ...state,
      fiscal: reduceFiscalEvent(state.fiscal, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: describe(event) },
      ],
    };
  }
  if (isAccountabilityEvent(event.eventType)) {
    return {
      ...state,
      accountability: reduceAccountabilityEvent(state.accountability, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: describe(event) },
      ],
    };
  }
  if (event.eventType === "rule.endorsed") {
    const direction = event.payload.direction;
    if (direction !== "reform" && direction !== "restore") {
      throw new Error(`Invalid endorsement direction: ${String(direction)}`);
    }
    return {
      ...state,
      ruleValue: direction === "reform" ? "new_law" : "old_law",
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: describe(event) },
      ],
    };
  }
  throw new Error(`Unhandled court event ${event.eventType} (${event.id})`);
}

export function deriveCourtStance(
  state: CourtState,
  actorId: string,
  direction: "reform" | "restore",
): number {
  const actor = requiredActor(state, actorId);
  const sign = direction === "reform" ? 1 : -1;
  const weight = 0.5 + 0.5 * actor.motivations.ideologicalCommitment;
  return rounded(clamp(actor.ideology * sign * weight, -1, 1));
}

export function deriveCourtFactionSupport(state: CourtState): {
  readonly reform: number;
  readonly restore: number;
} {
  let reform = 0;
  let restore = 0;
  for (const actor of Object.values(state.actors)) {
    const weight =
      Math.abs(actor.ideology) *
      actor.influence *
      (0.5 + 0.5 * actor.motivations.ideologicalCommitment);
    if (actor.ideology > 0) reform += weight;
    else if (actor.ideology < 0) restore += weight;
  }
  return { reform: rounded(reform), restore: rounded(restore) };
}

export function courtView(state: CourtState, time: SimTime): CourtView {
  const resistanceEvidence = deriveResistanceToRemoval(
    state.accountability,
    ids.governor,
    "evidence",
    "finding:governor-diversion",
  );
  const resistanceFlat = deriveResistanceToRemoval(
    state.accountability,
    ids.governor,
    "flat",
  );
  return {
    simulationTime: time,
    ruleValue: state.ruleValue,
    treasuryTruth: deriveBalance(state.fiscal, ids.treasury),
    treasuryReported: deriveReportedBalance(state.fiscal, ids.treasury),
    treasuryVerified: deriveVerifiedBalance(state.fiscal, ids.treasury),
    factionSupport: deriveCourtFactionSupport(state),
    resistanceEvidence: resistanceEvidence.score,
    resistanceFlat: resistanceFlat.score,
    timeline: state.timeline,
  };
}

export async function runCourtScenario(
  runId = "court-faction-fiscal-demo",
): Promise<CourtRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createCourtInitialState(),
    createCourtModel(),
    store,
    runId,
  );

  const schedule: readonly ScheduledEventDraft[] = [
    {
      eventType: "court.levy",
      scheduledAt: simTime(0),
      actorId: ids.emperor,
      payload: { accountId: ids.treasury, amount: 100 },
    },
    {
      eventType: "court.graft",
      scheduledAt: simTime(10),
      actorId: ids.governor,
      payload: {
        fromAccountId: ids.treasury,
        toAccountId: ids.governorAccount,
        amount: 40,
      },
    },
    {
      eventType: "court.return",
      scheduledAt: simTime(20),
      actorId: ids.governor,
      payload: {
        returnId: "return:governor",
        subjectRef: ids.treasury,
        claimedBalance: 100,
      },
    },
    {
      eventType: "court.audit",
      scheduledAt: simTime(30),
      actorId: ids.sima,
      payload: { returnId: "return:governor", verifiedBalance: 60 },
    },
    {
      eventType: "court.finding",
      scheduledAt: simTime(40),
      actorId: ids.sima,
      payload: {
        findingId: "finding:governor-diversion",
        subject: "diverted levy through a private account",
        returnId: "return:governor",
        auditRef: "audit:governor",
        strength: 0.9,
      },
    },
    {
      eventType: "court.remove",
      scheduledAt: simTime(50),
      actorId: ids.emperor,
      payload: {
        removalId: "removal:governor",
        actorId: ids.governor,
        basis: "evidence",
        findingId: "finding:governor-diversion",
      },
    },
    {
      eventType: "court.endorse",
      scheduledAt: simTime(60),
      actorId: ids.emperor,
      payload: { direction: "restore" },
    },
  ];
  for (const draft of schedule) await kernel.schedule(draft);
  await kernel.runUntilIdle();

  const records = await store.readAll();
  const replayed = replay(createCourtInitialState(), records, reduceCourtState);
  if (JSON.stringify(replayed) !== JSON.stringify(kernel.state)) {
    throw new Error("Replay differs from live court state");
  }

  return {
    state: kernel.state,
    records,
    finalView: courtView(kernel.state, kernel.time),
  };
}

function isFiscalEvent(eventType: string): boolean {
  return (
    eventType === "resource.flowed" ||
    eventType === "fiscal.returned" ||
    eventType === "audit.recorded"
  );
}

function isAccountabilityEvent(eventType: string): boolean {
  return (
    eventType === "finding.recorded" ||
    eventType === "finding.disputed" ||
    eventType === "removal.recorded"
  );
}

function describe(event: DomainEvent): string {
  return `${event.eventType} ${JSON.stringify(event.payload)}`;
}

function requiredActor(state: CourtState, id: string): CourtActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown court actor: ${id}`);
  return actor;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
