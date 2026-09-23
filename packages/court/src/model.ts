import type {
  DomainEvent,
  JsonObject,
  ScheduledEvent,
  SimTime,
} from "@throne/shared-types";
import { addSimTime, simTime } from "@throne/shared-types";
import type {
  DomainEventDraft,
  DomainModel,
  ScheduledEventDraft,
} from "@throne/sim-core";
import { CHEN, WU, days, nextShichen, roll } from "./calendar.ts";
import {
  countyIds,
  governorCapabilities,
  ids,
  travelDays,
  worldCheckInterval,
} from "./jiajing.ts";
import {
  buildNpcInput,
  decisionPrompt,
  episodeId,
  parseCourtDecision,
  pendingDrafts,
  systemPrompt,
  type CourtDecision,
  type CourtModel,
} from "./npc.ts";
import {
  actionProblem,
  capabilitySpecs,
  clamp01,
  countyFacts,
  edictProblem,
  isCountyId,
  repairSource,
  round1,
} from "./rules.ts";
import type {
  CountyId,
  County,
  CourtAction,
  CourtActor,
  CourtDecisionRecord,
  CourtDocument,
  CourtState,
  Draft,
  Edict,
  Evidence,
  LocationId,
  PrimitiveGap,
  Rescript,
} from "./types.ts";

export type RescriptItem = {
  readonly documentId: string;
  readonly disposition: Rescript["disposition"];
  readonly edict?: Edict;
  readonly text?: string;
};
export type SpecialEdict = { readonly edict: Edict; readonly text?: string };
export type RescriptSubmission = {
  readonly audienceId: string;
  readonly items: readonly RescriptItem[];
  readonly specials: readonly SpecialEdict[];
};

type Options = {
  readonly runId: string;
  readonly language: string;
  readonly model: CourtModel;
};

class Context {
  readonly committed: DomainEventDraft[] = [];
  readonly scheduled: ScheduledEventDraft[] = [];
  cause?: string;
  constructor(
    public state: CourtState,
    readonly time: SimTime,
  ) {}

  commit(eventType: string, payload: JsonObject, actorId?: string): void {
    const draft: DomainEventDraft = {
      eventType,
      payload,
      ...(actorId ? { actorId } : {}),
      ...(this.cause ? { causalEventId: this.cause } : {}),
    };
    this.committed.push(draft);
    this.state = reduceCourtState(this.state, {
      ...draft,
      id: "pending",
      occurredAt: this.time,
    });
  }

  later(eventType: string, at: number, payload: JsonObject): void {
    this.scheduled.push({
      eventType,
      scheduledAt: simTime(at),
      payload,
      ...(this.cause ? { causalEventId: this.cause } : {}),
    });
  }
}

const j = (value: unknown): JsonObject =>
  structuredClone(value) as unknown as JsonObject;

function observe(
  ctx: Context,
  actorId: string,
  kind: string,
  payload: JsonObject,
  wakeActor = true,
): void {
  ctx.commit("actor.observed", { observations: [{ actorId, kind, payload }] });
  if (wakeActor) wake(ctx, actorId);
}

function wake(ctx: Context, actorId: string): void {
  const actor = ctx.state.actors[actorId];
  if (!actor?.llm || actor.nextDecisionAt !== undefined) return;
  if (!actor.active && actor.finalDecisionDone) return;
  if (
    actor.active &&
    regularDecisionCount(ctx.state) >= ctx.state.decisionBudget
  ) {
    ctx.commit("npc.wake_capped", { actorId }, actorId);
    return;
  }
  let at: number = nextShichen(ctx.time, CHEN);
  if (actor.active && actor.lastDecisionAt !== undefined)
    at = Math.max(at, actor.lastDecisionAt + days(2));
  if (at > ctx.state.endsAt) return;
  ctx.commit("npc.woken", { actorId, at }, actorId);
  ctx.later("npc.decide", at, { actorId });
}

function regularDecisionCount(state: CourtState): number {
  const pending = Object.values(state.actors).filter(
    (a) => a.active && a.nextDecisionAt !== undefined,
  ).length;
  return state.decisions.filter((d) => !d.final).length + pending;
}

function ensureAudience(ctx: Context): void {
  const at = nextShichen(ctx.time, WU);
  const current = ctx.state.audienceScheduledAt;
  if (current !== undefined && current <= at) return;
  if (at > ctx.state.endsAt) return;
  ctx.commit("court.audience_scheduled", { at });
  ctx.later("court.audience_open", at, {});
}

function locationOf(state: CourtState, actorId: string): LocationId {
  return state.actors[actorId]?.location ?? "beijing";
}

function sendDocument(
  ctx: Context,
  document: Omit<CourtDocument, "arrivals" | "deliveredTo" | "sentAt">,
  fromLocation = locationOf(ctx.state, document.fromId),
): void {
  const arrivals: Record<string, SimTime> = {};
  for (const to of document.toIds) {
    const delay = travelDays(
      fromLocation,
      locationOf(ctx.state, to),
      document.kind,
    );
    arrivals[to] = addSimTime(ctx.time, Math.round(delay * 12));
  }
  ctx.commit("document.sent", {
    document: j({
      ...document,
      sentAt: ctx.time,
      arrivals,
      deliveredTo: [],
    }),
  });
  for (const [actorId, at] of Object.entries(arrivals))
    ctx.later("document.arrive", at, { documentId: document.id, actorId });
  if (document.toIds.includes(ids.ruler) && document.kind !== "report")
    ctx.later("document.silence_check", ctx.time + days(20), {
      documentId: document.id,
    });
}

