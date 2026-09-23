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

export type Faction = "reform" | "restore";
export type CycleBasis = "evidence" | "flat";
export type CycleActKind =
  "endorse" | "revert" | "defer" | "imposed" | "countermanded";

export type CycleActor = {
  readonly id: string;
  readonly name: string;
  readonly tier: number;
  readonly faction: Faction | null;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
  readonly lobbyBias: number;
};

export type CycleAct = {
  readonly at: SimTime;
  readonly session: number;
  readonly kind: CycleActKind;
  readonly favoredDirection: Faction | null;
  readonly basis: CycleBasis | null;
};

export type CycleState = {
  readonly actors: Readonly<Record<string, CycleActor>>;
  readonly relationships: Readonly<Record<string, RelationshipEdge>>;
  readonly ruleValue: "new_law" | "old_law";
  readonly ruleStreak: number;
  readonly acts: readonly CycleAct[];
  readonly sessions: number;
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type CycleView = {
  readonly session: number;
  readonly ruleValue: "new_law" | "old_law";
  readonly support: number;
  readonly oppose: number;
  readonly authority: number;
  readonly reformPower: number;
  readonly restorePower: number;
  readonly lastKind: CycleActKind | null;
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type CycleAction = {
  readonly kind: "endorse" | "revert" | "defer";
  readonly basis: CycleBasis | null;
};

export type CycleDecisionPolicy = {
  decide(view: CycleView): CycleAction;
};

export type PolicyCycleRunOptions = {
  readonly runId?: string;
  readonly policy?: CycleDecisionPolicy;
  readonly sessions?: number;
  readonly interval?: number;
};

export type PolicyCycleRun = {
  readonly state: CycleState;
  readonly records: readonly SimulationRecord[];
  readonly views: readonly CycleView[];
};

export const cycleIds = {
  emperor: "actor:emperor",
  wang: "actor:wang",
  lv: "actor:lv",
  zhang: "actor:zhang",
  sima: "actor:sima",
  fan: "actor:fan",
} as const;

const ids = cycleIds;

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

export const strongEmperorPolicy: CycleDecisionPolicy = {
  decide(view) {
    return {
      kind: view.support > view.oppose ? "endorse" : "revert",
      basis: "evidence",
    };
  },
};

export const weakEmperorPolicy: CycleDecisionPolicy = {
  decide() {
    return { kind: "defer", basis: null };
  },
};

export const cycleInitialState: CycleState = {
  actors: {
    [ids.emperor]: {
      id: ids.emperor,
      name: "The Emperor",
      tier: 1,
      faction: null,
      influence: 0.5,
      ideology: 0,
      motivations: profile({ loyaltyToState: 0.9 }),
      lobbyBias: 0,
    },
    [ids.wang]: {
      id: ids.wang,
      name: "Wang",
      tier: 2,
      faction: "reform",
      influence: 1,
      ideology: 0.9,
      motivations: profile({ ideologicalCommitment: 0.95 }),
      lobbyBias: 0,
    },
    [ids.lv]: {
      id: ids.lv,
      name: "Lv",
      tier: 2,
      faction: "reform",
      influence: 1,
      ideology: 0.6,
      motivations: profile({ ideologicalCommitment: 0.7 }),
      lobbyBias: 0,
    },
    [ids.zhang]: {
      id: ids.zhang,
      name: "Zhang",
      tier: 2,
      faction: "reform",
      influence: 1,
      ideology: 0.5,
      motivations: profile({ ideologicalCommitment: 0.6 }),
      lobbyBias: 0,
    },
    [ids.sima]: {
      id: ids.sima,
      name: "Sima",
      tier: 2,
      faction: "restore",
      influence: 1,
      ideology: -0.85,
      motivations: profile({ ideologicalCommitment: 0.9 }),
      lobbyBias: 0,
    },
    [ids.fan]: {
      id: ids.fan,
      name: "Fan",
      tier: 2,
      faction: "restore",
      influence: 1,
      ideology: -0.5,
      motivations: profile({ ideologicalCommitment: 0.6 }),
      lobbyBias: 0,
    },
  },
  relationships: {},
  ruleValue: "old_law",
  ruleStreak: 0,
  acts: [],
  sessions: 0,
  timeline: [],
};

export function deriveCycleStance(state: CycleState, actorId: string): number {
  const actor = requiredActor(state, actorId);
  const effective = clamp(actor.ideology + actor.lobbyBias, -1, 1);
  const weight = 0.5 + 0.5 * actor.motivations.ideologicalCommitment;
  return rounded(clamp(effective * weight, -1, 1));
}

export function deriveAuthority(state: CycleState): number {
  let evidence = 0;
  let flat = 0;
  let defer = 0;
  let countermanded = 0;
  let imposed = 0;
  for (const act of state.acts) {
    if (act.kind === "endorse" || act.kind === "revert") {
      if (act.basis === "evidence") evidence += 1;
      else flat += 1;
    } else if (act.kind === "defer") defer += 1;
    else if (act.kind === "countermanded") countermanded += 1;
    else if (act.kind === "imposed") imposed += 1;
  }
  return rounded(
    clamp(
      0.55 +
        0.06 * evidence -
        0.07 * flat -
        0.08 * defer -
        0.12 * countermanded -
        0.05 * imposed,
      0,
      1,
    ),
  );
}

export function deriveFactionPower(
  state: CycleState,
  faction: Faction,
): number {
  let factionInfluence = 0;
  let total = 0;
  for (const actor of Object.values(state.actors)) {
    if (actor.faction === null) continue;
    total += actor.influence;
    if (actor.faction === faction) factionInfluence += actor.influence;
  }
  if (total === 0) throw new Error("No factional actors to measure");
  return rounded(factionInfluence / total);
}

export function cycleView(state: CycleState, time: SimTime): CycleView {
  const tally = cycleTally(state);
  const last = state.acts.at(-1);
  return {
    session: state.sessions,
    ruleValue: state.ruleValue,
    support: tally.support,
    oppose: tally.oppose,
    authority: deriveAuthority(state),
    reformPower: deriveFactionPower(state, "reform"),
    restorePower: deriveFactionPower(state, "restore"),
    lastKind: last ? last.kind : null,
    timeline: state.timeline,
  };
}

export function createPolicyCycleModel(
  policy: CycleDecisionPolicy,
  maxSessions: number,
  interval: number,
): DomainModel<CycleState> {
  return {
    resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];
      for (const event of events) {
        if (event.eventType !== "court.session") {
          throw new Error(`Unknown policy-cycle event: ${event.eventType}`);
        }
        const view = cycleView(state, time);
        const action = policy.decide(view);
        const majority: Faction =
          view.support > view.oppose ? "reform" : "restore";
        const authority = view.authority;
        let kind: CycleActKind;
        let favored: Faction | null;
        let basis: CycleBasis | null = action.basis;
        let newRule = state.ruleValue;
        if (action.kind === "defer") {
          kind = "defer";
          favored = null;
          basis = null;
          if (deriveFactionPower(state, majority) > authority) {
            kind = "imposed";
            favored = majority;
            newRule = ruleFor(majority);
          }
        } else {
          const target: Faction =
            action.kind === "endorse" ? "reform" : "restore";
          const opposing = target === "reform" ? "restore" : "reform";
          if (authority >= deriveFactionPower(state, opposing)) {
            kind = action.kind;
            favored = target;
            newRule = ruleFor(target);
          } else {
            kind = "countermanded";
            favored = null;
          }
        }
        committed.push({
          eventType: "session.decided",
          actorId: ids.emperor,
          causalEventId: event.id,
          payload: {
            session: state.sessions,
            kind,
            favoredDirection: favored,
            basis,
            ruleValue: newRule,
          },
        });
        if (state.sessions + 1 < maxSessions) {
          scheduled.push({
            eventType: "court.session",
            scheduledAt: addSimTime(time, interval),
            actorId: ids.emperor,
            payload: {},
          });
        }
      }
      return { events: committed, scheduled };
    },
    reduce: reducePolicyCycleState,
  };
}

