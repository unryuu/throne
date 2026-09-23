import {
  addSimTime,
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
  deriveResistanceToRemoval,
  emptyAccountabilityState,
  reduceAccountabilityEvent,
  type AccountabilityState,
} from "./accountability.ts";
import {
  addBriberyActor,
  emptyBriberyState,
  reduceBriberyEvent,
  type BriberyState,
} from "./bribery.ts";
import {
  HeuristicBribePolicy,
  type BribeDecisionPolicy,
} from "@throne/agent-runtime/bribe";

export type GrandActor = {
  readonly id: string;
  readonly name: string;
  readonly office: string;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
};

export type GrandMessage = {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly policyId: string;
  readonly status: "in_transit" | "delivered";
};

export type GrandObservation = {
  readonly id: string;
  readonly actorId: string;
  readonly at: SimTime;
  readonly sourceId: string;
  readonly text: string;
};

export type GrandTimelineItem = {
  readonly at: SimTime;
  readonly text: string;
};

export type GrandState = {
  readonly actors: Readonly<Record<string, GrandActor>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly fiscal: FiscalState;
  readonly accountability: AccountabilityState;
  readonly policy: {
    readonly id: string;
    readonly title: string;
    readonly direction: "reform";
  };
  readonly messages: Readonly<Record<string, GrandMessage>>;
  readonly observations: readonly GrandObservation[];
  readonly petitions: readonly string[];
  readonly vote?: { readonly support: number; readonly oppose: number };
  readonly ruleValue: "new_law" | "old_law";
  readonly bribery: BriberyState;
  readonly timeline: readonly GrandTimelineItem[];
};

export type GrandView = {
  readonly simulationTime: SimTime;
  readonly ruleValue: "new_law" | "old_law";
  readonly treasuryTruth: number;
  readonly treasuryReported: number | undefined;
  readonly treasuryVerified: number | undefined;
  readonly factionSupport: {
    readonly reform: number;
    readonly restore: number;
  };
  readonly resistanceEvidence: number | undefined;
  readonly resistanceFlat: number;
  readonly support: number;
  readonly oppose: number;
  readonly emperorInbox: number;
  readonly privateMessages: number;
  readonly removals: number;
  readonly bribeStatus: "offered" | "accepted" | "rejected" | undefined;
  readonly corruptionCount: number;
  readonly timeline: readonly GrandTimelineItem[];
};

export type GrandRun = {
  readonly state: GrandState;
  readonly records: readonly SimulationRecord[];
  readonly finalView: GrandView;
};

export const grandIds = {
  emperor: "actor:emperor",
  wang: "actor:wang",
  lv: "actor:lv",
  sima: "actor:sima",
  chancellor: "actor:chancellor",
  fan: "actor:fan",
  governor: "actor:governor",
  treasury: "account:treasury",
  governorAccount: "account:governor",
  simaAccount: "account:sima",
  governorship: "office:governorship",
  newLaw: "policy:new-law",
  finding: "finding:governor-diversion",
  bribe: "bribe:governor-sima",
  relationshipWangLv: "relationship:wang-lv",
  relationshipSimaChancellor: "relationship:sima-chancellor",
  relationshipChancellorGovernor: "relationship:chancellor-governor",
  relationshipWangFan: "relationship:wang-fan",
} as const;

const ids = grandIds;

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

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  valence: number,
  kind: RelationshipEdge["kind"] = "informal_influence",
): RelationshipEdge {
  return {
    id,
    sourceId,
    targetId,
    kind,
    strength: 0.8,
    valence,
    updatedAt: simTime(0),
    evidenceRefs: [],
  };
}