const nextDocumentId = (state: CourtState, offset = 0) =>
  `doc-${Object.keys(state.documents).length + offset}`;

function governorId(state: CourtState): string {
  return state.actors[ids.zheng]?.active ? ids.zheng : ids.hu;
}

function defaultEdictText(edict: Edict, language: string): string {
  const en = language === "en";
  switch (edict.kind) {
    case "acknowledge":
      return en ? "Noted." : "知道了。";
    case "reject":
      return en ? "Request denied." : "所请不准。";
    case "approve_policy":
      return en ? "Approved." : "准。";
    case "order_relief":
      return en ? "Relieve the flood victims at once." : "着即赈济灾民。";
    case "order_inquiry":
      return en ? "Investigate and report truthfully." : "着即查勘，据实回奏。";
    case "reprimand":
      return en ? "You are reprimanded." : "着严加申饬。";
    case "arrest":
      return en
        ? "Dismissed and to be arrested for questioning."
        : "着革职拿问。";
  }
}

function edictRecipients(
  state: CourtState,
  edict: Edict,
  authorId?: string,
): string[] {
  const zhejiang = [ids.zheng, ids.hu, ids.yang].filter(
    (id) => state.actors[id]?.active,
  );
  const out: string[] = [];
  const add = (id: string | undefined) => {
    if (id && state.actors[id]?.llm && !out.includes(id)) out.push(id);
  };
  add(authorId);
  switch (edict.kind) {
    case "approve_policy":
      zhejiang.forEach(add);
      break;
    case "order_relief":
      add(governorId(state));
      add(ids.hu);
      break;
    case "order_inquiry":
      if (edict.params.agent === "hu") add(ids.hu);
      break;
    case "reprimand":
      add(edict.params.actorId as string);
      break;
    case "arrest":
      add(edict.params.actorId as string);
      zhejiang.forEach(add);
      break;
    default:
      break;
  }
  return out;
}

function issueEdict(
  ctx: Context,
  options: Options,
  edict: Edict,
  text: string,
  reply?: CourtDocument,
): string | undefined {
  const problem = edictProblem(ctx.state, edict);
  if (problem) throw new Error(`Edict cannot be issued: ${problem}`);
  if (edict.kind === "approve_policy")
    ctx.commit("policy.updated", {
      patch: { status: "approved", approvedAt: ctx.time },
    });
  if (edict.kind === "reject" && reply?.id === ids.policyMemorial)
    ctx.commit("policy.updated", { patch: { status: "rejected" } });
  const id = nextDocumentId(ctx.state);
  if (edict.kind === "order_inquiry" && edict.params.agent === "jinyiwei")
    ctx.later("jinyiwei.arrive", ctx.time + days(8), {
      inquiryId: id,
      countyId: edict.params.countyId as string,
    });
  const toIds = edictRecipients(ctx.state, edict, reply?.fromId);
  if (!toIds.length) return undefined;
  sendDocument(ctx, {
    id,
    kind: "edict",
    fromId: ids.ruler,
    toIds,
    subject: reply
      ? `${options.language === "en" ? "Rescript" : "朱批"}：${reply.subject}`
      : options.language === "en"
        ? "Imperial edict"
        : "上谕",
    text: text.trim() || defaultEdictText(edict, options.language),
    edict,
    ...(reply ? { replyToId: reply.id } : {}),
  });
  return id;
}

function handleRescript(
  ctx: Context,
  options: Options,
  submission: RescriptSubmission,
): void {
  const audience = ctx.state.audience;
  if (ctx.state.phase !== "audience" || audience?.id !== submission.audienceId)
    throw new Error("This audience is not open");
  const byId = new Map(submission.items.map((i) => [i.documentId, i]));
  for (const key of byId.keys())
    if (!audience.documentIds.includes(key))
      throw new Error("Rescript refers to a document not on the desk");
  const rescripts: { documentId: string; rescript: Rescript }[] = [];
  const pending: { doc: CourtDocument; edict: Edict; text: string }[] = [];
  for (const documentId of audience.documentIds) {
    const doc = ctx.state.documents[documentId]!;
    const item = byId.get(documentId) ?? { documentId, disposition: "hold" };
    if (item.disposition === "hold") {
      rescripts.push({
        documentId,
        rescript: { disposition: "hold", at: ctx.time },
      });
      continue;
    }
    const edict =
      item.disposition === "follow_draft" ? doc.draft?.edict : item.edict;
    if (!edict) throw new Error("No edict for this rescript");
    const text = (item.text ?? "").trim() || doc.draft?.text || "";
    pending.push({ doc, edict, text });
    rescripts.push({
      documentId,
      rescript: { disposition: item.disposition, edict, text, at: ctx.time },
    });
  }
  ctx.commit("court.rescripted", {
    audienceId: audience.id,
    rescripts: j(rescripts),
  });
  const periodic = nextShichen(ctx.time + days(10) - 1, WU);
  if (periodic < ctx.state.endsAt)
    ctx.later("court.audience_open", periodic, { periodic: true });
  for (const { doc, edict, text } of pending) {
    const edictId = issueEdict(ctx, options, edict, text, doc);
    if (edictId)
      ctx.commit("document.rescript_linked", {
        documentId: doc.id,
        edictDocumentId: edictId,
      });
  }
  for (const special of submission.specials)
    issueEdict(ctx, options, special.edict, special.text ?? "");
  const outer = rescripts.filter(
    (r) => ctx.state.documents[r.documentId]!.kind === "memorial",
  );
  if (outer.length) {
    const items = outer.map((r) => {
      const doc = ctx.state.documents[r.documentId]!;
      return {
        subject: doc.subject,
        from: ctx.state.actors[doc.fromId]?.name ?? doc.fromId,
        disposition: r.rescript.disposition,
        ...(r.rescript.text ? { vermilionText: r.rescript.text } : {}),
        ...(r.rescript.edict ? { edict: r.rescript.edict.kind } : {}),
      };
    });
    const surprising = outer.some(
      (r) =>
        r.rescript.disposition !== "follow_draft" ||
        ctx.state.documents[r.documentId]!.fromId === ids.yanSong,
    );
    observe(
      ctx,
      ids.yanSong,
      "rescripts_copied_to_cabinet",
      j({ items }),
      surprising,
    );
  }
}

