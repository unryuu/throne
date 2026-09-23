import {
  simTime,
  type DomainEvent,
  type JsonObject,
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

export type ReformDirection = "reform" | "restore";
export type RuleValue = "new_law" | "old_law";
export type ImperialBasis = "evidence" | "flat";

export type FactionReformActor = {
  readonly id: string;
  readonly name: string;
  readonly office: string;
  readonly ideology: number;
  readonly influence: number;
};

export type FactionReformPolicy = {
  readonly id: string;
  readonly title: string;
  readonly direction: ReformDirection;
  readonly authorId: string;
};

export type ImperialAct = {
  readonly kind: "endorse" | "defer" | "grant_office" | "revert";
  readonly favoredDirection: ReformDirection | null;
  readonly basis: ImperialBasis | null;
  readonly at: SimTime;
  readonly policyId?: string;
  readonly actorId?: string;
};

export type FactionReformState = {
  readonly actors: Readonly<Record<string, FactionReformActor>>;
  readonly policies: Readonly<Record<string, FactionReformPolicy>>;
  readonly ruleValue: RuleValue;
  readonly petitions: readonly string[];
  readonly audienceCount: number;
  readonly acts: readonly ImperialAct[];
};

export type ImperialAction =
  | {
      readonly kind: "endorse";
      readonly policyId: string;
      readonly basis: ImperialBasis;
    }
  | { readonly kind: "defer"; readonly policyId: string }
  | {
      readonly kind: "grant_office";
      readonly actorId: string;
      readonly officeId: string;
      readonly basis: ImperialBasis;
    }
  | { readonly kind: "revert"; readonly basis: ImperialBasis };

export type FactionReformTimelineItem = {
  readonly at: SimTime;
  readonly text: string;
};

export type FactionReformView = {
  readonly simulationTime: SimTime;
  readonly ruleValue: RuleValue;
  readonly factionSupport: {
    readonly reform: number;
    readonly restore: number;
  };
  readonly resistance: {
    readonly reform: number;
    readonly restore: number;
  };
  readonly policySupport: Readonly<Record<string, number>>;
  readonly lastAct: ImperialAct | null;
  readonly timeline: readonly FactionReformTimelineItem[];
};

export type ImperialDecisionInput = {
  readonly runId: string;
  readonly time: SimTime;
  readonly audienceIndex: number;
  readonly view: FactionReformView;
  readonly availableActions: readonly ImperialAction[];
};

export type ImperialPolicy = {
  decide(
    input: ImperialDecisionInput,
  ): Promise<ImperialAction> | ImperialAction;
};

export type FactionReformRun = {
  readonly initialState: FactionReformState;
  readonly afterFirstAudience: FactionReformView;
  readonly finalView: FactionReformView;
  readonly state: FactionReformState;
  readonly records: readonly SimulationRecord[];
};

export type FactionReformRunOptions = {
  readonly runId?: string;
  readonly policy?: ImperialPolicy;
};

export const factionReformIds = {
  ruler: "actor:emperor",
  wang: "actor:wang",
  lv: "actor:lv",
  sima: "actor:sima",
  fan: "actor:fan",
  newLaw: "policy:new-law",
  restoreLaw: "policy:restore-law",
  rule: "rule:levy-household-service",
  chancellery: "office:chancellery",
} as const;

const ids = factionReformIds;

export const factionReformInitialState: FactionReformState = {
  actors: {
    [ids.ruler]: {
      id: ids.ruler,
      name: "The Emperor",
      office: "office:sovereign",
      ideology: 0,
      influence: 0.3,
    },
    [ids.wang]: {
      id: ids.wang,
      name: "Wang",
      office: "office:chancellery",
      ideology: 0.9,
      influence: 1,
    },
    [ids.lv]: {
      id: ids.lv,
      name: "Lv",
      office: "office:finance",
      ideology: 0.6,
      influence: 1,
    },
    [ids.sima]: {
      id: ids.sima,
      name: "Sima",
      office: "office:censorate",
      ideology: -0.85,
      influence: 1,
    },
    [ids.fan]: {
      id: ids.fan,
      name: "Fan",
      office: "office:ministry",
      ideology: -0.5,
      influence: 1,
    },
  },
  policies: {
    [ids.newLaw]: {
      id: ids.newLaw,
      title: "New Law",
      direction: "reform",
      authorId: ids.wang,
    },
    [ids.restoreLaw]: {
      id: ids.restoreLaw,
      title: "Restore Old Law",
      direction: "restore",
      authorId: ids.sima,
    },
  },
  ruleValue: "old_law",
  petitions: [],
  audienceCount: 0,
  acts: [],
};

export const recordedImperialPolicy: ImperialPolicy = {
  decide({ audienceIndex }) {
    const actions: readonly ImperialAction[] = [
      { kind: "endorse", policyId: ids.newLaw, basis: "flat" },
      {
        kind: "grant_office",
        actorId: ids.sima,
        officeId: "office:chancellery",
        basis: "evidence",
      },
      { kind: "revert", basis: "evidence" },
    ];
    const action = actions[audienceIndex];
    if (!action) {
      throw new Error(
        `No recorded imperial action for audience ${audienceIndex}`,
      );
    }
    return action;
  },
};

export function createFactionReformModel(
  policy: ImperialPolicy,
  runId: string,
): DomainModel<FactionReformState> {
  return {
    async resolveBatch({ state, time, events }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];

      for (const event of events) {
        if (event.eventType === "petition.submitted") {
          const policyId = String(event.payload.policyId);
          requiredPolicy(state, policyId);
          committed.push({
            eventType: "petition.recorded",
            actorId: String(event.payload.authorId),
            causalEventId: event.id,
            payload: { policyId },
          });
        } else if (event.eventType === "court.audience") {
          const action = await policy.decide(imperialInput(state, time, runId));
          switch (action.kind) {
            case "endorse": {
              const endorsed = requiredPolicy(state, action.policyId);
              committed.push({
                eventType: "policy.endorsed",
                actorId: ids.ruler,
                causalEventId: event.id,
                payload: {
                  policyId: action.policyId,
                  basis: action.basis,
                  favoredDirection: endorsed.direction,
                  ruleValue:
                    endorsed.direction === "reform" ? "new_law" : "old_law",
                },
              });
              break;
            }
            case "defer": {
              requiredPolicy(state, action.policyId);
              committed.push({
                eventType: "policy.deferred",
                actorId: ids.ruler,
                causalEventId: event.id,
                payload: { policyId: action.policyId },
              });
              break;
            }
            case "grant_office": {
              const actor = requiredActor(state, action.actorId);
              committed.push({
                eventType: "office.granted",
                actorId: ids.ruler,
                causalEventId: event.id,
                payload: {
                  actorId: action.actorId,
                  officeId: action.officeId,
                  basis: action.basis,
                  favoredDirection: actorDirection(actor),
                },
              });
              break;
            }
            case "revert": {
              committed.push({
                eventType: "rule.reverted",
                actorId: ids.ruler,
                causalEventId: event.id,
                payload: { basis: action.basis },
              });
              break;
            }
          }
          committed.push({
            eventType: "audience.closed",
            actorId: ids.ruler,
            causalEventId: event.id,
            payload: {},
          });
        } else {
          throw new Error(`Unknown faction-reform event: ${event.eventType}`);
        }
      }

      return { events: committed, scheduled };
    },

    reduce: reduceFactionReformState,

    validate(_before, after) {
      if (after.ruleValue !== "new_law" && after.ruleValue !== "old_law") {
        throw new Error(`Invalid rule value: ${String(after.ruleValue)}`);
      }
      for (const actor of Object.values(after.actors)) {
        if (actor.influence < 0) {
          throw new Error(`${actor.id} has negative influence`);
        }
      }
      for (const act of after.acts) {
        if (act.policyId !== undefined) requiredPolicy(after, act.policyId);
        if (act.actorId !== undefined) requiredActor(after, act.actorId);
      }
    },
  };
}

