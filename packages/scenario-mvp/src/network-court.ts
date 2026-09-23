import {
  simTime,
  validateMotivationProfile,
  type DomainEvent,
  type MotivationProfile,
  type SimTime,
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
  createAccount,
  deriveBalance,
  deriveReportedBalance,
  deriveVerifiedBalance,
  emptyFiscalState,
  reduceFiscalEvent,
  type FiscalState,
} from "./fiscal.ts";
import {
  emptyAccountabilityState,
  reduceAccountabilityEvent,
  deriveProtectionScore,
  type AccountabilityState,
} from "./accountability.ts";
import {
  addBriberyActor,
  deriveBriberyChain,
  derivePatronageShare,
  emptyBriberyState,
  reduceBriberyEvent,
  type BriberyState,
} from "./bribery.ts";

export type NetworkActor = {
  readonly id: string;
  readonly name: string;
  readonly influence: number;
  readonly motivations: MotivationProfile;
};

export type NetworkState = {
  readonly actors: Readonly<Record<string, NetworkActor>>;
  readonly fiscal: FiscalState;
  readonly accountability: AccountabilityState;
  readonly bribery: BriberyState;
  readonly exposed: boolean;
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type NetworkRun = {
  readonly state: NetworkState;
  readonly records: readonly SimulationRecord[];
  readonly view: {
    readonly chainDepth: number;
    readonly chainHops: number;
    readonly chainValue: number;
    readonly patronageShare: number;
    readonly protectionScore: number;
    readonly disputes: number;
    readonly corruption: number;
    readonly obligations: number;
    readonly findings: number;
    readonly removals: number;
    readonly exposed: boolean;
    readonly treasuryTruth: number;
    readonly treasuryReported: number | undefined;
    readonly treasuryVerified: number | undefined;
    readonly timeline: readonly {
      readonly at: SimTime;
      readonly text: string;
    }[];
  };
};

export const networkIds = {
  governor: "actor:governor",
  censor: "actor:censor",
  clerk: "actor:clerk",
  inspector: "actor:inspector",
  treasury: "account:treasury",
  chain: "chain:payroll-cover-up",
  bribeCensor: "bribe:censor",
  bribeClerk: "bribe:clerk",
  finding: "finding:governor-diversion",
} as const;

const ids = networkIds;

function profile(start: Partial<MotivationProfile> = {}): MotivationProfile {
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

function accountId(actorId: string): string {
  return `account:${actorId}`;
}

export function createNetworkInitialState(): NetworkState {
  const actors: Record<string, NetworkActor> = {
    [ids.governor]: {
      id: ids.governor,
      name: "Governor",
      influence: 1,
      motivations: profile({
        wealth: 0.95,
        proceduralLegality: 0.2,
        riskTolerance: 0.8,
      }),
    },
    [ids.censor]: {
      id: ids.censor,
      name: "Censor",
      influence: 1,
      motivations: profile({
        wealth: 0.9,
        proceduralLegality: 0.2,
        riskTolerance: 0.7,
      }),
    },
    [ids.clerk]: {
      id: ids.clerk,
      name: "Clerk",
      influence: 0.8,
      motivations: profile({
        wealth: 0.95,
        proceduralLegality: 0.05,
        riskTolerance: 0.8,
      }),
    },
    [ids.inspector]: {
      id: ids.inspector,
      name: "Inspector",
      influence: 1,
      motivations: profile({ proceduralLegality: 0.9 }),
    },
  };

  let fiscal = createAccount(emptyFiscalState, {
    id: ids.treasury,
    ownerId: "organization:court",
    kind: "money",
    balance: 0,
  });
  for (const actor of Object.values(actors)) {
    fiscal = createAccount(fiscal, {
      id: accountId(actor.id),
      ownerId: actor.id,
      kind: "money",
      balance: 0,
    });
  }

  let bribery = emptyBriberyState;
  for (const actor of Object.values(actors)) {
    bribery = addBriberyActor(bribery, {
      id: actor.id,
      motivations: actor.motivations,
    });
  }

  return {
    actors,
    fiscal,
    accountability: {
      ...emptyAccountabilityState,
      actors: {
        [ids.governor]: { id: ids.governor, influence: 1, loyaltyToRuler: 0.3 },
        [ids.censor]: { id: ids.censor, influence: 1, loyaltyToRuler: 0.3 },
        [ids.clerk]: { id: ids.clerk, influence: 0.8, loyaltyToRuler: 0.3 },
      },
      relationships: {
        "relationship:censor-protects-governor": {
          id: "relationship:censor-protects-governor",
          sourceId: ids.censor,
          targetId: ids.governor,
          kind: "informal_influence",
          strength: 0.8,
          valence: 0.7,
          updatedAt: simTime(0),
          evidenceRefs: [],
        },
      },
    },
    bribery,
    exposed: false,
    timeline: [],
  };
}

export function createNetworkModel(
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
): DomainModel<NetworkState> {
  return {
    async resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      for (const event of events) {
        switch (event.eventType) {
          case "court.levy":
            committed.push({
              eventType: "resource.flowed",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                flowId: `flow:levy:${time}`,
                kind: "levy",
                toAccountId: ids.treasury,
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
                fromAccountId: ids.treasury,
                toAccountId: accountId(ids.governor),
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
                returnId: "return:governor",
                authorId: ids.governor,
                subjectRef: ids.treasury,
                claimedBalance: 100,
                basis: "administrative_return",
              },
            });
            break;
          case "court.bribe": {
            const fromId = String(event.payload.fromId);
            const toId = String(event.payload.toId);
            const amount = Number(event.payload.amount);
            const bribeId = String(event.payload.bribeId);
            const parentBribeId =
              event.payload.parentBribeId === undefined
                ? undefined
                : String(event.payload.parentBribeId);
            const recipient = requiredActor(state, toId);
            const decision = await bribePolicy.decide({
              offerId: bribeId,
              briberId: fromId,
              recipientId: toId,
              offerAmount: amount,
              targetRef: String(event.payload.targetRef),
              recipientMotivations: recipient.motivations,
              recipientInfluence: recipient.influence,
            });
            committed.push({
              eventType: "bribe.offered",
              actorId: fromId,
              causalEventId: event.id,
              payload: {
                bribeId,
                chainId: ids.chain,
                ...(parentBribeId === undefined ? {} : { parentBribeId }),
                instruction: "cover up the payroll diversion",
                fromId,
                toId,
                amount,
                targetRef: String(event.payload.targetRef),
              },
            });
            committed.push({
              eventType: decision.accept ? "bribe.accepted" : "bribe.rejected",
              actorId: fromId,
              causalEventId: event.id,
              payload: { bribeId, reason: decision.reason },
            });
            if (decision.accept) {
              committed.push({
                eventType: "resource.flowed",
                actorId: fromId,
                causalEventId: event.id,
                payload: {
                  flowId: `flow:bribe:${bribeId}`,
                  kind: "transfer",
                  fromAccountId: accountId(fromId),
                  toAccountId: accountId(toId),
                  amount,
                  reason: "bribe payment",
                },
              });
              committed.push({
                eventType: "corruption.recorded",
                actorId: toId,
                causalEventId: event.id,
                payload: {
                  corruptionId: `corruption:${bribeId}`,
                  actorId: toId,
                  bribeId,
                  amount,
                  evidenceRefs: [bribeId],
                },
              });
              committed.push({
                eventType: "obligation.incurred",
                actorId: toId,
                causalEventId: event.id,
                payload: {
                  obligationId: `obligation:${bribeId}`,
                  debtorId: toId,
                  creditorId: fromId,
                  kind: "money",
                  value: amount,
                },
              });
            }
            break;
          }
          case "court.audit": {
            const covered = Object.values(state.bribery.bribes).some(
              (bribe) =>
                bribe.toId === ids.censor &&
                bribe.status === "accepted" &&
                bribe.targetRef === "audit:governor",
            );
            committed.push({
              eventType: "audit.recorded",
              actorId: ids.inspector,
              causalEventId: event.id,
              payload: {
                returnId: "return:governor",
                verifiedBalance: covered ? 100 : 60,
              },
            });
            break;
          }
          case "court.finding":
            committed.push({
              eventType: "finding.recorded",
              actorId: ids.inspector,
              causalEventId: event.id,
              payload: {
                findingId: ids.finding,
                actorId: ids.governor,
                officeId: "office:governorship",
                subject: "diverted levy covered by a bribery chain",
                claimRefs: ["return:governor"],
                evidenceRefs: [
                  `corruption:${ids.bribeCensor}`,
                  `corruption:${ids.bribeClerk}`,
                ],
                strength: 0.9,
              },
            });
            break;
          case "court.dispute":
            committed.push({
              eventType: "finding.disputed",
              actorId: ids.censor,
              causalEventId: event.id,
              payload: { findingId: ids.finding },
            });
            break;
          case "court.investigate": {
            const chain = deriveBriberyChain(state.bribery, ids.chain);
            const participants = new Set<string>();
            for (const bribe of chain.records) {
              if (bribe.status !== "accepted") continue;
              participants.add(bribe.fromId);
              participants.add(bribe.toId);
            }
            for (const actorId of participants) {
              const evidenceRefs = state.bribery.corruption
                .filter((record) => {
                  const bribe = state.bribery.bribes[record.bribeId];
                  return (
                    bribe !== undefined &&
                    (bribe.fromId === actorId || bribe.toId === actorId)
                  );
                })
                .map((record) => record.id);
              committed.push({
                eventType: "finding.recorded",
                actorId: ids.inspector,
                causalEventId: event.id,
                payload: {
                  findingId: `finding:${actorId}`,
                  actorId,
                  officeId: `office:${actorId}`,
                  subject: "participation in a bribery chain",
                  claimRefs: ["return:governor"],
                  evidenceRefs,
                  strength: 0.85,
                },
              });
            }
            committed.push({
              eventType: "chain.exposed",
              actorId: ids.inspector,
              causalEventId: event.id,
              payload: {},
            });
            break;
          }
          case "court.prosecute":
            for (const finding of Object.values(
              state.accountability.findings,
            )) {
              committed.push({
                eventType: "removal.recorded",
                actorId: ids.inspector,
                causalEventId: event.id,
                payload: {
                  removalId: `removal:${finding.id}`,
                  actorId: finding.actorId,
                  officeId: finding.officeId,
                  basis: "evidence",
                  findingId: finding.id,
                },
              });
            }
            break;
          default:
            throw new Error(`Unknown network event: ${event.eventType}`);
        }
      }
      return { events: committed };
    },
    reduce: reduceNetworkState,
  };
}