function handleArrival(ctx: Context, documentId: string, actorId: string) {
  const doc = ctx.state.documents[documentId];
  if (!doc) throw new Error(`Unknown document ${documentId}`);
  if (actorId === ids.ruler) {
    if (doc.kind === "memorial" && doc.fromId !== ids.yanSong) {
      ctx.commit("document.delivered", { documentId, actorId: ids.yanSong });
      wake(ctx, ids.yanSong);
      return;
    }
    ctx.commit("document.delivered", { documentId, actorId });
    ctx.commit("document.ready", { documentId });
    ensureAudience(ctx);
    return;
  }
  ctx.commit("document.delivered", { documentId, actorId });
  if (
    doc.edict?.kind === "arrest" &&
    doc.edict.params.actorId === actorId &&
    ctx.state.actors[actorId]?.active
  ) {
    ctx.commit("actor.updated", {
      actorId,
      patch: {
        active: false,
        office: `原${ctx.state.actors[actorId]!.office}`,
      },
    });
    if (actorId === ids.zheng && ctx.state.actors[ids.hu]?.active) {
      const hu = ctx.state.actors[ids.hu]!;
      ctx.commit("actor.updated", {
        actorId: ids.hu,
        patch: {
          office: "浙直总督兼署浙江巡抚",
          capabilities: [
            ...new Set([...hu.capabilities, ...governorCapabilities]),
          ],
        },
      });
    }
  }
  wake(ctx, actorId);
}

