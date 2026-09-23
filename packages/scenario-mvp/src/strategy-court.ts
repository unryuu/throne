import {
  simTime,
  type DomainEvent,
  type MotivationProfile,
  type SimulationRecord,
} from "@throne/shared-types";
import {
  InMemoryEventStore,
  SimulationKernel,
  replay,
  type DomainEventDraft,
  type DomainModel,
} from "@throne/sim-core";
import {
  HeuristicBribePolicy,
  type BribeDecisionPolicy,
} from "@throne/agent-runtime/bribe";
import {
  assertActionAvailable,
  type ActorAction,
  type ActorActionContext,
  type ActorActionKind,
  type ActorActionPolicy,
} from "@throne/agent-runtime/action";
import {
  addBriberyActor,
  emptyBriberyState,
  reduceBriberyEvent,
  type BriberyState,
} from "./bribery.ts";

export type StrategyActor = {
  readonly id: string;
  readonly name: string;
  readonly influence: number;
  readonly motivations: MotivationProfile;
  readonly availableActions: readonly ActorActionKind[];
  readonly knownSubjectRefs: readonly string[];
};

export type StrategyMessage = {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
};

export type StrategyReport = {
  readonly id: string;
  readonly authorId: string;
  readonly subjectRef: string;
};

export type StrategyState = {
  readonly actors: Readonly<Record<string, StrategyActor>>;
  readonly bribes: BriberyState;
  readonly messages: readonly StrategyMessage[];
  readonly reports: readonly StrategyReport[];
  readonly stances: readonly {
    readonly actorId: string;
    readonly stance: "obey" | "defect";
  }[];
  readonly chosen?: ActorActionKind;
  readonly timeline: readonly { readonly at: number; readonly text: string }[];
};

export type StrategyRun = {
  readonly state: StrategyState;
  readonly records: readonly SimulationRecord[];
};

export const strategyIds = {
  officer: "actor:officer",
  auditor: "actor:auditor",
  misconduct: "subject:officer-misconduct",
} as const;

const ids = strategyIds;

function profile(start: Partial<MotivationProfile> = {}): MotivationProfile {
  return {
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
  };
}

export function createStrategyInitialState(): StrategyState {
  let bribes = emptyBriberyState;
  const officer: StrategyActor = {
    id: ids.officer,
    name: "Officer",
    influence: 1,
    motivations: profile({
      wealth: 0.9,
      proceduralLegality: 0.2,
      riskTolerance: 0.7,
    }),
    availableActions: ["bribe", "lobby", "report"],
    knownSubjectRefs: [ids.misconduct, ids.auditor],
  };
  const auditor: StrategyActor = {
    id: ids.auditor,
    name: "Auditor",
    influence: 1,
    motivations: profile({ proceduralLegality: 0.9 }),
    availableActions: ["obey"],
    knownSubjectRefs: [],
  };
  bribes = addBriberyActor(bribes, {
    id: officer.id,
    motivations: officer.motivations,
  });
  bribes = addBriberyActor(bribes, {
    id: auditor.id,
    motivations: auditor.motivations,
  });
  return {
    actors: { [officer.id]: officer, [auditor.id]: auditor },
    bribes,
    messages: [],
    reports: [],
    stances: [],
    timeline: [],
  };
}

export function createStrategyModel(
  policy: ActorActionPolicy,
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
): DomainModel<StrategyState> {
  return {
    async resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      for (const event of events) {
        if (event.eventType !== "strategy.decide") {
          throw new Error(`Unknown strategy event: ${event.eventType}`);
        }
        const actor = requiredActor(state, String(event.payload.actorId));
        const context: ActorActionContext = {
          actorId: actor.id,
          influence: actor.influence,
          motivations: actor.motivations,
          availableActions: actor.availableActions,
          knownSubjectRefs: actor.knownSubjectRefs,
        };
        const action = assertActionAvailable(
          await policy.decide(context),
          context,
        );
        committed.push(chosenDraft(actor.id, action, event.id));
        committed.push(
          ...(await actionDrafts(state, action, bribePolicy, time, event.id)),
        );
      }
      return { events: committed };
    },
    reduce: reduceStrategyState,
  };
}