export function reduceFactionReformState(
  state: FactionReformState,
  event: DomainEvent,
): FactionReformState {
  switch (event.eventType) {
    case "petition.recorded": {
      const policyId = String(event.payload.policyId);
      requiredPolicy(state, policyId);
      return { ...state, petitions: [...state.petitions, policyId] };
    }
    case "policy.endorsed": {
      const policyId = String(event.payload.policyId);
      requiredPolicy(state, policyId);
      return {
        ...state,
        ruleValue: ruleValueOf(event.payload.ruleValue),
        acts: [
          ...state.acts,
          imperialAct("endorse", {
            favoredDirection: directionValueOf(event.payload.favoredDirection),
            basis: basisOf(event.payload.basis),
            at: event.occurredAt,
            policyId,
          }),
        ],
      };
    }
    case "policy.deferred": {
      const policyId = String(event.payload.policyId);
      requiredPolicy(state, policyId);
      return {
        ...state,
        acts: [
          ...state.acts,
          imperialAct("defer", { at: event.occurredAt, policyId }),
        ],
      };
    }
    case "office.granted": {
      const actorId = String(event.payload.actorId);
      const actor = requiredActor(state, actorId);
      return {
        ...state,
        actors: {
          ...state.actors,
          [actorId]: {
            ...actor,
            office: String(event.payload.officeId),
            influence: rounded(actor.influence + 0.2),
          },
        },
        acts: [
          ...state.acts,
          imperialAct("grant_office", {
            favoredDirection: directionValueOf(event.payload.favoredDirection),
            basis: basisOf(event.payload.basis),
            at: event.occurredAt,
            actorId,
          }),
        ],
      };
    }
    case "rule.reverted":
      return {
        ...state,
        ruleValue: "old_law",
        acts: [
          ...state.acts,
          imperialAct("revert", {
            favoredDirection: "restore",
            basis: basisOf(event.payload.basis),
            at: event.occurredAt,
          }),
        ],
      };
    case "audience.closed":
      return { ...state, audienceCount: state.audienceCount + 1 };
    default:
      throw new Error(
        `Unhandled faction-reform event ${event.eventType} (${event.id})`,
      );
  }
}