export function reduceNetworkState(
  state: NetworkState,
  event: DomainEvent,
): NetworkState {
  if (isBriberyEvent(event.eventType)) {
    return {
      ...state,
      bribery: reduceBriberyEvent(state.bribery, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: event.eventType },
      ],
    };
  }
  if (isFiscalEvent(event.eventType)) {
    return {
      ...state,
      fiscal: reduceFiscalEvent(state.fiscal, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: event.eventType },
      ],
    };
  }
  if (isAccountabilityEvent(event.eventType)) {
    return {
      ...state,
      accountability: reduceAccountabilityEvent(state.accountability, event),
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: event.eventType },
      ],
    };
  }
  if (event.eventType === "chain.exposed") {
    return {
      ...state,
      exposed: true,
      timeline: [
        ...state.timeline,
        { at: event.occurredAt, text: "chain exposed" },
      ],
    };
  }
  throw new Error(`Unhandled network event ${event.eventType} (${event.id})`);
}

export function networkView(
  state: NetworkState,
  time: SimTime,
): NetworkRun["view"] {
  const chain = deriveBriberyChain(state.bribery, ids.chain);
  return {
    chainDepth: chain.depth,
    chainHops: chain.hops,
    chainValue: chain.totalValue,
    patronageShare: derivePatronageShare(state.bribery, ids.governor),
    protectionScore: deriveProtectionScore(state.accountability, ids.governor),
    disputes: state.accountability.disputes.length,
    corruption: state.bribery.corruption.length,
    obligations: state.bribery.obligations.length,
    findings: Object.keys(state.accountability.findings).length,
    removals: state.accountability.removals.length,
    exposed: state.exposed,
    treasuryTruth: deriveBalance(state.fiscal, ids.treasury),
    treasuryReported: deriveReportedBalance(state.fiscal, ids.treasury),
    treasuryVerified: deriveVerifiedBalance(state.fiscal, ids.treasury),
    timeline: state.timeline,
  };
}