function resolveAction(ctx: Context, actionId: string): void {
  const state = ctx.state;
  const action = state.actions[actionId];
  if (!action || action.status !== "started")
    throw new Error(`Action ${actionId} is not in progress`);
  const countyId = action.parameters.countyId as CountyId;
  const county = state.counties[countyId];
  const patchCounty = (patch: Partial<County>) =>
    ctx.commit("county.updated", { countyId, patch: j(patch) });
  const finish = (status: "succeeded" | "failed", outcome: JsonObject) => {
    ctx.commit("action.resolved", { actionId, status, outcome });
    observe(ctx, action.actorId, "action_result", {
      capabilityId: action.capabilityId,
      county: county.name,
      status,
      ...outcome,
    });
  };
  const p = action.parameters;
  switch (action.capabilityId) {
    case "buy_land": {
      if (
        county.lastRiotAt !== undefined &&
        ctx.time - county.lastRiotAt < days(10)
      )
        return finish("failed", { reason: "县中民变未平，无人敢出面卖田" });
      const flooded = county.floodedMu > 0;
      const fair = p.price === "fair";
      const rate = flooded ? (fair ? 1 : 0.8) : fair ? 0.5 : 0.2;
      const available = flooded ? county.floodedMu : county.paddyMu;
      const sold = round1(Math.min(Number(p.mu), available) * rate);
      patchCounty({
        paddyMu: round1(county.paddyMu - sold),
        floodedMu: flooded ? round1(county.floodedMu - sold) : 0,
        mulberryMu: round1(county.mulberryMu + sold),
        annexedMu: round1(county.annexedMu + (fair ? 0 : sold)),
        unrest: clamp01(county.unrest + (fair ? 0 : flooded ? 0.1 : 0.25)),
      });
      ctx.commit("resources.updated", {
        patch: {
          merchantSilverSpent: round1(
            state.merchantSilverSpent + sold * (fair ? 3 : 1),
          ),
        },
      });
      return finish("succeeded", {
        requestedMu: Number(p.mu),
        soldMu: sold,
        price: p.price as string,
      });
    }
    case "relief_granary":
    case "relief_military":
    case "relief_merchant": {
      const key =
        action.capabilityId === "relief_granary"
          ? "granary"
          : action.capabilityId === "relief_military"
            ? "militaryGrain"
            : "merchantGrain";
      const amount = round1(Math.min(Number(p.amount), state[key]));
      if (amount <= 0) return finish("failed", { reason: "粮已拨尽" });
      ctx.commit("resources.updated", {
        patch: { [key]: round1(state[key] - amount) },
      });
      const merchant = key === "merchantGrain";
      const land = merchant ? round1(Math.min(amount, county.paddyMu)) : 0;
      patchCounty({
        reliefStock: round1(county.reliefStock + amount),
        ...(merchant
          ? {
              merchantGrainDelivered: round1(
                county.merchantGrainDelivered + amount,
              ),
            }
          : { reliefDelivered: round1(county.reliefDelivered + amount) }),
        paddyMu: round1(county.paddyMu - land),
        floodedMu: round1(Math.max(0, county.floodedMu - land)),
        mulberryMu: round1(county.mulberryMu + land),
        annexedMu: round1(county.annexedMu + land),
      });
      return finish("succeeded", {
        amount,
        ...(land ? { landTakenMu: land } : {}),
      });
    }
    case "breach_dike": {
      if (state.flood.strength !== undefined)
        return finish("failed", { reason: "汛水已过" });
      patchCounty({ dikeSabotaged: true });
      const evidence: Evidence = {
        id: `ev-${state.evidence.length}`,
        countyId,
        kind: "dike_breach",
        createdAt: ctx.time,
        createdBy: action.actorId,
        strength: 0.7,
        discoveredBy: [],
      };
      ctx.commit("evidence.created", { evidence: j(evidence) });
      return finish("succeeded", {
        note: "河道差役已按吩咐动了手脚，汛至必决",
      });
    }
    case "repair_dike": {
      const actor = state.actors[action.actorId]!;
      const source = repairSource(state, actor);
      if (state.flood.strength !== undefined)
        return finish("failed", { reason: "汛水先到，未及完工" });
      if (!source)
        return finish("failed", { reason: "无粮供给民夫，工程停了" });
      ctx.commit("resources.updated", {
        patch: { [source]: round1(state[source] - 0.5) },
      });
      patchCounty({
        dikeIntegrity: Math.min(
          0.95,
          Math.round((county.dikeIntegrity + 0.15) * 100) / 100,
        ),
        dikeSabotaged: false,
      });
      return finish("succeeded", { note: "大堤加固完工" });
    }
    case "suppress_unrest":
      patchCounty({
        unrest: clamp01(county.unrest - 0.3),
        deaths: county.deaths + 50,
      });
      return finish("succeeded", { note: "拿了为首的，打伤打死数十人" });
    case "inspect_county": {
      const found: string[] = [];
      for (const evidence of state.evidence) {
        if (
          evidence.countyId !== countyId ||
          evidence.discoveredBy.includes(action.actorId) ||
          roll(state.seed, `${action.id}:${evidence.id}`) >= evidence.strength
        )
          continue;
        ctx.commit("evidence.discovered", {
          evidenceId: evidence.id,
          actorId: action.actorId,
        });
        found.push("河工私下供称：大堤是按察司的差役趁夜掘开的，并非天灾。");
      }
      return finish("succeeded", {
        findings: countyFacts(ctx.state, countyId),
        testimony: found,
      });
    }
    default:
      throw new Error(`Unhandled capability ${action.capabilityId}`);
  }
}

function handleFlood(ctx: Context): void {
  const strength =
    Math.round((0.5 + 0.4 * roll(ctx.state.seed, "flood")) * 100) / 100;
  ctx.commit("flood.occurred", { strength });
  const breached: string[] = [];
  for (const id of countyIds) {
    const c = ctx.state.counties[id];
    const breach = c.dikeSabotaged
      ? "sabotage"
      : strength > c.dikeIntegrity
        ? "flood"
        : undefined;
    if (!breach) continue;
    breached.push(c.name);
    const homeless = round1(c.population * 0.4);
    ctx.commit("county.updated", {
      countyId: id,
      patch: {
        breach,
        floodedMu: round1(c.paddyMu * 0.7),
        inundatedMu: round1(c.paddyMu * 0.7),
        homeless,
        deaths: c.deaths + Math.round(homeless * 10000 * 0.02),
        unrest: clamp01(c.unrest + 0.2),
      },
    });
  }
  const news = breached.length
    ? `端午大汛，新安江水涨，${breached.join("、")}大堤决口，田舍被淹。`
    : "端午大汛，新安江水涨，沿江大堤俱未决口。";
  for (const actorId of [ids.zheng, ids.hu, ids.yang])
    observe(ctx, actorId, actorId === ids.zheng ? "flood" : "news", {
      content: news,
    });
}

function handleWorldCheck(ctx: Context): void {
  for (const id of countyIds) {
    const c = ctx.state.counties[id];
    let unrest = c.unrest;
    let deathsAdded = 0;
    let used = 0;
    if (c.homeless > 0) {
      const need = round1(c.homeless * 0.1);
      used = round1(Math.min(c.reliefStock, need));
      const coverage = need > 0 ? used / need : 1;
      deathsAdded = Math.round(c.homeless * 10000 * 0.015 * (1 - coverage));
      unrest += 0.2 * (1 - coverage) - 0.05 * coverage;
    } else unrest -= 0.03;
    unrest = clamp01(unrest);
    const riot =
      unrest >= 0.6 &&
      (c.lastRiotAt === undefined || ctx.time - c.lastRiotAt >= days(10));
    ctx.commit("county.updated", {
      countyId: id,
      patch: {
        reliefStock: round1(c.reliefStock - used),
        deaths: c.deaths + deathsAdded + (riot ? 150 : 0),
        unrest: riot ? clamp01(unrest - 0.25) : unrest,
        ...(riot ? { riots: c.riots + 1, lastRiotAt: ctx.time } : {}),
      },
    });
    if (riot)
      for (const actorId of [ids.zheng, ids.hu, ids.yang])
        observe(ctx, actorId, actorId === ids.zheng ? "riot" : "rumor", {
          content: `${c.name}饥民聚众闹事，冲了县衙。`,
        });
    else if (deathsAdded > 0)
      observe(ctx, governorId(ctx.state), "famine", {
        content: `${c.name}县报：赈粮不继，五日内饿死约${deathsAdded}人。`,
      });
  }
  if (ctx.time + worldCheckInterval < ctx.state.endsAt)
    ctx.later("world.check", ctx.time + worldCheckInterval, {});
}