export function createGrandInitialState(): GrandState {
  const actors: Record<string, GrandActor> = {
    [ids.emperor]: {
      id: ids.emperor,
      name: "The Emperor",
      office: "office:sovereign",
      influence: 0.4,
      ideology: 0,
      motivations: motivations({ loyaltyToState: 0.9 }),
    },
    [ids.wang]: {
      id: ids.wang,
      name: "Wang",
      office: "office:chancellery",
      influence: 1,
      ideology: 0.9,
      motivations: motivations({ ideologicalCommitment: 0.95 }),
    },
    [ids.lv]: {
      id: ids.lv,
      name: "Lv",
      office: "office:finance",
      influence: 1,
      ideology: 0.6,
      motivations: motivations({ ideologicalCommitment: 0.7 }),
    },
    [ids.sima]: {
      id: ids.sima,
      name: "Sima",
      office: "office:censorate",
      influence: 1,
      ideology: -0.85,
      motivations: motivations({ ideologicalCommitment: 0.9 }),
    },
    [ids.chancellor]: {
      id: ids.chancellor,
      name: "Chancellor",
      office: "office:grand-chancellor",
      influence: 0.9,
      ideology: -0.4,
      motivations: motivations({ officeRetention: 0.9 }),
    },
    [ids.fan]: {
      id: ids.fan,
      name: "Fan",
      office: "office:ministry",
      influence: 1,
      ideology: -0.5,
      motivations: motivations({ ideologicalCommitment: 0.5 }),
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

  const relationships: Record<string, RelationshipEdge> = {
    [ids.relationshipWangLv]: edge(
      ids.relationshipWangLv,
      ids.wang,
      ids.lv,
      0.7,
    ),
    [ids.relationshipSimaChancellor]: edge(
      ids.relationshipSimaChancellor,
      ids.sima,
      ids.chancellor,
      0.6,
    ),
    [ids.relationshipChancellorGovernor]: edge(
      ids.relationshipChancellorGovernor,
      ids.chancellor,
      ids.governor,
      0.8,
      "funding",
    ),
    [ids.relationshipWangFan]: edge(
      ids.relationshipWangFan,
      ids.wang,
      ids.fan,
      -0.3,
    ),
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
  fiscal = createAccount(fiscal, {
    id: ids.simaAccount,
    ownerId: ids.sima,
    kind: "money",
    balance: 0,
  });

  const accountability: AccountabilityState = {
    ...emptyAccountabilityState,
    actors: {
      [ids.governor]: { id: ids.governor, influence: 1, loyaltyToRuler: 0.4 },
      [ids.chancellor]: {
        id: ids.chancellor,
        influence: 0.9,
        loyaltyToRuler: 0.5,
      },
    },
    relationships,
  };

  let bribery: BriberyState = emptyBriberyState;
  for (const actor of Object.values(actors)) {
    bribery = addBriberyActor(bribery, {
      id: actor.id,
      motivations: actor.motivations,
    });
  }

  return {
    actors,
    relationships,
    fiscal,
    accountability,
    bribery,
    policy: { id: ids.newLaw, title: "New Law", direction: "reform" },
    messages: {},
    observations: [],
    petitions: [],
    ruleValue: "old_law",
    timeline: [],
  };
}

export function createGrandModel(
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
): DomainModel<GrandState> {
  return {
    async resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];
      for (const event of events) {
        switch (event.eventType) {
          case "court.petition":
            committed.push({
              eventType: "petition.recorded",
              actorId: String(event.payload.authorId),
              causalEventId: event.id,
              payload: { policyId: String(event.payload.policyId) },
            });
            break;
          case "court.levy":
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
          case "court.graft":
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
          case "court.return":
            committed.push({
              eventType: "fiscal.returned",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                returnId: String(event.payload.returnId),
                authorId: ids.governor,
                subjectRef: ids.treasury,
                claimedBalance: Number(event.payload.claimedBalance),
                basis: "administrative_return",
              },
            });
            break;
          case "court.audit": {
            const bribed =
              state.bribery.bribes[ids.bribe]?.status === "accepted";
            committed.push({
              eventType: "audit.recorded",
              actorId: ids.sima,
              causalEventId: event.id,
              payload: {
                returnId: String(event.payload.returnId),
                verifiedBalance: bribed
                  ? 100
                  : Number(event.payload.verifiedBalance),
              },
            });
            break;
          }
          case "court.finding": {
            const bribed =
              state.bribery.bribes[ids.bribe]?.status === "accepted";
            if (bribed) {
              committed.push({
                eventType: "observation.recorded",
                actorId: ids.sima,
                causalEventId: event.id,
                payload: {
                  observationId: "observation:finding-suppressed",
                  actorId: ids.sima,
                  sourceId: ids.governor,
                  text: "the censorial finding was suppressed after payment",
                },
              });
              break;
            }
            committed.push({
              eventType: "finding.recorded",
              actorId: ids.sima,
              causalEventId: event.id,
              payload: {
                findingId: ids.finding,
                actorId: ids.governor,
                officeId: ids.governorship,
                subject: "diverted levy through a private account",
                claimRefs: ["return:governor"],
                evidenceRefs: ["return:governor", "audit:governor"],
                strength: Number(event.payload.strength),
              },
            });
            break;
          }
          case "court.lobby": {
            const messageId = String(event.payload.messageId);
            committed.push({
              eventType: "lobby.sent",
              actorId: String(event.payload.senderId),
              causalEventId: event.id,
              payload: {
                messageId,
                senderId: String(event.payload.senderId),
                recipientId: String(event.payload.recipientId),
                policyId: ids.newLaw,
              },
            });
            scheduled.push({
              eventType: "lobby.arrive",
              scheduledAt: addSimTime(time, 10),
              actorId: String(event.payload.senderId),
              targetIds: [String(event.payload.recipientId)],
              causalEventId: event.id,
              payload: { messageId },
            });
            break;
          }
          case "lobby.arrive": {
            const messageId = String(event.payload.messageId);
            const message = requiredMessage(state, messageId);
            committed.push({
              eventType: "lobby.applied",
              actorId: message.senderId,
              targetIds: [message.recipientId],
              causalEventId: event.id,
              payload: {
                messageId,
                delta: lobbyDelta(state, message.senderId, message.recipientId),
              },
            });
            committed.push({
              eventType: "observation.recorded",
              actorId: message.recipientId,
              causalEventId: event.id,
              payload: {
                observationId: `observation:${message.id}`,
                actorId: message.recipientId,
                sourceId: message.senderId,
                text: `${message.senderId} privately urged the New Law`,
              },
            });
            break;
          }
          case "court.vote": {
            const { support, oppose } = tally(state);
            committed.push({
              eventType: "vote.recorded",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: { support, oppose },
            });
            break;
          }
          case "court.decide": {
            if (!state.vote) throw new Error("Cannot decide before a vote");
            committed.push({
              eventType:
                state.vote.support > state.vote.oppose
                  ? "rule.endorsed"
                  : "rule.deferred",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: {
                support: state.vote.support,
                oppose: state.vote.oppose,
              },
            });
            break;
          }
          case "court.bribe": {
            const toId = String(event.payload.toId);
            const amount = Number(event.payload.amount);
            const targetRef = String(event.payload.targetRef);
            const recipient = requiredActor(state, toId);
            const relationship = Object.values(state.relationships).find(
              (candidate) =>
                candidate.sourceId === ids.governor &&
                candidate.targetId === toId,
            );
            const decision = {
              ...(await bribePolicy.decide({
                offerId: ids.bribe,
                briberId: ids.governor,
                recipientId: toId,
                offerAmount: amount,
                targetRef,
                recipientMotivations: recipient.motivations,
                recipientInfluence: recipient.influence,
                ...(relationship === undefined
                  ? {}
                  : { relationshipValence: relationship.valence }),
              })),
            };
            committed.push({
              eventType: "bribe.offered",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                bribeId: ids.bribe,
                chainId: ids.bribe,
                fromId: ids.governor,
                toId,
                amount,
                targetRef,
              },
            });
            committed.push({
              eventType: decision.accept ? "bribe.accepted" : "bribe.rejected",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: { bribeId: ids.bribe, reason: decision.reason },
            });
            if (decision.accept) {
              committed.push({
                eventType: "resource.flowed",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: {
                  flowId: `flow:bribe:${time}`,
                  kind: "transfer",
                  fromAccountId: ids.governorAccount,
                  toAccountId: ids.simaAccount,
                  amount,
                  reason: "bribe payment",
                },
              });
              committed.push({
                eventType: "corruption.recorded",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: {
                  corruptionId: "corruption:governor-sima",
                  actorId: toId,
                  bribeId: ids.bribe,
                  amount,
                  evidenceRefs: [ids.bribe],
                },
              });
              committed.push({
                eventType: "obligation.incurred",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: {
                  obligationId: "obligation:sima-governor",
                  debtorId: toId,
                  creditorId: ids.governor,
                  kind: "money",
                  value: amount,
                },
              });
            }
            break;
          }
          case "court.remove": {
            const hasFinding =
              state.accountability.findings[ids.finding] !== undefined;
            committed.push({
              eventType: "removal.recorded",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: {
                removalId: "removal:governor",
                actorId: ids.governor,
                officeId: ids.governorship,
                basis: hasFinding ? "evidence" : "flat",
                ...(hasFinding ? { findingId: ids.finding } : {}),
              },
            });
            break;
          }
          default:
            throw new Error(`Unknown grand-court event: ${event.eventType}`);
        }
      }
      return { events: committed, scheduled };
    },
    reduce: reduceGrandState,
    validate(_before, after) {
      for (const actor of Object.values(after.actors)) {
        if (actor.ideology < -1 || actor.ideology > 1) {
          throw new Error(`${actor.id} ideology must be within [-1, 1]`);
        }
      }
    },
  };
}