export function reducePolicyCycleState(
  state: CycleState,
  event: DomainEvent,
): CycleState {
  if (event.eventType !== "session.decided") {
    throw new Error(
      `Unhandled policy-cycle event ${event.eventType} (${event.id})`,
    );
  }
  const kind = actKind(event.payload.kind);
  const favored = favoredOf(event.payload.favoredDirection);
  const basis = basisOf(event.payload.basis);
  const newRule = ruleOf(event.payload.ruleValue);
  const sameRule = newRule === state.ruleValue;
  const ruleStreak = sameRule ? state.ruleStreak + 1 : 0;
  const drift = (newRule === "new_law" ? -1 : 1) * (0.04 + 0.02 * ruleStreak);
  const actors: Record<string, CycleActor> = { ...state.actors };
  for (const actor of Object.values(state.actors)) {
    if (actor.id === ids.emperor || actor.faction === null) continue;
    const delta = favored ? (actor.faction === favored ? 0.08 : -0.08) : 0;
    actors[actor.id] = {
      ...actor,
      influence: rounded(clamp(actor.influence + delta, 0.1, 2)),
      lobbyBias: rounded(clamp(actor.lobbyBias + drift, -0.8, 0.8)),
    };
  }
  const act: CycleAct = {
    at: event.occurredAt,
    session: Number(event.payload.session),
    kind,
    favoredDirection: favored,
    basis,
  };
  return {
    ...state,
    actors,
    ruleValue: newRule,
    ruleStreak,
    acts: [...state.acts, act],
    sessions: state.sessions + 1,
    timeline: [
      ...state.timeline,
      {
        at: event.occurredAt,
        text: `session ${state.sessions}: ${kind}${favored ? ` (${favored})` : ""}${basis ? ` [${basis}]` : ""} → ${newRule}`,
      },
    ],
  };
}