async function actionDrafts(
  state: StrategyState,
  action: ActorAction,
  bribePolicy: BribeDecisionPolicy,
  time: number,
  cause: string,
): Promise<DomainEventDraft[]> {
  switch (action.kind) {
    case "lobby":
      return [
        {
          eventType: "lobby.sent",
          actorId: ids.officer,
          causalEventId: cause,
          payload: {
            messageId: `message:lobby:${time}`,
            senderId: ids.officer,
            recipientId: action.recipientId,
          },
        },
      ];
    case "bribe": {
      const recipient = requiredActor(state, action.recipientId);
      const decision = await bribePolicy.decide({
        offerId: `bribe:${time}`,
        briberId: ids.officer,
        recipientId: recipient.id,
        offerAmount: action.offerAmount,
        targetRef: action.targetRef,
        recipientMotivations: recipient.motivations,
        recipientInfluence: recipient.influence,
      });
      const drafts: DomainEventDraft[] = [
        {
          eventType: "bribe.offered",
          actorId: ids.officer,
          causalEventId: cause,
          payload: {
            bribeId: `bribe:${time}`,
            chainId: `chain:${time}`,
            fromId: ids.officer,
            toId: recipient.id,
            amount: action.offerAmount,
            targetRef: action.targetRef,
          },
        },
        {
          eventType: decision.accept ? "bribe.accepted" : "bribe.rejected",
          actorId: ids.officer,
          causalEventId: cause,
          payload: { bribeId: `bribe:${time}`, reason: decision.reason },
        },
      ];
      if (decision.accept) {
        drafts.push({
          eventType: "corruption.recorded",
          actorId: ids.officer,
          causalEventId: cause,
          payload: {
            corruptionId: `corruption:${time}`,
            actorId: recipient.id,
            bribeId: `bribe:${time}`,
            amount: action.offerAmount,
            evidenceRefs: [`bribe:${time}`],
          },
        });
      }
      return drafts;
    }
    case "report":
      return [
        {
          eventType: "report.filed",
          actorId: ids.officer,
          causalEventId: cause,
          payload: {
            reportId: `report:${time}`,
            authorId: ids.officer,
            subjectRef: action.subjectRef,
          },
        },
      ];
    case "obey":
    case "defect":
      return [
        {
          eventType: "stance.recorded",
          actorId: ids.officer,
          causalEventId: cause,
          payload: { actorId: ids.officer, stance: action.kind },
        },
      ];
  }
}

function chosenDraft(
  actorId: string,
  action: ActorAction,
  cause: string,
): DomainEventDraft {
  return {
    eventType: "strategy.chosen",
    actorId,
    causalEventId: cause,
    payload: { actorId, kind: action.kind },
  };
}

export function reduceStrategyState(
  state: StrategyState,
  event: DomainEvent,
): StrategyState {
  if (
    event.eventType === "bribe.offered" ||
    event.eventType === "bribe.accepted" ||
    event.eventType === "bribe.rejected" ||
    event.eventType === "corruption.recorded"
  ) {
    return {
      ...state,
      bribes: reduceBriberyEvent(state.bribes, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: event.eventType },
      ],
    };
  }
  switch (event.eventType) {
    case "strategy.chosen": {
      const kind = event.payload.kind;
      if (
        kind !== "lobby" &&
        kind !== "bribe" &&
        kind !== "report" &&
        kind !== "obey" &&
        kind !== "defect"
      ) {
        throw new Error(`Invalid strategy choice: ${String(kind)}`);
      }
      return {
        ...state,
        chosen: kind,
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: `chose ${kind}` },
        ],
      };
    }
    case "lobby.sent": {
      const message: StrategyMessage = {
        id: String(event.payload.messageId),
        senderId: String(event.payload.senderId),
        recipientId: String(event.payload.recipientId),
      };
      return {
        ...state,
        messages: [...state.messages, message],
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: "lobby sent" },
        ],
      };
    }
    case "report.filed": {
      const report: StrategyReport = {
        id: String(event.payload.reportId),
        authorId: String(event.payload.authorId),
        subjectRef: String(event.payload.subjectRef),
      };
      return {
        ...state,
        reports: [...state.reports, report],
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: "report filed" },
        ],
      };
    }
    case "stance.recorded": {
      const stance = event.payload.stance;
      if (stance !== "obey" && stance !== "defect") {
        throw new Error(`Invalid stance: ${String(stance)}`);
      }
      return {
        ...state,
        stances: [
          ...state.stances,
          { actorId: String(event.payload.actorId), stance },
        ],
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: `stance ${stance}` },
        ],
      };
    }
    default:
      throw new Error(
        `Unhandled strategy event ${event.eventType} (${event.id})`,
      );
  }
}

export async function runStrategyCourt(
  policy: ActorActionPolicy,
  runId = "strategy-court-demo",
): Promise<StrategyRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createStrategyInitialState(),
    createStrategyModel(policy),
    store,
    runId,
  );
  await kernel.schedule({
    eventType: "strategy.decide",
    scheduledAt: simTime(10),
    actorId: ids.officer,
    payload: { actorId: ids.officer },
  });
  await kernel.runUntilIdle();
  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(createStrategyInitialState(), records, reduceStrategyState),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live strategy state");
  }
  return { state: kernel.state, records };
}

function requiredActor(state: StrategyState, id: string): StrategyActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown strategy actor: ${id}`);
  return actor;
}