export function reduceGrandState(
  state: GrandState,
  event: DomainEvent,
): GrandState {
  if (isFiscalEvent(event.eventType)) {
    return {
      ...state,
      fiscal: reduceFiscalEvent(state.fiscal, event),
      timeline: [...state.timeline, item(event, event.eventType)],
    };
  }
  if (isAccountabilityEvent(event.eventType)) {
    return {
      ...state,
      accountability: reduceAccountabilityEvent(state.accountability, event),
      timeline: [...state.timeline, item(event, event.eventType)],
    };
  }
  if (isBriberyEvent(event.eventType)) {
    return {
      ...state,
      bribery: reduceBriberyEvent(state.bribery, event),
      timeline: [...state.timeline, item(event, describeBribery(event))],
    };
  }
  switch (event.eventType) {
    case "petition.recorded":
      return {
        ...state,
        petitions: [...state.petitions, String(event.payload.policyId)],
        timeline: [
          ...state.timeline,
          item(event, `petition: ${String(event.payload.policyId)}`),
        ],
      };
    case "lobby.sent": {
      const message: GrandMessage = {
        id: String(event.payload.messageId),
        senderId: String(event.payload.senderId),
        recipientId: String(event.payload.recipientId),
        policyId: String(event.payload.policyId),
        status: "in_transit",
      };
      requiredActor(state, message.senderId);
      requiredActor(state, message.recipientId);
      return {
        ...state,
        messages: { ...state.messages, [message.id]: message },
        timeline: [
          ...state.timeline,
          item(
            event,
            `${message.senderId} -> ${message.recipientId}: lobbying sent`,
          ),
        ],
      };
    }
    case "lobby.applied": {
      const message = requiredMessage(state, String(event.payload.messageId));
      const recipient = requiredActor(state, message.recipientId);
      const delta = Number(event.payload.delta);
      return {
        ...state,
        actors: {
          ...state.actors,
          [recipient.id]: {
            ...recipient,
            ideology: rounded(clamp(recipient.ideology + delta, -1, 1)),
          },
        },
        messages: {
          ...state.messages,
          [message.id]: { ...message, status: "delivered" },
        },
        timeline: [
          ...state.timeline,
          item(
            event,
            `${message.recipientId} persuaded by ${message.senderId} (delta ${delta})`,
          ),
        ],
      };
    }
    case "observation.recorded": {
      const observation: GrandObservation = {
        id: String(event.payload.observationId),
        actorId: String(event.payload.actorId),
        at: event.occurredAt,
        sourceId: String(event.payload.sourceId),
        text: String(event.payload.text),
      };
      return { ...state, observations: [...state.observations, observation] };
    }
    case "vote.recorded":
      return {
        ...state,
        vote: {
          support: Number(event.payload.support),
          oppose: Number(event.payload.oppose),
        },
        timeline: [
          ...state.timeline,
          item(
            event,
            `tally: support ${Number(event.payload.support)} vs oppose ${Number(event.payload.oppose)}`,
          ),
        ],
      };
    case "rule.endorsed":
      return {
        ...state,
        ruleValue: "new_law",
        timeline: [
          ...state.timeline,
          item(event, "Emperor endorsed the New Law"),
        ],
      };
    case "rule.deferred":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          item(event, "Emperor deferred the New Law"),
        ],
      };
    default:
      throw new Error(
        `Unhandled grand-court event ${event.eventType} (${event.id})`,
      );
  }
}

