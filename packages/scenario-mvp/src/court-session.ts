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

export type SessionActor = {
  readonly id: string;
  readonly name: string;
  readonly office: string;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
};

export type SessionMessage = {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly policyId: string;
  readonly status: "in_transit" | "delivered";
};

export type SessionObservation = {
  readonly id: string;
  readonly actorId: string;
  readonly at: SimTime;
  readonly sourceId: string;
  readonly text: string;
};

export type SessionVote = {
  readonly support: number;
  readonly oppose: number;
  readonly at: SimTime;
};

export type SessionTimelineItem = {
  readonly at: SimTime;
  readonly text: string;
};

export type CourtSessionState = {
  readonly actors: Readonly<Record<string, SessionActor>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly policy: {
    readonly id: string;
    readonly title: string;
    readonly direction: "reform" | "restore";
  };
  readonly messages: Readonly<Record<string, SessionMessage>>;
  readonly observations: readonly SessionObservation[];
  readonly petitions: readonly string[];
  readonly vote?: SessionVote;
  readonly ruleValue: "new_law" | "old_law";
  readonly timeline: readonly SessionTimelineItem[];
};

export type CourtSessionView = {
  readonly simulationTime: SimTime;
  readonly ruleValue: "new_law" | "old_law";
  readonly support: number;
  readonly oppose: number;
  readonly emperorObservations: readonly SessionObservation[];
  readonly timeline: readonly SessionTimelineItem[];
};

export type CourtSessionRun = {
  readonly state: CourtSessionState;
  readonly records: readonly SimulationRecord[];
  readonly finalView: CourtSessionView;
};

export const courtSessionIds = {
  emperor: "actor:emperor",
  wang: "actor:wang",
  lv: "actor:lv",
  sima: "actor:sima",
  chancellor: "actor:chancellor",
  fan: "actor:fan",
  newLaw: "policy:new-law",
  relationshipWangLv: "relationship:wang-lv",
  relationshipSimaChancellor: "relationship:sima-chancellor",
  relationshipWangChancellor: "relationship:wang-chancellor",
  relationshipWangFan: "relationship:wang-fan",
  relationshipSimaLv: "relationship:sima-lv",
} as const;

const ids = courtSessionIds;

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

function relationship(
  id: string,
  sourceId: string,
  targetId: string,
  valence: number,
): RelationshipEdge {
  return {
    id,
    sourceId,
    targetId,
    kind: "informal_influence",
    strength: 0.8,
    valence,
    updatedAt: simTime(0),
    evidenceRefs: [],
  };
}

export const courtSessionInitialState: CourtSessionState = {
  actors: {
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
  },
  relationships: {
    [ids.relationshipWangLv]: relationship(
      ids.relationshipWangLv,
      ids.wang,
      ids.lv,
      0.7,
    ),
    [ids.relationshipSimaChancellor]: relationship(
      ids.relationshipSimaChancellor,
      ids.sima,
      ids.chancellor,
      0.6,
    ),
    [ids.relationshipWangChancellor]: relationship(
      ids.relationshipWangChancellor,
      ids.wang,
      ids.chancellor,
      -0.5,
    ),
    [ids.relationshipWangFan]: relationship(
      ids.relationshipWangFan,
      ids.wang,
      ids.fan,
      -0.3,
    ),
    [ids.relationshipSimaLv]: relationship(
      ids.relationshipSimaLv,
      ids.sima,
      ids.lv,
      -0.2,
    ),
  },
  policy: { id: ids.newLaw, title: "New Law", direction: "reform" },
  messages: {},
  observations: [],
  petitions: [],
  ruleValue: "old_law",
  timeline: [],
};

export function deriveSessionStance(
  state: CourtSessionState,
  actorId: string,
): number {
  const actor = requiredActor(state, actorId);
  const sign = state.policy.direction === "reform" ? 1 : -1;
  const weight = 0.5 + 0.5 * actor.motivations.ideologicalCommitment;
  return rounded(clamp(actor.ideology * sign * weight, -1, 1));
}