export async function runPolicyCycle(
  options: PolicyCycleRunOptions = {},
): Promise<PolicyCycleRun> {
  const runId = options.runId ?? "policy-cycle-demo";
  const policy = options.policy ?? strongEmperorPolicy;
  const maxSessions = options.sessions ?? 8;
  const interval = options.interval ?? 20;
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    cycleInitialState,
    createPolicyCycleModel(policy, maxSessions, interval),
    store,
    runId,
  );
  await kernel.schedule({
    eventType: "court.session",
    scheduledAt: simTime(0),
    actorId: ids.emperor,
    payload: {},
  });
  const views: CycleView[] = [];
  while (await kernel.step()) {
    views.push(cycleView(kernel.state, kernel.time));
  }
  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(cycleInitialState, records, reducePolicyCycleState),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live policy-cycle state");
  }
  return { state: kernel.state, records, views };
}

function cycleTally(state: CycleState): {
  readonly support: number;
  readonly oppose: number;
} {
  let support = 0;
  let oppose = 0;
  for (const actor of Object.values(state.actors)) {
    if (actor.faction === null) continue;
    const stance = deriveCycleStance(state, actor.id);
    if (stance > 0) support += actor.influence * stance;
    else if (stance < 0) oppose += actor.influence * -stance;
  }
  return { support: rounded(support), oppose: rounded(oppose) };
}

function ruleFor(faction: Faction): "new_law" | "old_law" {
  return faction === "reform" ? "new_law" : "old_law";
}

function actKind(value: unknown): CycleActKind {
  if (
    value === "endorse" ||
    value === "revert" ||
    value === "defer" ||
    value === "imposed" ||
    value === "countermanded"
  ) {
    return value;
  }
  throw new Error(`Invalid cycle act kind: ${String(value)}`);
}

function favoredOf(value: unknown): Faction | null {
  if (value === null || value === undefined) return null;
  if (value === "reform" || value === "restore") return value;
  throw new Error(`Invalid favored direction: ${String(value)}`);
}

function basisOf(value: unknown): CycleBasis | null {
  if (value === null || value === undefined) return null;
  if (value === "evidence" || value === "flat") return value;
  throw new Error(`Invalid imperial basis: ${String(value)}`);
}

function ruleOf(value: unknown): "new_law" | "old_law" {
  if (value === "new_law" || value === "old_law") return value;
  throw new Error(`Invalid rule value: ${String(value)}`);
}

function requiredActor(state: CycleState, id: string): CycleActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown cycle actor: ${id}`);
  return actor;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