export function deriveGrandStance(state: GrandState, actorId: string): number {
  const actor = requiredActor(state, actorId);
  const sign = state.policy.direction === "reform" ? 1 : -1;
  const weight = 0.5 + 0.5 * actor.motivations.ideologicalCommitment;
  return rounded(clamp(actor.ideology * sign * weight, -1, 1));
}

export function grandView(state: GrandState, time: SimTime): GrandView {
  const resistanceFlat = deriveResistanceToRemoval(
    state.accountability,
    ids.governor,
    "flat",
  );
  const resistanceEvidence = state.accountability.findings[ids.finding]
    ? deriveResistanceToRemoval(
        state.accountability,
        ids.governor,
        "evidence",
        ids.finding,
      ).score
    : undefined;
  const tallyValue = state.vote ?? tally(state);
  return {
    simulationTime: time,
    ruleValue: state.ruleValue,
    treasuryTruth: deriveBalance(state.fiscal, ids.treasury),
    treasuryReported: deriveReportedBalance(state.fiscal, ids.treasury),
    treasuryVerified: deriveVerifiedBalance(state.fiscal, ids.treasury),
    factionSupport: factionSupport(state),
    resistanceEvidence,
    resistanceFlat: resistanceFlat.score,
    support: tallyValue.support,
    oppose: tallyValue.oppose,
    emperorInbox: state.observations.filter(
      (observation) => observation.actorId === ids.emperor,
    ).length,
    privateMessages: Object.keys(state.messages).length,
    removals: state.accountability.removals.length,
    bribeStatus: state.bribery.bribes[ids.bribe]?.status,
    corruptionCount: state.bribery.corruption.length,
    timeline: state.timeline,
  };
}