export async function runNetworkCourt(
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
  runId = "network-court-demo",
): Promise<NetworkRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createNetworkInitialState(),
    createNetworkModel(bribePolicy),
    store,
    runId,
  );
  for (const draft of [
    {
      eventType: "court.levy",
      scheduledAt: simTime(5),
      actorId: ids.governor,
      payload: { amount: 100 },
    },
    {
      eventType: "court.graft",
      scheduledAt: simTime(10),
      actorId: ids.governor,
      payload: { amount: 60 },
    },
    {
      eventType: "court.bribe",
      scheduledAt: simTime(15),
      actorId: ids.governor,
      payload: {
        bribeId: ids.bribeCensor,
        fromId: ids.governor,
        toId: ids.censor,
        amount: 50,
        targetRef: "audit:governor",
      },
    },
    {
      eventType: "court.bribe",
      scheduledAt: simTime(20),
      actorId: ids.censor,
      payload: {
        bribeId: ids.bribeClerk,
        parentBribeId: ids.bribeCensor,
        fromId: ids.censor,
        toId: ids.clerk,
        amount: 20,
        targetRef: "ledger:payroll",
      },
    },
    {
      eventType: "court.return",
      scheduledAt: simTime(25),
      actorId: ids.governor,
      payload: {},
    },
    {
      eventType: "court.audit",
      scheduledAt: simTime(30),
      actorId: ids.inspector,
      payload: {},
    },
    {
      eventType: "court.finding",
      scheduledAt: simTime(40),
      actorId: ids.inspector,
      payload: {},
    },
    {
      eventType: "court.dispute",
      scheduledAt: simTime(45),
      actorId: ids.censor,
      payload: {},
    },
    {
      eventType: "court.investigate",
      scheduledAt: simTime(60),
      actorId: ids.inspector,
      payload: {},
    },
    {
      eventType: "court.prosecute",
      scheduledAt: simTime(70),
      actorId: ids.inspector,
      payload: {},
    },
  ]) {
    await kernel.schedule(draft);
  }
  await kernel.runUntilIdle();
  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(createNetworkInitialState(), records, reduceNetworkState),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live network state");
  }
  return {
    state: kernel.state,
    records,
    view: networkView(kernel.state, kernel.time),
  };
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

function requiredActor(state: NetworkState, id: string): NetworkActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown network actor: ${id}`);
  return actor;
}