export function createCourtSessionModel(): DomainModel<CourtSessionState> {
  return {
    resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];
      for (const event of events) {
        switch (event.eventType) {
          case "court.petition": {
            committed.push({
              eventType: "petition.recorded",
              actorId: String(event.payload.authorId),
              causalEventId: event.id,
              payload: { policyId: String(event.payload.policyId) },
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
                policyId: String(event.payload.policyId),
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
            const delta = lobbyDelta(
              state,
              message.senderId,
              message.recipientId,
            );
            committed.push({
              eventType: "lobby.applied",
              actorId: message.senderId,
              targetIds: [message.recipientId],
              causalEventId: event.id,
              payload: { messageId, delta },
            });
            committed.push({
              eventType: "observation.recorded",
              actorId: message.recipientId,
              causalEventId: event.id,
              payload: {
                observationId: `observation:${message.id}`,
                actorId: message.recipientId,
                sourceId: message.senderId,
                text: `${message.senderId} privately urged support for ${message.policyId}`,
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
            const vote = state.vote;
            if (!vote)
              throw new Error("Cannot decide before a vote is recorded");
            const endorsed = vote.support > vote.oppose;
            committed.push({
              eventType: endorsed ? "rule.endorsed" : "rule.deferred",
              actorId: ids.emperor,
              causalEventId: event.id,
              payload: { support: vote.support, oppose: vote.oppose },
            });
            break;
          }
          default:
            throw new Error(`Unknown court-session event: ${event.eventType}`);
        }
      }
      return { events: committed, scheduled };
    },
    reduce: reduceCourtSessionState,
    validate(_before, after) {
      for (const actor of Object.values(after.actors)) {
        if (actor.ideology < -1 || actor.ideology > 1) {
          throw new Error(`${actor.id} ideology must be within [-1, 1]`);
        }
      }
    },
  };
}

export function reduceCourtSessionState(
  state: CourtSessionState,
  event: DomainEvent,
): CourtSessionState {
  switch (event.eventType) {
    case "petition.recorded": {
      const policyId = String(event.payload.policyId);
      if (policyId !== state.policy.id) {
        throw new Error(`Unknown petitioned policy: ${policyId}`);
      }
      return {
        ...state,
        petitions: [...state.petitions, policyId],
        timeline: [
          ...state.timeline,
          entry(event, `petition submitted: ${policyId}`),
        ],
      };
    }
    case "lobby.sent": {
      const message: SessionMessage = {
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
          entry(
            event,
            `${message.senderId} -> ${message.recipientId}: private lobbying sent`,
          ),
        ],
      };
    }
    case "lobby.applied": {
      const messageId = String(event.payload.messageId);
      const message = requiredMessage(state, messageId);
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
          [messageId]: { ...message, status: "delivered" },
        },
        timeline: [
          ...state.timeline,
          entry(
            event,
            `${message.recipientId} persuaded by ${message.senderId} (delta ${delta})`,
          ),
        ],
      };
    }
    case "observation.recorded": {
      const observation: SessionObservation = {
        id: String(event.payload.observationId),
        actorId: String(event.payload.actorId),
        at: event.occurredAt,
        sourceId: String(event.payload.sourceId),
        text: String(event.payload.text),
      };
      requiredActor(state, observation.actorId);
      return {
        ...state,
        observations: [...state.observations, observation],
      };
    }
    case "vote.recorded":
      return {
        ...state,
        vote: {
          support: Number(event.payload.support),
          oppose: Number(event.payload.oppose),
          at: event.occurredAt,
        },
        timeline: [
          ...state.timeline,
          entry(
            event,
            `court tally: support ${Number(event.payload.support)} vs oppose ${Number(event.payload.oppose)}`,
          ),
        ],
      };
    case "rule.endorsed":
      return {
        ...state,
        ruleValue: "new_law",
        timeline: [
          ...state.timeline,
          entry(event, "Emperor endorsed the New Law"),
        ],
      };
    case "rule.deferred":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          entry(event, "Emperor deferred the New Law"),
        ],
      };
    default:
      throw new Error(
        `Unhandled court-session event ${event.eventType} (${event.id})`,
      );
  }
}

