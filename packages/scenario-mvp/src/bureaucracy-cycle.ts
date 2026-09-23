import {
  addSimTime,
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
  type ScheduledEventDraft,
} from "@throne/sim-core";

export type BureauFaction = "reform" | "restore";

export type Bureaucrat = {
  readonly id: string;
  readonly name: string;
  readonly tier: 1 | 2 | 3;
  readonly faction: BureauFaction | null;
  readonly parentId?: string;
  readonly influence: number;
  readonly ideology: number;
  readonly motivations: MotivationProfile;
  readonly lobbyBias: number;
  readonly traitGraft: number;
  readonly traitFals: number;
  readonly caution: number;
  readonly quota: number;
  readonly delivered: number;
  readonly claimed: number;
  readonly grafted: number;
};

export type LobbyLogEntry = {
  readonly at: SimTime;
  readonly round: number;
  readonly fromId: string;
  readonly toId: string;
  readonly delta: number;
};

export type BureaucracyState = {
  readonly actors: Readonly<Record<string, Bureaucrat>>;
  readonly seed: string;
  readonly ruleValue: "new_law" | "old_law";
  readonly ruleStreak: number;
  readonly round: number;
  readonly exposedIds: readonly string[];
  readonly exposedRound: number;
  readonly shocks: readonly {
    readonly round: number;
    readonly kind: string;
  }[];
  readonly audits: readonly {
    readonly round: number;
    readonly exposedIds: readonly string[];
  }[];
  readonly lobbyLog: readonly LobbyLogEntry[];
  readonly ledger: readonly {
    readonly round: number;
    readonly actual: number;
    readonly claimed: number;
  }[];
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type BureauView = {
  readonly round: number;
  readonly ruleValue: "new_law" | "old_law";
  readonly support: number;
  readonly oppose: number;
  readonly emperorReported: number;
  readonly emperorActual: number;
  readonly reformFalsification: number;
  readonly restoreFalsification: number;
  readonly reformGraft: number;
  readonly restoreGraft: number;
  readonly ministers: readonly {
    readonly id: string;
    readonly name: string;
    readonly faction: BureauFaction | null;
    readonly officers: number;
    readonly delivered: number;
    readonly claimed: number;
    readonly lobbied: number;
  }[];
  readonly timeline: readonly { readonly at: SimTime; readonly text: string }[];
};

export type BureaucracyRun = {
  readonly state: BureaucracyState;
  readonly records: readonly SimulationRecord[];
  readonly views: readonly BureauView[];
};

export const bureauIds = {
  emperor: "actor:emperor",
} as const;

const ministerDefs: readonly {
  readonly id: string;
  readonly name: string;
  readonly faction: BureauFaction;
  readonly ideology: number;
}[] = [
  { id: "actor:wang", name: "Wang", faction: "reform", ideology: 0.9 },
  { id: "actor:lv", name: "Lv", faction: "reform", ideology: 0.6 },
  { id: "actor:zhang", name: "Zhang", faction: "reform", ideology: 0.5 },
  { id: "actor:sima", name: "Sima", faction: "restore", ideology: -0.85 },
  { id: "actor:fan", name: "Fan", faction: "restore", ideology: -0.5 },
];

const OFFICERS_PER_MINISTER = 5;

function profile(start: Partial<MotivationProfile>): MotivationProfile {
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

export function createBureaucracyInitialState(
  seed = "bureaucracy-default",
): BureaucracyState {
  const actors: Record<string, Bureaucrat> = {
    [bureauIds.emperor]: {
      id: bureauIds.emperor,
      name: "The Emperor",
      tier: 1,
      faction: null,
      influence: 0.5,
      ideology: 0,
      motivations: profile({ loyaltyToState: 0.9 }),
      lobbyBias: 0,
      traitGraft: 0,
      traitFals: 0,
      caution: 0,
      quota: 0,
      delivered: 0,
      claimed: 0,
      grafted: 0,
    },
  };
  for (const minister of ministerDefs) {
    actors[minister.id] = {
      id: minister.id,
      name: minister.name,
      tier: 2,
      faction: minister.faction,
      influence: 1,
      ideology: minister.ideology,
      motivations: profile({ ideologicalCommitment: 0.8 }),
      lobbyBias: 0,
      traitGraft: hashUnit(minister.id, 1),
      traitFals: hashUnit(minister.id, 2),
      caution: 0,
      quota: 0,
      delivered: 0,
      claimed: 0,
      grafted: 0,
    };
    for (let i = 0; i < OFFICERS_PER_MINISTER; i += 1) {
      const id = `${minister.id}:officer${i + 1}`;
      const reform = minister.faction === "reform";
      actors[id] = {
        id,
        name: `${minister.name}##${i + 1}`,
        tier: 3,
        faction: minister.faction,
        parentId: minister.id,
        influence: 0.4,
        ideology: minister.ideology * (0.6 + 0.1 * i),
        motivations: profile({
          wealth: reform ? 0.4 : 0.85,
          ambition: reform ? 0.85 : 0.5,
          proceduralLegality: reform ? 0.35 : 0.25,
        }),
        lobbyBias: 0,
        traitGraft: hashUnit(id, 1),
        traitFals: hashUnit(id, 2),
        caution: 0,
        quota: 0,
        delivered: 0,
        claimed: 0,
        grafted: 0,
      };
    }
  }
  return {
    actors,
    seed,
    ruleValue: "old_law",
    round: 0,
    lobbyLog: [],
    ledger: [],
    exposedIds: [],
    exposedRound: -1,
    shocks: [],
    audits: [],
    ruleStreak: 0,
    timeline: [],
  };
}

function hashUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.round((((h >>> 0) % 2000) / 1000 - 1) * 1000) / 1000;
}

function randomUnit(seed: string, round: number, salt: number): number {
  let h = 2166136261 ^ salt;
  const key = `${seed}:${round}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function externalShock(
  seed: string,
  round: number,
): "purge" | "crisis" | "amnesty" | undefined {
  if (round === 0) return undefined;
  if (randomUnit(seed, round, 7) >= 0.07) return undefined;
  const roll = randomUnit(seed, round, 11);
  if (roll < 0.3) return "purge";
  if (roll < 0.7) return "crisis";
  return "amnesty";
}

export function deriveGraftRate(actor: Bureaucrat): number {
  const autonomy = actor.faction === "restore" ? 0.25 : 0.05;
  const base =
    actor.motivations.wealth * (1 - actor.motivations.proceduralLegality) +
    autonomy;
  return rounded(clamp(base * (1 + 0.35 * actor.traitGraft), 0, 0.75));
}

export function deriveFalsification(actor: Bureaucrat): number {
  const pressure = actor.faction === "reform" ? 0.4 : 0.1;
  const base =
    pressure * (1 - actor.motivations.proceduralLegality) +
    0.2 * actor.motivations.ambition;
  return rounded(clamp(base * (1 + 0.35 * actor.traitFals), 0, 0.9));
}

export type OffenceContext = {
  readonly detection: number;
  readonly pressure: number;
  readonly graftRate: number;
  readonly falsification: number;
};

export function offenceContext(
  state: BureaucracyState,
  actor: Bureaucrat,
  rulingFaction: BureauFaction,
): OffenceContext {
  const parent = actor.parentId
    ? requiredActor(state, actor.parentId)
    : undefined;
  const shield = parent ? parent.influence : 0.5;
  const auditRound = state.round % 2 === 1 ? 0.1 : 0;
  const detection = rounded(
    clamp(0.15 + 0.6 * actor.caution + auditRound - 0.05 * shield, 0, 1),
  );
  const pressure =
    actor.faction === rulingFaction
      ? rounded(0.15 + 0.02 * state.ruleStreak)
      : 0.05;
  const graftRate = rounded(
    clamp(
      deriveGraftRate(actor) * (1 - 0.7 * detection) +
        (actor.faction === "restore" ? 0.1 * pressure : 0),
      0,
      0.75,
    ),
  );
  const falsification = rounded(
    clamp(
      deriveFalsification(actor) * (1 - 0.7 * detection) +
        (actor.faction === "reform" ? 0.15 * pressure : 0),
      0,
      0.9,
    ),
  );
  return { detection, pressure, graftRate, falsification };
}

export function createBureaucracyModel(
  maxRounds: number,
  interval: number,
): DomainModel<BureaucracyState> {
  return {
    resolveBatch({ state, time }) {
      const committed: DomainEventDraft[] = [];
      const scheduled: ScheduledEventDraft[] = [];

      for (const minister of ministerDefs) {
        const ally = ministerDefs.find(
          (other) =>
            other.faction === minister.faction && other.id !== minister.id,
        );
        if (!ally) throw new Error(`No lobby ally for ${minister.id}`);
        committed.push({
          eventType: "minister.lobbied",
          actorId: minister.id,
          payload: {
            round: state.round,
            fromId: minister.id,
            toId: ally.id,
            delta: rounded(0.05 * Math.sign(minister.ideology)),
          },
        });
      }

      const tally = supportTally(state);
      committed.push({
        eventType:
          tally.support > tally.oppose ? "rule.endorsed" : "rule.reverted",
        actorId: bureauIds.emperor,
        payload: { support: tally.support, oppose: tally.oppose },
      });
      const nextRule: "new_law" | "old_law" =
        tally.support > tally.oppose ? "new_law" : "old_law";
      const rulingFaction: BureauFaction =
        nextRule === "new_law" ? "reform" : "restore";

      // 影响力：向执政方偏移，但带均值回归（不封顶、会来回）
      for (const minister of ministerDefs) {
        const actor = requiredActor(state, minister.id);
        const pull = minister.faction === rulingFaction ? 0.06 : -0.06;
        const reversion = 0.1 * (actor.influence - 1);
        committed.push({
          eventType: "influence.changed",
          actorId: minister.id,
          payload: {
            actorId: minister.id,
            delta: rounded(pull - reversion),
          },
        });
      }

      const quota = 4;
      let actual = 0;
      let claimed = 0;
      const offenders: { id: string; offence: number }[] = [];
      for (const actor of Object.values(state.actors)) {
        if (actor.tier !== 3) continue;
        const ctx = offenceContext(state, actor, rulingFaction);
        const delivered = rounded(quota * (1 - ctx.graftRate));
        const grafted = rounded(quota - delivered);
        const claimedValue = rounded(
          delivered + (quota - delivered) * ctx.falsification,
        );
        actual += delivered;
        claimed += claimedValue;
        offenders.push({
          id: actor.id,
          offence: rounded(grafted + (claimedValue - delivered)),
        });
        committed.push({
          eventType: "official.executed",
          actorId: actor.id,
          payload: { officialId: actor.id, quota, delivered, grafted },
        });
        committed.push({
          eventType: "official.reported",
          actorId: actor.id,
          payload: { officialId: actor.id, claimed: claimedValue },
        });
      }

      // 审计暴露：逢单轮开查，暴露本回合违规最重的 3 名（含其大臣）
      if (state.round % 2 === 1) {
        const top = [...offenders]
          .sort((a, b) => b.offence - a.offence)
          .slice(0, 3);
        const ids: string[] = [];
        for (const entry of top) {
          ids.push(entry.id);
          const parentId = state.actors[entry.id]?.parentId;
          if (parentId) ids.push(parentId);
        }
        committed.push({
          eventType: "audit.conducted",
          actorId: bureauIds.emperor,
          payload: { round: state.round, exposedIds: ids },
        });
      }

      // 随机外生冲击（按种子伪随机，可复现）：整肃 / 危机 / 大赦
      const shockKind = externalShock(state.seed, state.round);
      if (shockKind) {
        committed.push({
          eventType: "event.external",
          actorId: bureauIds.emperor,
          payload: { round: state.round, kind: shockKind },
        });
      }

      let streak = nextRule === state.ruleValue ? state.ruleStreak + 1 : 0;
      if (shockKind === "crisis") streak += 6;
      if (shockKind === "amnesty") streak = 0;

      committed.push({
        eventType: "round.settled",
        actorId: bureauIds.emperor,
        payload: {
          round: state.round,
          actual: rounded(actual),
          claimed: rounded(claimed),
          ruleValue: nextRule,
          ruleStreak: streak,
        },
      });

      if (state.round + 1 < maxRounds) {
        scheduled.push({
          eventType: "court.round",
          scheduledAt: addSimTime(time, interval),
          actorId: bureauIds.emperor,
          payload: {},
        });
      }
      return { events: committed, scheduled };
    },
    reduce: reduceBureaucracyState,
  };
}

export function reduceBureaucracyState(
  state: BureaucracyState,
  event: DomainEvent,
): BureaucracyState {
  switch (event.eventType) {
    case "minister.lobbied": {
      const toId = String(event.payload.toId);
      const target = requiredActor(state, toId);
      return {
        ...state,
        actors: {
          ...state.actors,
          [toId]: {
            ...target,
            lobbyBias: rounded(
              clamp(target.lobbyBias + Number(event.payload.delta), -0.8, 0.8),
            ),
          },
        },
        lobbyLog: [
          ...state.lobbyLog,
          {
            at: event.occurredAt,
            round: Number(event.payload.round),
            fromId: String(event.payload.fromId),
            toId,
            delta: Number(event.payload.delta),
          },
        ],
      };
    }
    case "rule.endorsed":
      return {
        ...state,
        ruleValue: "new_law",
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: "New Law endorsed" },
        ],
      };
    case "rule.reverted":
      return {
        ...state,
        ruleValue: "old_law",
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: "Old Law restored" },
        ],
      };
    case "rule.deferred":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: "policy deferred" },
        ],
      };
    case "influence.changed": {
      const id = String(event.payload.actorId);
      const actor = requiredActor(state, id);
      return {
        ...state,
        actors: {
          ...state.actors,
          [id]: {
            ...actor,
            influence: rounded(
              clamp(actor.influence + Number(event.payload.delta), 0.1, 2),
            ),
          },
        },
      };
    }
    case "audit.conducted": {
      const exposedIds = readIds(event.payload.exposedIds);
      const round = Number(event.payload.round);
      const actors: Record<string, Bureaucrat> = { ...state.actors };
      for (const id of exposedIds) {
        const actor = actors[id];
        if (!actor) continue;
        actors[id] = {
          ...actor,
          caution: rounded(clamp(actor.caution + 0.6, 0, 1)),
        };
      }
      return {
        ...state,
        actors,
        exposedIds,
        exposedRound: round,
        audits: [...state.audits, { round, exposedIds }],
        timeline: [
          ...state.timeline,
          {
            at: event.occurredAt,
            text: `audit exposed ${exposedIds.length} officials`,
          },
        ],
      };
    }
    case "official.executed": {
      const id = String(event.payload.officialId);
      const actor = requiredActor(state, id);
      return {
        ...state,
        actors: {
          ...state.actors,
          [id]: {
            ...actor,
            quota: Number(event.payload.quota),
            delivered: Number(event.payload.delivered),
            grafted: Number(event.payload.grafted),
          },
        },
      };
    }
    case "official.reported": {
      const id = String(event.payload.officialId);
      const actor = requiredActor(state, id);
      return {
        ...state,
        actors: {
          ...state.actors,
          [id]: { ...actor, claimed: Number(event.payload.claimed) },
        },
      };
    }
    case "event.external": {
      const kind = String(event.payload.kind);
      const round = Number(event.payload.round);
      const actors: Record<string, Bureaucrat> = { ...state.actors };
      let exposedIds = state.exposedIds;
      let exposedRound = state.exposedRound;
      if (kind === "purge") {
        const ruling: BureauFaction =
          state.ruleValue === "new_law" ? "reform" : "restore";
        for (const actor of Object.values(state.actors)) {
          if (actor.tier === 2 && actor.faction === ruling) {
            actors[actor.id] = {
              ...actor,
              influence: rounded(clamp(actor.influence - 0.3, 0.1, 2)),
            };
          } else if (actor.tier === 3 && actor.faction === ruling) {
            actors[actor.id] = {
              ...actor,
              caution: rounded(clamp(actor.caution + 0.7, 0, 1)),
            };
          }
        }
        exposedIds = Object.values(state.actors)
          .filter((a) => a.tier === 3 && a.faction === ruling)
          .map((a) => a.id);
        exposedRound = round;
      } else if (kind === "amnesty") {
        exposedIds = [];
        exposedRound = -1;
        for (const actor of Object.values(state.actors)) {
          actors[actor.id] = { ...actor, lobbyBias: 0, caution: 0 };
        }
      } else if (kind !== "crisis") {
        throw new Error(`Unknown external shock: ${kind}`);
      }
      return {
        ...state,
        actors,
        exposedIds,
        exposedRound,
        shocks: [...state.shocks, { round, kind }],
        timeline: [
          ...state.timeline,
          { at: event.occurredAt, text: `external shock: ${kind}` },
        ],
      };
    }
    case "round.settled": {
      const round = Number(event.payload.round);
      const streak = Number(event.payload.ruleStreak);
      const drift =
        (state.ruleValue === "new_law" ? -1 : 1) * (0.03 + 0.015 * streak);
      const actors: Record<string, Bureaucrat> = { ...state.actors };
      for (const minister of ministerDefs) {
        const actor = actors[minister.id];
        if (!actor) continue;
        actors[minister.id] = {
          ...actor,
          lobbyBias: rounded(clamp(actor.lobbyBias + drift, -0.8, 0.8)),
        };
      }
      for (const actor of Object.values(state.actors)) {
        if (actor.tier !== 3 || actor.caution === 0) continue;
        actors[actor.id] = {
          ...actor,
          caution: rounded(Math.max(0, actor.caution - 0.15)),
        };
      }
      return {
        ...state,
        actors,
        round: round + 1,
        ruleStreak: streak,
        ledger: [
          ...state.ledger,
          {
            round,
            actual: Number(event.payload.actual),
            claimed: Number(event.payload.claimed),
          },
        ],
        timeline: [
          ...state.timeline,
          {
            at: event.occurredAt,
            text: `round ${round}: actual ${Number(event.payload.actual)} / claimed ${Number(event.payload.claimed)}`,
          },
        ],
      };
    }
    default:
      throw new Error(
        `Unhandled bureaucracy event ${event.eventType} (${event.id})`,
      );
  }
}

export function bureaucracyView(
  state: BureaucracyState,
  time: SimTime,
): BureauView {
  const tally = supportTally(state);
  const officers = Object.values(state.actors).filter((a) => a.tier === 3);
  let emperorActual = 0;
  let emperorReported = 0;
  let reformFalsification = 0;
  let restoreFalsification = 0;
  let reformGraft = 0;
  let restoreGraft = 0;
  for (const officer of officers) {
    emperorActual += officer.delivered;
    emperorReported += officer.claimed;
    const falsified = officer.claimed - officer.delivered;
    if (officer.faction === "reform") {
      reformFalsification += falsified;
      reformGraft += officer.grafted;
    } else {
      restoreFalsification += falsified;
      restoreGraft += officer.grafted;
    }
  }
  const ministers = ministerDefs.map((minister) => {
    const children = Object.values(state.actors).filter(
      (a) => a.parentId === minister.id,
    );
    return {
      id: minister.id,
      name: minister.name,
      faction: minister.faction,
      officers: children.length,
      delivered: rounded(children.reduce((sum, c) => sum + c.delivered, 0)),
      claimed: rounded(children.reduce((sum, c) => sum + c.claimed, 0)),
      lobbied: state.lobbyLog.filter((entry) => entry.fromId === minister.id)
        .length,
    };
  });
  return {
    round: state.round,
    ruleValue: state.ruleValue,
    support: tally.support,
    oppose: tally.oppose,
    emperorReported: rounded(emperorReported),
    emperorActual: rounded(emperorActual),
    reformFalsification: rounded(reformFalsification),
    restoreFalsification: rounded(restoreFalsification),
    reformGraft: rounded(reformGraft),
    restoreGraft: rounded(restoreGraft),
    ministers,
    timeline: state.timeline,
  };
}

export async function runBureaucracyCycle(
  options: {
    runId?: string;
    rounds?: number;
    interval?: number;
    seed?: string;
  } = {},
): Promise<BureaucracyRun> {
  const runId = options.runId ?? "bureaucracy-cycle-demo";
  const rounds = options.rounds ?? 4;
  const interval = options.interval ?? 20;
  const seed = options.seed ?? "bureaucracy-default";
  const store = new InMemoryEventStore();
  const kernel = new SimulationKernel(
    createBureaucracyInitialState(seed),
    createBureaucracyModel(rounds, interval),
    store,
    runId,
  );
  await kernel.schedule({
    eventType: "court.round",
    scheduledAt: simTime(0),
    actorId: bureauIds.emperor,
    payload: {},
  });
  const views: BureauView[] = [];
  while (await kernel.step()) {
    views.push(bureaucracyView(kernel.state, kernel.time));
  }
  const records = await store.readAll();
  if (
    JSON.stringify(
      replay(
        createBureaucracyInitialState(seed),
        records,
        reduceBureaucracyState,
      ),
    ) !== JSON.stringify(kernel.state)
  ) {
    throw new Error("Replay differs from live bureaucracy state");
  }
  return { state: kernel.state, records, views };
}

function supportTally(state: BureaucracyState): {
  readonly support: number;
  readonly oppose: number;
} {
  let support = 0;
  let oppose = 0;
  for (const minister of ministerDefs) {
    const actor = requiredActor(state, minister.id);
    const effective = clamp(actor.ideology + actor.lobbyBias, -1, 1);
    if (effective > 0) support += actor.influence * effective;
    else if (effective < 0) oppose += actor.influence * -effective;
  }
  return { support: rounded(support), oppose: rounded(oppose) };
}

function requiredActor(state: BureaucracyState, id: string): Bureaucrat {
  const actor = state.actors[id];
  if (!actor) throw new Error(`Unknown bureaucrat: ${id}`);
  return actor;
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Exposed ids must be an array");
  return value.map(String);
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