function jinyiweiReport(
  state: CourtState,
  countyId: CountyId,
  testimony: boolean,
  language: string,
): string {
  const c = state.counties[countyId];
  const level = c.unrest >= 0.5 ? "汹汹" : c.unrest >= 0.3 ? "不安" : "尚安";
  if (language === "en")
    return [
      `We inspected ${c.name} as ordered.`,
      c.breach
        ? `The dike has breached: about ${c.inundatedMu} (10k mu) went under water, ${c.homeless} (10k) homeless, ${c.deaths} dead.`
        : "The dike is intact.",
      `Official relief delivered so far: ${c.reliefDelivered} (10k shi).`,
      c.merchantGrainDelivered
        ? `Merchants gave ${c.merchantGrainDelivered} (10k shi) of grain in exchange for land.`
        : "",
      `Mulberry converted: ${c.mulberryMu} (10k mu), of which ${c.annexedMu} bought cheaply by merchants.`,
      `Popular mood: ${level}.`,
      testimony
        ? "River workers testify the dike was dug open at night by provincial judicial runners; it was no natural disaster."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  return [
    `臣等奉旨查勘${c.name}。`,
    c.breach
      ? `新安江大堤决口，受淹田约${c.inundatedMu}万亩，灾民约${c.homeless}万口，已死${c.deaths}人。`
      : "大堤无恙。",
    `官府累计放赈${c.reliefDelivered}万石`,
    c.merchantGrainDelivered
      ? `；沈一石以粮换田，出粮${c.merchantGrainDelivered}万石`
      : "",
    `。已改桑田${c.mulberryMu}万亩，其中低价归入沈一石名下者${c.annexedMu}万亩。`,
    `民情${level}。`,
    testimony ? "另据河工供称，大堤系按察司差役趁夜掘开，非天灾所致。" : "",
    "谨奏。",
  ].join("");
}

function summarize(state: CourtState): JsonObject {
  const counties = countyIds.map((id) => state.counties[id]);
  const sum = (f: (c: County) => number) =>
    round1(counties.reduce((t, c) => t + f(c), 0));
  return {
    policy: state.policy.status,
    targetMu: state.policy.targetMu,
    convertedMu: sum((c) => c.mulberryMu),
    annexedMu: sum((c) => c.annexedMu),
    deaths: counties.reduce((t, c) => t + c.deaths, 0),
    riots: counties.reduce((t, c) => t + c.riots, 0),
    flooded: counties
      .filter((c) => c.breach)
      .map((c) => ({ county: c.name, cause: c.breach! })),
    evidence: state.evidence.map((e) => ({
      county: state.counties[e.countyId].name,
      by: state.actors[e.createdBy]?.name ?? e.createdBy,
      discoveredBy: e.discoveredBy.map((id) => state.actors[id]?.name ?? id),
    })),
    arrested: Object.values(state.actors)
      .filter((a) => a.llm && !a.active)
      .map((a) => a.name),
    granaryLeft: state.granary,
    militaryGrainLeft: state.militaryGrain,
    merchantGrainLeft: state.merchantGrain,
    merchantSilverSpent: state.merchantSilverSpent,
    decisions: state.decisions.length,
    cappedWakes: state.counters.cappedWakes ?? 0,
    gaps: state.gaps.length,
  };
}

async function handleDecisions(
  ctx: Context,
  options: Options,
  events: readonly ScheduledEvent[],
): Promise<void> {
  const requests: { actorId: string; input: JsonObject; cause: string }[] = [];
  for (const event of events) {
    const actorId = String(event.payload.actorId);
    const actor = ctx.state.actors[actorId];
    ctx.cause = event.id;
    if (
      !actor?.llm ||
      ctx.state.phase === "complete" ||
      (!actor.active && actor.finalDecisionDone)
    ) {
      ctx.commit("npc.decision_skipped", { actorId }, actorId);
      continue;
    }
    requests.push({
      actorId,
      cause: event.id,
      input: buildNpcInput(
        ctx.state,
        actorId,
        ctx.time,
        options.runId,
        options.language,
      ),
    });
  }
  const settled = await Promise.allSettled(
    requests.map(async ({ actorId, input }) =>
      parseCourtDecision(
        await options.model({
          decisionEpisodeId: String(input.decisionEpisodeId),
          sessionKey: `${options.runId}:${actorId}`,
          systemPrompt: systemPrompt(ctx.state, actorId, options.language),
          prompt: decisionPrompt(input),
        }),
      ),
    ),
  );
  const failure = settled.find((s) => s.status === "rejected");
  if (failure) throw (failure as PromiseRejectedResult).reason;
  requests.forEach((request, index) => {
    ctx.cause = request.cause;
    applyDecision(
      ctx,
      request.actorId,
      request.input,
      (settled[index] as PromiseFulfilledResult<CourtDecision>).value,
    );
  });
}

function applyDecision(
  ctx: Context,
  actorId: string,
  input: JsonObject,
  decision: CourtDecision,
): void {
  const actor = ctx.state.actors[actorId]!;
  const final = !actor.active;
  const rejected: JsonObject[] = [];
  const documents: Omit<
    CourtDocument,
    "arrivals" | "deliveredTo" | "sentAt"
  >[] = [];
  const allowedKinds = final ? ["memorial", "letter"] : actor.documentKinds;
  const findActor = (to: string | undefined) =>
    Object.values(ctx.state.actors).find(
      (a) => a.id === to || (to !== undefined && a.name === to),
    );
  const decisionEpisodeId = String(input.decisionEpisodeId);
  for (const [index, d] of decision.documents.entries()) {
    if (index >= 4) {
      rejected.push({
        type: "document",
        subject: d.subject ?? d.text.slice(0, 16),
        reason: "一次最多发四份文书",
      });
      continue;
    }
    const kind = d.kind as CourtDocument["kind"];
    if (!allowedKinds.includes(kind)) {
      rejected.push({
        type: "document",
        subject: d.subject ?? d.text.slice(0, 16),
        reason: "你没有这种文书渠道",
      });
      continue;
    }
    const recipients =
      kind === "letter"
        ? [
            ...new Set(
              (Array.isArray(d.to) ? d.to : [d.to])
                .map((to) => findActor(to))
                .filter(
                  (a): a is CourtActor =>
                    a !== undefined && a.id !== actorId && a.id !== ids.ruler,
                )
                .map((a) => a.id),
            ),
          ]
        : [ids.ruler];
    const subject = d.subject?.trim() || d.text.slice(0, 16);
    if (!recipients.length) {
      rejected.push({ type: "document", subject, reason: "收信人不明" });
      continue;
    }
    documents.push({
      id: nextDocumentId(ctx.state, documents.length),
      kind,
      fromId: actorId,
      toIds: recipients,
      subject,
      text: d.text,
      decisionEpisodeId,
    });
  }
  const actions: CourtAction[] = [];
  const gaps: PrimitiveGap[] = [];
  for (const [index, a] of decision.actions.entries()) {
    const parameters = j(a.parameters);
    if (index >= 3) {
      rejected.push({
        type: "action",
        capabilityId: a.capabilityId,
        reason: "一次最多做三件事",
      });
      continue;
    }
    if (!(a.capabilityId in capabilitySpecs)) {
      gaps.push({
        id: `gap-${ctx.state.gaps.length + gaps.length}`,
        actorId,
        at: ctx.time,
        capabilityId: a.capabilityId,
        parameters,
        ...(a.description ? { description: a.description } : {}),
      });
      continue;
    }
    const problem = actionProblem(
      ctx.state,
      actor,
      a.capabilityId,
      parameters,
      ctx.time,
    );
    const spec = capabilitySpecs[a.capabilityId]!;
    actions.push({
      id: `act-${Object.keys(ctx.state.actions).length + actions.length}`,
      actorId,
      capabilityId: a.capabilityId,
      parameters,
      ...(a.description ? { description: a.description } : {}),
      status: problem ? "impossible" : "started",
      startedAt: ctx.time,
      ...(problem
        ? { outcome: { reason: problem } }
        : { resolveAt: addSimTime(ctx.time, days(spec.delayDays)) }),
      decisionEpisodeId,
    });
  }
  const drafts: { documentId: string; draft: Draft }[] = [];
  if (actorId === ids.yanSong && !final) {
    const pending = new Set(pendingDrafts(ctx.state).map((d) => d.id));
    for (const d of decision.drafts) {
      const edict = { kind: d.edict.kind, params: j(d.edict.params) } as Edict;
      const problem = pending.has(d.memorialId)
        ? edictProblem(ctx.state, edict)
        : "no such pending memorial";
      if (problem) {
        rejected.push({
          type: "draft",
          memorialId: d.memorialId,
          reason: problem,
        });
        continue;
      }
      pending.delete(d.memorialId);
      drafts.push({
        documentId: d.memorialId,
        draft: {
          edict,
          text: d.text,
          draftedAt: ctx.time,
          decisionEpisodeId,
        },
      });
    }
  }
  const record: CourtDecisionRecord = {
    decisionEpisodeId,
    actorId,
    at: ctx.time,
    final,
    input,
    output: j(decision),
    documentIds: documents.map((d) => d.id),
    actionIds: actions.map((a) => a.id),
    rejected,
  };
  if (decisionEpisodeId !== episodeId(ctx.state, actorId))
    throw new Error("Decision episode does not match actor history");
  ctx.commit("npc.decided", { record: j(record), gaps: j(gaps) }, actorId);
  for (const document of documents) sendDocument(ctx, document);
  for (const action of actions) {
    ctx.commit("action.started", { action: j(action) }, actorId);
    if (action.resolveAt !== undefined)
      ctx.later("action.resolve", action.resolveAt, { actionId: action.id });
  }
  for (const { documentId, draft } of drafts) {
    ctx.commit("document.drafted", { documentId, draft: j(draft) });
    ctx.commit("document.ready", { documentId });
    ensureAudience(ctx);
  }
}

export function createCourtModel(options: Options): DomainModel<CourtState> {
  return {
    async resolveBatch({ state, time, events }) {
      const ctx = new Context(state, time);
      const decisions = events.filter((e) => e.eventType === "npc.decide");
      for (const event of events) {
        if (event.eventType === "npc.decide") continue;
        ctx.cause = event.id;
        const p = event.payload;
        if (ctx.state.phase === "complete") break;
        switch (event.eventType) {
          case "court.audience_open": {
            const documentIds = Object.values(ctx.state.documents)
              .filter(
                (d) =>
                  d.readyForRulerAt !== undefined &&
                  d.onDeskAt === undefined &&
                  d.rescript === undefined,
              )
              .map((d) => d.id);
            const idle =
              p.periodic === true &&
              time - (ctx.state.lastAudienceAt ?? 0) >= days(10);
            if (
              ctx.state.phase !== "running" ||
              (!documentIds.length && !idle)
            ) {
              if (p.periodic !== true) ctx.commit("court.audience_skipped", {});
              break;
            }
            ctx.commit("court.audience_opened", {
              audience: {
                id: `audience-${ctx.state.audienceCount + 1}`,
                openedAt: time,
                documentIds,
              },
            });
            break;
          }
          case "court.rescript":
            handleRescript(
              ctx,
              options,
              p.submission as unknown as RescriptSubmission,
            );
            break;
          case "document.arrive":
            handleArrival(ctx, String(p.documentId), String(p.actorId));
            break;
          case "document.silence_check": {
            const doc = ctx.state.documents[String(p.documentId)];
            if (!doc) throw new Error("Unknown document");
            if (doc.rescript && doc.rescript.disposition !== "hold") break;
            ctx.commit("document.silence_noticed", { documentId: doc.id });
            observe(ctx, doc.fromId, "no_reply", {
              content: `所上《${doc.subject}》至今未见批复。`,
            });
            break;
          }
          case "action.resolve":
            resolveAction(ctx, String(p.actionId));
            break;
          case "world.flood":
            handleFlood(ctx);
            break;
          case "world.check":
            handleWorldCheck(ctx);
            break;
          case "jinyiwei.arrive":
            for (const actorId of [ids.zheng, ids.yang])
              observe(ctx, actorId, "rumor", {
                content: `锦衣卫缇骑奉旨抵杭，往${ctx.state.counties[p.countyId as CountyId].name}查勘。`,
              });
            ctx.later("jinyiwei.inspect", time + days(2), p);
            break;
          case "jinyiwei.inspect": {
            const countyId = p.countyId as CountyId;
            if (!isCountyId(countyId)) throw new Error("Unknown county");
            let testimony = false;
            for (const evidence of ctx.state.evidence) {
              if (
                evidence.countyId !== countyId ||
                roll(ctx.state.seed, `${p.inquiryId}:${evidence.id}`) >=
                  evidence.strength
              )
                continue;
              testimony = true;
              if (!evidence.discoveredBy.includes(ids.jinyiwei))
                ctx.commit("evidence.discovered", {
                  evidenceId: evidence.id,
                  actorId: ids.jinyiwei,
                });
            }
            sendDocument(
              ctx,
              {
                id: nextDocumentId(ctx.state),
                kind: "report",
                fromId: ids.jinyiwei,
                toIds: [ids.ruler],
                subject:
                  options.language === "en"
                    ? `Embroidered Guard report on ${ctx.state.counties[countyId].name}`
                    : `锦衣卫查勘${ctx.state.counties[countyId].name}回奏`,
                text: jinyiweiReport(
                  ctx.state,
                  countyId,
                  testimony,
                  options.language,
                ),
              },
              "hangzhou",
            );
            break;
          }
          case "world.end":
            ctx.commit("world.ended", { summary: summarize(ctx.state) });
            break;
          default:
            throw new Error(`Unknown court event: ${event.eventType}`);
        }
      }
      if (decisions.length && ctx.state.phase !== "complete")
        await handleDecisions(ctx, options, decisions);
      return { events: ctx.committed, scheduled: ctx.scheduled };
    },
    reduce: reduceCourtState,
    validate(_before, after) {
      for (const key of ["granary", "militaryGrain", "merchantGrain"] as const)
        if (after[key] < 0) throw new Error(`${key} cannot be negative`);
      for (const c of Object.values(after.counties))
        if (c.paddyMu < 0 || c.floodedMu < 0 || c.reliefStock < 0)
          throw new Error(`County ${c.id} has negative stock`);
    },
  };
}

function patchActor(
  state: CourtState,
  actorId: string,
  patch: Partial<CourtActor>,
): CourtState {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown actor ${actorId}`);
  return {
    ...state,
    actors: { ...state.actors, [actorId]: { ...actor, ...patch } },
  };
}

function patchDocument(
  state: CourtState,
  documentId: string,
  patch: Partial<CourtDocument>,
): CourtState {
  const doc = state.documents[documentId];
  if (!doc) throw new Error(`Unknown document ${documentId}`);
  return {
    ...state,
    documents: { ...state.documents, [documentId]: { ...doc, ...patch } },
  };
}

export function reduceCourtState(
  state: CourtState,
  event: DomainEvent,
): CourtState {
  const p = event.payload;
  const time = event.occurredAt;
  switch (event.eventType) {
    case "court.audience_scheduled":
      return { ...state, audienceScheduledAt: simTime(Number(p.at)) };
    case "court.audience_skipped": {
      const { audienceScheduledAt: _, ...rest } = state;
      return rest;
    }
    case "court.audience_opened": {
      const audience = p.audience as unknown as CourtState["audience"] & {};
      let next: CourtState = { ...state, phase: "audience", audience };
      delete (next as { audienceScheduledAt?: SimTime }).audienceScheduledAt;
      for (const id of audience.documentIds)
        next = patchDocument(next, id, { onDeskAt: time });
      return next;
    }
    case "court.rescripted": {
      let next: CourtState = {
        ...state,
        phase: "running",
        audienceCount: state.audienceCount + 1,
        lastAudienceAt: time,
      };
      delete (next as { audience?: unknown }).audience;
      for (const r of p.rescripts as unknown as {
        documentId: string;
        rescript: Rescript;
      }[])
        next = patchDocument(next, r.documentId, { rescript: r.rescript });
      return next;
    }
    case "document.rescript_linked": {
      const doc = state.documents[String(p.documentId)]!;
      return patchDocument(state, doc.id, {
        rescript: {
          ...doc.rescript!,
          edictDocumentId: String(p.edictDocumentId),
        },
      });
    }
    case "document.sent": {
      const doc = p.document as unknown as CourtDocument;
      if (state.documents[doc.id])
        throw new Error(`Duplicate document ${doc.id}`);
      return { ...state, documents: { ...state.documents, [doc.id]: doc } };
    }
    case "document.delivered": {
      const doc = state.documents[String(p.documentId)]!;
      const actorId = String(p.actorId);
      if (doc.deliveredTo.includes(actorId)) return state;
      return patchDocument(state, doc.id, {
        deliveredTo: [...doc.deliveredTo, actorId],
        arrivals: { ...doc.arrivals, [actorId]: time },
      });
    }
    case "document.ready":
      return patchDocument(state, String(p.documentId), {
        readyForRulerAt: time,
      });
    case "document.drafted":
      return patchDocument(state, String(p.documentId), {
        draft: p.draft as unknown as Draft,
      });
    case "document.silence_noticed":
      return patchDocument(state, String(p.documentId), {
        silenceNoticeAt: time,
      });
    case "npc.woken":
      return patchActor(state, String(p.actorId), {
        nextDecisionAt: simTime(Number(p.at)),
      });
    case "npc.wake_capped":
      return {
        ...state,
        counters: {
          ...state.counters,
          cappedWakes: (state.counters.cappedWakes ?? 0) + 1,
        },
      };
    case "npc.decision_skipped": {
      const actor = state.actors[String(p.actorId)]!;
      const { nextDecisionAt: _, ...rest } = actor;
      return { ...state, actors: { ...state.actors, [actor.id]: rest } };
    }
    case "npc.decided": {
      const record = p.record as unknown as CourtDecisionRecord;
      const actor = state.actors[record.actorId]!;
      const { nextDecisionAt: _, ...rest } = actor;
      return {
        ...state,
        actors: {
          ...state.actors,
          [actor.id]: {
            ...rest,
            lastDecisionAt: time,
            ...(record.final ? { finalDecisionDone: true } : {}),
          },
        },
        decisions: [...state.decisions, record],
        gaps: [...state.gaps, ...(p.gaps as unknown as PrimitiveGap[])],
      };
    }
    case "action.started": {
      const action = p.action as unknown as CourtAction;
      return { ...state, actions: { ...state.actions, [action.id]: action } };
    }
    case "action.resolved": {
      const action = state.actions[String(p.actionId)]!;
      return {
        ...state,
        actions: {
          ...state.actions,
          [action.id]: {
            ...action,
            status: p.status as CourtAction["status"],
            resolvedAt: time,
            outcome: p.outcome as JsonObject,
          },
        },
      };
    }
    case "county.updated": {
      const id = p.countyId as CountyId;
      return {
        ...state,
        counties: {
          ...state.counties,
          [id]: { ...state.counties[id], ...(p.patch as Partial<County>) },
        },
      };
    }
    case "resources.updated":
      return { ...state, ...(p.patch as Partial<CourtState>) };
    case "policy.updated":
      return {
        ...state,
        policy: {
          ...state.policy,
          ...(p.patch as Partial<CourtState["policy"]>),
        },
      };
    case "actor.updated":
      return patchActor(
        state,
        String(p.actorId),
        p.patch as Partial<CourtActor>,
      );
    case "actor.observed": {
      let n = state.counters.obs ?? 0;
      const added = (
        p.observations as unknown as {
          actorId: string;
          kind: string;
          payload: JsonObject;
        }[]
      ).map((o) => ({ id: `obs-${n++}`, at: time, ...o }));
      return {
        ...state,
        observations: [...state.observations, ...added],
        counters: { ...state.counters, obs: n },
      };
    }
    case "evidence.created":
      return {
        ...state,
        evidence: [...state.evidence, p.evidence as unknown as Evidence],
      };
    case "evidence.discovered":
      return {
        ...state,
        evidence: state.evidence.map((e) =>
          e.id === p.evidenceId
            ? { ...e, discoveredBy: [...e.discoveredBy, String(p.actorId)] }
            : e,
        ),
      };
    case "flood.occurred":
      return {
        ...state,
        flood: { ...state.flood, strength: Number(p.strength) },
      };
    case "world.ended":
      return { ...state, phase: "complete", summary: p.summary as JsonObject };
    default:
      throw new Error(`Unhandled court event: ${event.eventType}`);
  }
}