export function courtSessionView(
  state: CourtSessionState,
  time: SimTime,
): CourtSessionView {
  const tallyValue = state.vote ?? tally(state);
  return {
    simulationTime: time,
    ruleValue: state.ruleValue,
    support: tallyValue.support,
    oppose: tallyValue.oppose,
    emperorObservations: state.observations.filter(
      (observation) => observation.actorId === ids.emperor,
    ),
    timeline: state.timeline,
  };
}

export async function runCourtSession(
  runId = "court-session-demo",
): Promise<CourtSessionRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    courtSessionInitialState,
    createCourtSessionModel(),
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
      eventType: "court.lobby",
      scheduledAt: simTime(5),
      actorId: ids.wang,
      payload: {
        messageId: "message:wang-lv",
        senderId: ids.wang,
        recipientId: ids.lv,
        policyId: ids.newLaw,
      },
    },
    {
      eventType: "court.lobby",
      scheduledAt: simTime(5),
      actorId: ids.sima,
      payload: {
        messageId: "message:sima-chancellor",
        senderId: ids.sima,
        recipientId: ids.chancellor,
        policyId: ids.newLaw,
      },
    },
    {
      eventType: "court.lobby",
      scheduledAt: simTime(20),
      actorId: ids.wang,
      payload: {
        messageId: "message:wang-fan",
        senderId: ids.wang,
        recipientId: ids.fan,
        policyId: ids.newLaw,
      },
    },
    {
      eventType: "court.lobby",
      scheduledAt: simTime(20),
      actorId: ids.sima,
      payload: {
        messageId: "message:sima-lv",
        senderId: ids.sima,
        recipientId: ids.lv,
        policyId: ids.newLaw,
      },
    },
    {
      eventType: "court.vote",
      scheduledAt: simTime(45),
      actorId: ids.emperor,
      payload: {},
    },
    {
      eventType: "court.decide",
      scheduledAt: simTime(50),
      actorId: ids.emperor,
      payload: {},
    },
  ];
  for (const draft of schedule) await kernel.schedule(draft);
  await kernel.runUntilIdle();

  const records = await store.readAll();
  const replayed = replay(
    courtSessionInitialState,
    records,
    reduceCourtSessionState,
  );
  if (JSON.stringify(replayed) !== JSON.stringify(kernel.state)) {
    throw new Error("Replay differs from live court-session state");
  }
  return {
    state: kernel.state,
    records,
    finalView: courtSessionView(kernel.state, kernel.time),
  };
}

function tally(state: CourtSessionState): {
  readonly support: number;
  readonly oppose: number;
} {
  let support = 0;
  let oppose = 0;
  for (const actor of Object.values(state.actors)) {
    if (actor.id === ids.emperor) continue;
    const stance = deriveSessionStance(state, actor.id);
    if (stance > 0) support += actor.influence * stance;
    else if (stance < 0) oppose += actor.influence * -stance;
  }
  return { support: rounded(support), oppose: rounded(oppose) };
}

function lobbyDelta(
  state: CourtSessionState,
  senderId: string,
  recipientId: string,
): number {
  const senderStance = deriveSessionStance(state, senderId);
  const edge = Object.values(state.relationships).find(
    (candidate) =>
      candidate.sourceId === senderId && candidate.targetId === recipientId,
  );
  const trust = edge ? 0.5 + 0.5 * Math.max(0, edge.valence) : 0.5;
  return rounded(senderStance * trust * 0.6);
}

function entry(event: DomainEvent, text: string): SessionTimelineItem {
  return { at: event.occurredAt, text };
}

function requiredActor(state: CourtSessionState, id: string): SessionActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown session actor: ${id}`);
  return actor;
}

function requiredMessage(state: CourtSessionState, id: string): SessionMessage {
  const message = state.messages[id];
  if (!message) throw new Error(`Unknown session message: ${id}`);
  return message;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