export function factionReformView(
  state: FactionReformState,
  time: SimTime,
): FactionReformView {
  const policySupport: Record<string, number> = {};
  for (const policy of Object.values(state.policies)) {
    policySupport[policy.id] = policySupportOf(state, policy.id);
  }
  const lastAct = state.acts.at(-1) ?? null;
  return {
    simulationTime: time,
    ruleValue: state.ruleValue,
    factionSupport: factionSupportOf(state),
    resistance: resistanceOf(state),
    policySupport,
    lastAct,
    timeline: state.acts.map((act) => ({
      at: act.at,
      text: describeAct(act),
    })),
  };
}

export function deriveStance(
  state: FactionReformState,
  actorId: string,
  policyId: string,
): number {
  const actor = requiredActor(state, actorId);
  const policy = requiredPolicy(state, policyId);
  const sign = policy.direction === "reform" ? 1 : -1;
  const stance = actor.ideology * sign;
  return rounded(clamp(stance, -1, 1));
}

export function deriveFactionSupport(state: FactionReformState): {
  readonly reform: number;
  readonly restore: number;
} {
  return factionSupportOf(state);
}

export function deriveResistance(state: FactionReformState): {
  readonly reform: number;
  readonly restore: number;
} {
  return resistanceOf(state);
}

export async function runFactionReformScenario(
  options: FactionReformRunOptions = {},
): Promise<FactionReformRun> {
  const runId = options.runId ?? "faction-reform-demo";
  const policy = options.policy ?? recordedImperialPolicy;
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    factionReformInitialState,
    createFactionReformModel(policy, runId),
    store,
    runId,
  );

  await kernel.schedule({
    eventType: "petition.submitted",
    scheduledAt: simTime(0),
    actorId: ids.wang,
    payload: { policyId: ids.newLaw, authorId: ids.wang },
  });
  await kernel.schedule({
    eventType: "court.audience",
    scheduledAt: simTime(10),
    actorId: ids.ruler,
    payload: {},
  });
  await kernel.schedule({
    eventType: "petition.submitted",
    scheduledAt: simTime(30),
    actorId: ids.sima,
    payload: { policyId: ids.restoreLaw, authorId: ids.sima },
  });
  await kernel.schedule({
    eventType: "court.audience",
    scheduledAt: simTime(40),
    actorId: ids.ruler,
    payload: {},
  });
  await kernel.schedule({
    eventType: "court.audience",
    scheduledAt: simTime(60),
    actorId: ids.ruler,
    payload: {},
  });

  let afterFirstAudience: FactionReformView | undefined;
  while (await kernel.step()) {
    if (kernel.time === simTime(10) && !afterFirstAudience) {
      afterFirstAudience = factionReformView(kernel.state, kernel.time);
    }
  }
  if (!afterFirstAudience) {
    throw new Error("Faction reform scenario did not reach the first audience");
  }

  const records = await store.readAll();
  const replayed = replay(
    factionReformInitialState,
    records,
    reduceFactionReformState,
  );
  if (JSON.stringify(replayed) !== JSON.stringify(kernel.state)) {
    throw new Error("Replay differs from live faction-reform state");
  }

  return {
    initialState: factionReformInitialState,
    afterFirstAudience,
    finalView: factionReformView(kernel.state, kernel.time),
    state: kernel.state,
    records,
  };
}

function imperialInput(
  state: FactionReformState,
  time: SimTime,
  runId: string,
): ImperialDecisionInput {
  return {
    runId,
    time,
    audienceIndex: state.audienceCount,
    view: factionReformView(state, time),
    availableActions: availableActions(state),
  };
}