export async function runGrandCourt(
  runId = "grand-court-demo",
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
): Promise<GrandRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createGrandInitialState(),
    createGrandModel(bribePolicy),
    store,
    runId,
  );
  const schedule: readonly ScheduledEventDraft[] = [
    {
      eventType: "court.petition",
      scheduledAt: simTime(0),
      actorId: ids.wang,
      payload: { policyId: ids.newLaw, authorId: ids.wang },
    },
    {
      eventType: "court.levy",
      scheduledAt: simTime(5),
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
      eventType: "court.lobby",
      scheduledAt: simTime(15),
      actorId: ids.wang,
      payload: {
        messageId: "message:wang-lv",
        senderId: ids.wang,
        recipientId: ids.lv,
      },
    },
    {
      eventType: "court.lobby",
      scheduledAt: simTime(15),
      actorId: ids.sima,
      payload: {
        messageId: "message:sima-chancellor",
        senderId: ids.sima,
        recipientId: ids.chancellor,
      },
    },
    {
      eventType: "court.return",
      scheduledAt: simTime(20),
      actorId: ids.governor,
      payload: { returnId: "return:governor", claimedBalance: 100 },
    },
    {
      eventType: "court.bribe",
      scheduledAt: simTime(22),
      actorId: ids.governor,
      payload: { toId: ids.sima, amount: 40, targetRef: "audit:governor" },
    },
    {
      eventType: "court.audit",
      scheduledAt: simTime(30),
      actorId: ids.sima,
      payload: { returnId: "return:governor", verifiedBalance: 60 },
    },
    {
      eventType: "court.finding",
      scheduledAt: simTime(35),
      actorId: ids.sima,
      payload: { strength: 0.9 },
    },
    {
      eventType: "court.vote",
      scheduledAt: simTime(40),
      actorId: ids.emperor,
      payload: {},
    },
    {
      eventType: "court.decide",
      scheduledAt: simTime(45),
      actorId: ids.emperor,
      payload: {},
    },
    {
      eventType: "court.remove",
      scheduledAt: simTime(50),
      actorId: ids.emperor,
      payload: {},
    },
  ];
  for (const draft of schedule) await kernel.schedule(draft);
  await kernel.runUntilIdle();

  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(createGrandInitialState(), records, reduceGrandState),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live grand-court state");
  }
  return {
    state: kernel.state,
    records,
    finalView: grandView(kernel.state, kernel.time),
  };
}

