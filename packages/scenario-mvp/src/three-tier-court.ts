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
  deriveProtectionScore,
  emptyAccountabilityState,
  reduceAccountabilityEvent,
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

export type TierActor = {
  readonly id: string;
  readonly name: string;
  readonly tier: 1 | 2 | 3;
  readonly office: string;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
};

export type TierState = {
  readonly actors: Readonly<Record<string, TierActor>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly fiscal: FiscalState;
  readonly accountability: AccountabilityState;
  readonly bribery: BriberyState;
  readonly policy: { readonly id: string; readonly direction: "reform" };
  readonly ruleValue: "new_law" | "old_law";
  readonly vote?: { readonly support: number; readonly oppose: number };
  readonly orders: readonly {
    readonly id: string;
    readonly fromId: string;
    readonly toId: string;
    readonly quota: number;
    readonly fulfilled: number;
  }[];
  readonly exposed: boolean;
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type TierRun = {
  readonly state: TierState;
  readonly records: readonly SimulationRecord[];
  readonly view: {
    readonly ruleValue: "new_law" | "old_law";
    readonly support: number;
    readonly oppose: number;
    readonly treasuryTruth: number;
    readonly treasuryReported: number | undefined;
    readonly treasuryVerified: number | undefined;
    readonly chainHops: number;
    readonly chainDepth: number;
    readonly chainValue: number;
    readonly patronageShare: number;
    readonly protectionScore: number;
    readonly corruption: number;
    readonly findings: number;
    readonly removals: number;
    readonly exposed: boolean;
    readonly timeline: readonly {
      readonly at: SimTime;
      readonly text: string;
    }[];
  };
};

export const tierIds = {
  emperor: "actor:emperor",
  wang: "actor:wang",
  sima: "actor:sima",
  governor: "actor:governor",
  magistrate: "actor:magistrate",
  inspector: "actor:inspector",
  provincial: "account:provincial",
  treasury: "account:treasury",
  governorAccount: "account:actor:governor",
  simaAccount: "account:actor:sima",
  magistrateAccount: "account:actor:magistrate",
  newLaw: "policy:new-law",
  chain: "chain:quota-cover-up",
  bribeCensor: "bribe:governor-censor",
  bribeMagistrate: "bribe:censor-magistrate",
  order: "order:grain-quota",
} as const;

const ids = tierIds;

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

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  valence: number,
  kind: RelationshipEdge["kind"],
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

export function createTierInitialState(): TierState {
  const actors: Record<string, TierActor> = {
    [ids.emperor]: {
      id: ids.emperor,
      name: "The Emperor",
      tier: 1,
      office: "office:sovereign",
      influence: 0.4,
      ideology: 0,
      motivations: profile({ loyaltyToState: 0.9 }),
    },
    [ids.wang]: {
      id: ids.wang,
      name: "Wang",
      tier: 2,
      office: "office:chancellery",
      influence: 1,
      ideology: 0.9,
      motivations: profile({ ideologicalCommitment: 0.95 }),
    },
    [ids.sima]: {
      id: ids.sima,
      name: "Sima",
      tier: 2,
      office: "office:censorate",
      influence: 1,
      ideology: -0.8,
      motivations: profile({
        wealth: 0.9,
        proceduralLegality: 0.2,
        riskTolerance: 0.7,
      }),
    },
    [ids.governor]: {
      id: ids.governor,
      name: "Governor",
      tier: 3,
      office: "office:province",
      influence: 1,
      ideology: 0.2,
      motivations: profile({
        wealth: 0.9,
        proceduralLegality: 0.2,
        riskTolerance: 0.7,
      }),
    },
    [ids.magistrate]: {
      id: ids.magistrate,
      name: "Magistrate",
      tier: 3,
      office: "office:county",
      influence: 0.8,
      ideology: 0.1,
      motivations: profile({
        wealth: 0.95,
        proceduralLegality: 0.05,
        riskTolerance: 0.8,
      }),
    },
    [ids.inspector]: {
      id: ids.inspector,
      name: "Inspector",
      tier: 2,
      office: "office:inspection",
      influence: 1,
      ideology: -0.2,
      motivations: profile({ proceduralLegality: 0.95 }),
    },
  };

  let fiscal = createAccount(emptyFiscalState, {
    id: ids.treasury,
    ownerId: "organization:court",
    kind: "money",
    balance: 0,
  });
  fiscal = createAccount(fiscal, {
    id: ids.provincial,
    ownerId: "organization:province",
    kind: "money",
    balance: 0,
  });
  for (const actor of [ids.governor, ids.sima, ids.magistrate]) {
    fiscal = createAccount(fiscal, {
      id: `account:${actor}`,
      ownerId: actor,
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

  const relationships: Record<string, RelationshipEdge> = {
    "relationship:emperor-chancellor": edge(
      "relationship:emperor-chancellor",
      ids.emperor,
      ids.wang,
      0.5,
      "formal_command",
    ),
    "relationship:chancellor-governor": edge(
      "relationship:chancellor-governor",
      ids.wang,
      ids.governor,
      0.5,
      "formal_command",
    ),
    "relationship:governor-magistrate": edge(
      "relationship:governor-magistrate",
      ids.governor,
      ids.magistrate,
      0.6,
      "formal_command",
    ),
    "relationship:censor-protects-governor": edge(
      "relationship:censor-protects-governor",
      ids.sima,
      ids.governor,
      0.7,
      "informal_influence",
    ),
  };

  return {
    actors,
    relationships,
    fiscal,
    accountability: {
      ...emptyAccountabilityState,
      actors: {
        [ids.governor]: { id: ids.governor, influence: 1, loyaltyToRuler: 0.3 },
        [ids.sima]: { id: ids.sima, influence: 1, loyaltyToRuler: 0.3 },
        [ids.magistrate]: {
          id: ids.magistrate,
          influence: 0.8,
          loyaltyToRuler: 0.3,
        },
      },
      relationships,
    },
    bribery,
    policy: { id: ids.newLaw, direction: "reform" },
    ruleValue: "old_law",
    orders: [],
    exposed: false,
    timeline: [],
  };
}

export function deriveTierStance(state: TierState, actorId: string): number {
  const actor = requiredActor(state, actorId);
  const sign = state.policy.direction === "reform" ? 1 : -1;
  const weight = 0.5 + 0.5 * actor.motivations.ideologicalCommitment;
  return rounded(clamp(actor.ideology * sign * weight, -1, 1));
}

export function createTierModel(
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
): DomainModel<TierState> {
  return {
    async resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];
      for (const event of events) {
        switch (event.eventType) {
          case "court.petition":
            committed.push({
              eventType: "petition.recorded",
              actorId: ids.wang,
              causalEventId: event.id,
              payload: { policyId: ids.newLaw },
            });
            break;
          case "court.vote": {
            const { support, oppose } = tierTally(state);
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
          case "court.levy":
            committed.push({
              eventType: "resource.flowed",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                flowId: `flow:levy:${time}`,
                kind: "levy",
                toAccountId: ids.provincial,
                amount: Number(event.payload.amount),
                reason: "provincial quota",
              },
            });
            break;
          case "court.order":
            committed.push({
              eventType: "order.recorded",
              actorId: ids.wang,
              causalEventId: event.id,
              payload: {
                orderId: ids.order,
                fromId: ids.wang,
                toId: ids.governor,
                quota: Number(event.payload.quota),
              },
            });
            break;
          case "court.implement": {
            const fulfilled = Number(event.payload.fulfilled);
            const diverted = Number(event.payload.diverted);
            committed.push(
              {
                eventType: "resource.flowed",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: {
                  flowId: `flow:quota:${time}`,
                  kind: "transfer",
                  fromAccountId: ids.provincial,
                  toAccountId: ids.treasury,
                  amount: fulfilled,
                  reason: "quota delivered",
                },
              },
              {
                eventType: "resource.flowed",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: {
                  flowId: `flow:graft:${time}`,
                  kind: "graft",
                  fromAccountId: ids.provincial,
                  toAccountId: ids.governorAccount,
                  amount: diverted,
                  reason: "quota diverted",
                },
              },
              {
                eventType: "order.fulfilled",
                actorId: ids.governor,
                causalEventId: event.id,
                payload: { orderId: ids.order, fulfilled },
              },
            );
            break;
          }
          case "court.report":
            committed.push({
              eventType: "fiscal.returned",
              actorId: ids.governor,
              causalEventId: event.id,
              payload: {
                returnId: "return:province",
                authorId: ids.governor,
                subjectRef: ids.treasury,
                claimedBalance: Number(event.payload.claimed),
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
                instruction: "cover up the quota shortfall",
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
              committed.push(
                {
                  eventType: "resource.flowed",
                  actorId: fromId,
                  causalEventId: event.id,
                  payload: {
                    flowId: `flow:bribe:${bribeId}`,
                    kind: "transfer",
                    fromAccountId: `account:${fromId}`,
                    toAccountId: `account:${toId}`,
                    amount,
                    reason: "bribe payment",
                  },
                },
                {
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
                },
                {
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
                },
              );
            }
            break;
          }
          case "court.audit": {
            const covered = Object.values(state.bribery.bribes).some(
              (bribe) =>
                bribe.toId === ids.sima &&
                bribe.status === "accepted" &&
                bribe.targetRef === "audit:province",
            );
            committed.push({
              eventType: "audit.recorded",
              actorId: ids.inspector,
              causalEventId: event.id,
              payload: {
                returnId: "return:province",
                verifiedBalance: covered ? 100 : 60,
              },
            });
            break;
          }
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
                  subject: "participation in a quota cover-up chain",
                  claimRefs: ["return:province"],
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
            throw new Error(`Unknown tier-court event: ${event.eventType}`);
        }
      }
      return { events: committed, scheduled };
    },
    reduce: reduceTierState,
  };
}

export function reduceTierState(
  state: TierState,
  event: DomainEvent,
): TierState {
  const push = (text: string): TierState => ({
    ...state,
    timeline: [...state.timeline, { at: event.occurredAt, text }],
  });
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
  switch (event.eventType) {
    case "petition.recorded":
      return push("petition: new law");
    case "vote.recorded":
      return {
        ...push(
          `tally ${Number(event.payload.support)} vs ${Number(event.payload.oppose)}`,
        ),
        vote: {
          support: Number(event.payload.support),
          oppose: Number(event.payload.oppose),
        },
      };
    case "rule.endorsed":
      return { ...push("New Law endorsed"), ruleValue: "new_law" };
    case "rule.deferred":
      return push("New Law deferred");
    case "order.recorded":
      return {
        ...push("chancellor orders governor"),
        orders: [
          ...state.orders,
          {
            id: String(event.payload.orderId),
            fromId: String(event.payload.fromId),
            toId: String(event.payload.toId),
            quota: Number(event.payload.quota),
            fulfilled: 0,
          },
        ],
      };
    case "order.fulfilled": {
      const orderId = String(event.payload.orderId);
      return {
        ...push(`order fulfilled ${Number(event.payload.fulfilled)}`),
        orders: state.orders.map((order) =>
          order.id === orderId
            ? { ...order, fulfilled: Number(event.payload.fulfilled) }
            : order,
        ),
      };
    }
    case "chain.exposed":
      return { ...push("chain exposed"), exposed: true };
    default:
      throw new Error(
        `Unhandled tier-court event ${event.eventType} (${event.id})`,
      );
  }
}

export function tierView(state: TierState, time: SimTime): TierRun["view"] {
  const chain =
    Object.keys(state.bribery.bribes).length > 0
      ? deriveBriberyChain(state.bribery, ids.chain)
      : undefined;
  const tallyValue = state.vote ?? tierTally(state);
  return {
    ruleValue: state.ruleValue,
    support: tallyValue.support,
    oppose: tallyValue.oppose,
    treasuryTruth: deriveBalance(state.fiscal, ids.treasury),
    treasuryReported: deriveReportedBalance(state.fiscal, ids.treasury),
    treasuryVerified: deriveVerifiedBalance(state.fiscal, ids.treasury),
    chainHops: chain?.hops ?? 0,
    chainDepth: chain?.depth ?? 0,
    chainValue: chain?.totalValue ?? 0,
    patronageShare: derivePatronageShare(state.bribery, ids.governor),
    protectionScore: deriveProtectionScore(state.accountability, ids.governor),
    corruption: state.bribery.corruption.length,
    findings: Object.keys(state.accountability.findings).length,
    removals: state.accountability.removals.length,
    exposed: state.exposed,
    timeline: state.timeline,
  };
}

export async function runTierCourt(
  bribePolicy: BribeDecisionPolicy = new HeuristicBribePolicy(),
  runId = "three-tier-court-demo",
): Promise<TierRun> {
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createTierInitialState(),
    createTierModel(bribePolicy),
    store,
    runId,
  );
  const schedule: readonly ScheduledEventDraft[] = [
    {
      eventType: "court.petition",
      scheduledAt: simTime(0),
      actorId: ids.wang,
      payload: {},
    },
    {
      eventType: "court.vote",
      scheduledAt: simTime(5),
      actorId: ids.emperor,
      payload: {},
    },
    {
      eventType: "court.decide",
      scheduledAt: simTime(10),
      actorId: ids.emperor,
      payload: {},
    },
    {
      eventType: "court.order",
      scheduledAt: simTime(15),
      actorId: ids.wang,
      payload: { quota: 100 },
    },
    {
      eventType: "court.levy",
      scheduledAt: simTime(20),
      actorId: ids.governor,
      payload: { amount: 100 },
    },
    {
      eventType: "court.implement",
      scheduledAt: simTime(25),
      actorId: ids.governor,
      payload: { fulfilled: 60, diverted: 40 },
    },
    {
      eventType: "court.report",
      scheduledAt: simTime(30),
      actorId: ids.governor,
      payload: { claimed: 100 },
    },
    {
      eventType: "court.bribe",
      scheduledAt: simTime(35),
      actorId: ids.governor,
      payload: {
        bribeId: ids.bribeCensor,
        fromId: ids.governor,
        toId: ids.sima,
        amount: 40,
        targetRef: "audit:province",
      },
    },
    {
      eventType: "court.bribe",
      scheduledAt: simTime(40),
      actorId: ids.sima,
      payload: {
        bribeId: ids.bribeMagistrate,
        parentBribeId: ids.bribeCensor,
        fromId: ids.sima,
        toId: ids.magistrate,
        amount: 20,
        targetRef: "ledger:county",
      },
    },
    {
      eventType: "court.audit",
      scheduledAt: simTime(45),
      actorId: ids.inspector,
      payload: {},
    },
    {
      eventType: "court.investigate",
      scheduledAt: simTime(55),
      actorId: ids.inspector,
      payload: {},
    },
    {
      eventType: "court.prosecute",
      scheduledAt: simTime(65),
      actorId: ids.inspector,
      payload: {},
    },
  ];
  for (const draft of schedule) await kernel.schedule(draft);
  await kernel.runUntilIdle();
  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(createTierInitialState(), records, reduceTierState),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live tier-court state");
  }
  return {
    state: kernel.state,
    records,
    view: tierView(kernel.state, kernel.time),
  };
}

function tierTally(state: TierState): {
  readonly support: number;
  readonly oppose: number;
} {
  let support = 0;
  let oppose = 0;
  for (const actor of Object.values(state.actors)) {
    if (actor.id === ids.emperor) continue;
    const stance = deriveTierStance(state, actor.id);
    if (stance > 0) support += actor.influence * stance;
    else if (stance < 0) oppose += actor.influence * -stance;
  }
  return { support: rounded(support), oppose: rounded(oppose) };
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
function requiredActor(state: TierState, id: string): TierActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown tier actor: ${id}`);
  return actor;
}
function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