function availableActions(
  state: FactionReformState,
): readonly ImperialAction[] {
  const actions: ImperialAction[] = [];
  for (const policy of Object.values(state.policies)) {
    actions.push(
      { kind: "endorse", policyId: policy.id, basis: "evidence" },
      { kind: "endorse", policyId: policy.id, basis: "flat" },
      { kind: "defer", policyId: policy.id },
    );
  }
  for (const actor of Object.values(state.actors)) {
    if (actor.id === ids.ruler) continue;
    actions.push(
      {
        kind: "grant_office",
        actorId: actor.id,
        officeId: ids.chancellery,
        basis: "evidence",
      },
      {
        kind: "grant_office",
        actorId: actor.id,
        officeId: ids.chancellery,
        basis: "flat",
      },
    );
  }
  actions.push(
    { kind: "revert", basis: "evidence" },
    { kind: "revert", basis: "flat" },
  );
  return actions;
}

function factionSupportOf(state: FactionReformState): {
  readonly reform: number;
  readonly restore: number;
} {
  let reform = 0;
  let restore = 0;
  for (const actor of Object.values(state.actors)) {
    const weight = Math.abs(actor.ideology) * actor.influence;
    if (actor.ideology > 0) reform += weight;
    else if (actor.ideology < 0) restore += weight;
  }
  return { reform: rounded(reform), restore: rounded(restore) };
}

function resistanceOf(state: FactionReformState): {
  readonly reform: number;
  readonly restore: number;
} {
  const last = state.acts.at(-1);
  if (!last || last.basis === null || last.favoredDirection === null) {
    return { reform: 0, restore: 0 };
  }
  const multiplier = last.basis === "evidence" ? 0.6 : 1;
  const pressed = factionInfluenceOf(state, opposite(last.favoredDirection));
  const value = rounded(pressed * multiplier);
  return last.favoredDirection === "reform"
    ? { reform: 0, restore: value }
    : { reform: value, restore: 0 };
}

function factionInfluenceOf(
  state: FactionReformState,
  direction: ReformDirection,
): number {
  let total = 0;
  for (const actor of Object.values(state.actors)) {
    if (actorDirectionOrNull(actor) === direction) total += actor.influence;
  }
  return rounded(total);
}

function policySupportOf(state: FactionReformState, policyId: string): number {
  const policy = requiredPolicy(state, policyId);
  const sign = policy.direction === "reform" ? 1 : -1;
  let total = 0;
  for (const actor of Object.values(state.actors)) {
    total += actor.ideology * sign * actor.influence;
  }
  return rounded(total);
}

function imperialAct(
  kind: ImperialAct["kind"],
  fields: {
    readonly favoredDirection?: ReformDirection;
    readonly basis?: ImperialBasis;
    readonly at: SimTime;
    readonly policyId?: string;
    readonly actorId?: string;
  },
): ImperialAct {
  return {
    kind,
    favoredDirection: fields.favoredDirection ?? null,
    basis: fields.basis ?? null,
    at: fields.at,
    ...(fields.policyId === undefined ? {} : { policyId: fields.policyId }),
    ...(fields.actorId === undefined ? {} : { actorId: fields.actorId }),
  };
}

function describeAct(act: ImperialAct): string {
  const basis = act.basis === null ? "" : ` (${act.basis})`;
  switch (act.kind) {
    case "endorse":
      return `endorse ${act.policyId ?? "?"}${basis}`;
    case "defer":
      return `defer ${act.policyId ?? "?"}`;
    case "grant_office":
      return `grant office to ${act.actorId ?? "?"}${basis}`;
    case "revert":
      return `revert to old law${basis}`;
  }
}

function basisOf(value: unknown): ImperialBasis {
  if (value === "evidence" || value === "flat") return value;
  throw new Error(`Invalid imperial basis: ${String(value)}`);
}

function directionValueOf(value: unknown): ReformDirection {
  if (value === "reform" || value === "restore") return value;
  throw new Error(`Invalid reform direction: ${String(value)}`);
}

function ruleValueOf(value: unknown): RuleValue {
  if (value === "new_law" || value === "old_law") return value;
  throw new Error(`Invalid rule value: ${String(value)}`);
}

function actorDirectionOrNull(
  actor: FactionReformActor,
): ReformDirection | null {
  if (actor.ideology > 0) return "reform";
  if (actor.ideology < 0) return "restore";
  return null;
}

function actorDirection(actor: FactionReformActor): ReformDirection {
  const direction = actorDirectionOrNull(actor);
  if (!direction) {
    throw new Error(`Actor ${actor.id} has no ideological direction`);
  }
  return direction;
}

function opposite(direction: ReformDirection): ReformDirection {
  return direction === "reform" ? "restore" : "reform";
}

function requiredActor(
  state: FactionReformState,
  id: string,
): FactionReformActor {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown faction-reform actor: ${id}`);
  return actor;
}

function requiredPolicy(
  state: FactionReformState,
  id: string,
): FactionReformPolicy {
  const policy = state.policies[id];
  if (!policy) throw new Error(`Unknown faction-reform policy: ${id}`);
  return policy;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