function factionSupport(state: GrandState): {
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

function tally(state: GrandState): {
  readonly support: number;
  readonly oppose: number;
} {
  let support = 0;
  let oppose = 0;
  for (const actor of Object.values(state.actors)) {
    if (actor.id === ids.emperor) continue;
    const stance = deriveGrandStance(state, actor.id);
    if (stance > 0) support += actor.influence * stance;
    else if (stance < 0) oppose += actor.influence * -stance;
  }
  return { support: rounded(support), oppose: rounded(oppose) };
}

function lobbyDelta(
  state: GrandState,
  senderId: string,
  recipientId: string,
): number {
  const stance = deriveGrandStance(state, senderId);
  const relationship = Object.values(state.relationships).find(
    (candidate) =>
      candidate.sourceId === senderId && candidate.targetId === recipientId,
  );
  const trust = relationship
    ? 0.5 + 0.5 * Math.max(0, relationship.valence)
    : 0.5;
  return rounded(stance * trust * 0.6);
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

function isBriberyEvent(eventType: string): boolean {
  return (
    eventType === "bribe.offered" ||
    eventType === "bribe.accepted" ||
    eventType === "bribe.rejected" ||
    eventType === "corruption.recorded" ||
    eventType === "obligation.incurred"
  );
}

function describeBribery(event: DomainEvent): string {
  switch (event.eventType) {
    case "bribe.offered":
      return `bribe offered: ${String(event.payload.fromId)} -> ${String(event.payload.toId)} (${String(event.payload.amount)})`;
    case "bribe.accepted":
      return `bribe accepted (${String(event.payload.reason)})`;
    case "bribe.rejected":
      return `bribe rejected (${String(event.payload.reason)})`;
    default:
      return "corruption recorded";
  }
}

function item(event: DomainEvent, text: string): GrandTimelineItem {
  return { at: event.occurredAt, text };
}

function requiredActor(state: GrandState, id: string): GrandActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown grand-court actor: ${id}`);
  return actor;
}

function requiredMessage(state: GrandState, id: string): GrandMessage {
  const message = state.messages[id];
  if (!message) throw new Error(`Unknown grand-court message: ${id}`);
  return message;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
