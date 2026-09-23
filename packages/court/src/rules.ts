import type { JsonObject, JsonValue } from "@throne/shared-types";
import { countyIds, ids } from "./jiajing.ts";
import type {
  CountyId,
  CourtActor,
  CourtState,
  Edict,
  EdictKind,
} from "./types.ts";

export type CapabilitySpec = {
  readonly id: string;
  readonly description: string;
  readonly parameters: string;
  readonly delayDays: number;
};

export const capabilitySpecs: Readonly<Record<string, CapabilitySpec>> = {
  buy_land: {
    id: "buy_land",
    description:
      "让沈一石出面收买某县稻田改种桑树。公道价百姓较愿卖但花钱多；压价则成交少、易激民怨。受灾淹没的田更容易买到。约五日见分晓。",
    parameters:
      '{"countyId":"chunan|jiande|tonglu","mu":收买万亩数(1-30),"price":"fair|low"}',
    delayDays: 5,
  },
  relief_granary: {
    id: "relief_granary",
    description: "开浙江官仓，运粮赈济某县灾民。约三日运到。",
    parameters:
      '{"countyId":"chunan|jiande|tonglu","amount":万石数(不超过官仓存粮)}',
    delayDays: 3,
  },
  relief_military: {
    id: "relief_military",
    description: "拨军粮赈济某县灾民。会削减前线军粮。约三日运到。",
    parameters:
      '{"countyId":"chunan|jiande|tonglu","amount":万石数(不超过军粮存量)}',
    delayDays: 3,
  },
  relief_merchant: {
    id: "relief_merchant",
    description:
      "让沈一石出粮赈济某县，条件是灾民把田卖给他改种桑树（以粮换田）。每万石粮约换一万亩田。约三日运到。",
    parameters:
      '{"countyId":"chunan|jiande|tonglu","amount":万石数(不超过沈一石存粮)}',
    delayDays: 3,
  },
  breach_dike: {
    id: "breach_dike",
    description:
      "暗中让河道差役在某县新安江大堤上动手脚，汛水一到必定决口。只能在汛期到来之前做。此事需严守秘密，但做过总会留下痕迹和知情人。",
    parameters: '{"countyId":"chunan|jiande|tonglu"}',
    delayDays: 1,
  },
  repair_dike: {
    id: "repair_dike",
    description:
      "征发民夫加固某县大堤，耗粮半万石，约十日完工。汛期前完工才有用。",
    parameters: '{"countyId":"chunan|jiande|tonglu"}',
    delayDays: 10,
  },
  suppress_unrest: {
    id: "suppress_unrest",
    description:
      "派按察司衙役到某县弹压闹事百姓、拿人。能压下民怨，但会伤人。约两日。",
    parameters: '{"countyId":"chunan|jiande|tonglu"}',
    delayDays: 2,
  },
  inspect_county: {
    id: "inspect_county",
    description:
      "亲自或派亲信去某县查勘实情：灾情、田亩、民情、大堤，可能查出隐情。约四日。",
    parameters: '{"countyId":"chunan|jiande|tonglu"}',
    delayDays: 4,
  },
};

export const edictKinds: readonly EdictKind[] = [
  "acknowledge",
  "reject",
  "approve_policy",
  "order_relief",
  "order_inquiry",
  "reprimand",
  "arrest",
];

export const edictDescriptions: Readonly<Record<EdictKind, string>> = {
  acknowledge: "知道了：只作批复，不另行交办。",
  reject: "驳回所请。若驳回改稻为桑的题本，此策作罢。",
  approve_policy: "准行改稻为桑（仅限尚未定议时）。旨意发往浙江。",
  order_relief:
    '令浙江巡抚赈济灾民，可指定县份：{"countyId":"chunan|jiande|tonglu"}（可省略）。',
  order_inquiry:
    '派人查勘某县：{"countyId":"chunan|jiande|tonglu","agent":"hu|jinyiwei"}，hu 为胡宗宪，jinyiwei 为锦衣卫。',
  reprimand: '申饬某人：{"actorId":人物 id}。',
  arrest:
    '革职拿问某人：{"actorId":人物 id}，限郑泌昌、胡宗宪、杨金水。郑泌昌被拿后由胡宗宪兼署浙江巡抚。',
};

export const arrestableIds = [ids.zheng, ids.hu, ids.yang] as const;
export const reprimandableIds = [
  ids.yanSong,
  ids.zheng,
  ids.hu,
  ids.yang,
] as const;

export function isCountyId(value: JsonValue | undefined): value is CountyId {
  return typeof value === "string" && countyIds.includes(value as CountyId);
}

const num = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const round1 = (value: number): number => Math.round(value * 10) / 10;
export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Math.round(value * 100) / 100));

/** Returns a reason when the edict cannot be issued; undefined when valid. */
export function edictProblem(
  state: CourtState,
  edict: Edict,
): string | undefined {
  if (!edictKinds.includes(edict.kind)) return "unknown edict";
  const p = edict.params;
  switch (edict.kind) {
    case "approve_policy":
      return state.policy.status === "proposed"
        ? undefined
        : "policy already decided";
    case "order_relief":
      return p.countyId === undefined || isCountyId(p.countyId)
        ? undefined
        : "unknown county";
    case "order_inquiry":
      if (!isCountyId(p.countyId)) return "unknown county";
      if (p.agent !== "hu" && p.agent !== "jinyiwei") return "unknown agent";
      if (p.agent === "hu" && !state.actors[ids.hu]?.active)
        return "Hu Zongxian is not in office";
      return undefined;
    case "reprimand":
    case "arrest": {
      const allowed: readonly string[] =
        edict.kind === "arrest" ? arrestableIds : reprimandableIds;
      if (typeof p.actorId !== "string" || !allowed.includes(p.actorId))
        return "invalid target";
      return state.actors[p.actorId]?.active
        ? undefined
        : "target not in office";
    }
    default:
      return undefined;
  }
}

/** Practical feasibility check for an NPC action at decision time. */
export function actionProblem(
  state: CourtState,
  actor: CourtActor,
  capabilityId: string,
  parameters: JsonObject,
  time: number,
): string | undefined {
  if (!actor.active) return "已被革职，无权调动";
  if (!actor.capabilities.includes(capabilityId))
    return "你没有办这件事的权力或门路";
  if (!isCountyId(parameters.countyId)) return "县名不对";
  const amount = num(parameters.amount);
  switch (capabilityId) {
    case "buy_land": {
      const mu = num(parameters.mu);
      if (mu === undefined || mu < 1 || mu > 30)
        return "收买亩数须在一至三十万亩";
      if (parameters.price !== "fair" && parameters.price !== "low")
        return "价格须为 fair 或 low";
      return undefined;
    }
    case "relief_granary":
    case "relief_military":
    case "relief_merchant": {
      const stock =
        capabilityId === "relief_granary"
          ? state.granary
          : capabilityId === "relief_military"
            ? state.militaryGrain
            : state.merchantGrain;
      if (amount === undefined || amount <= 0) return "粮数须为正数";
      if (stock <= 0) return "已无存粮可拨";
      return undefined;
    }
    case "breach_dike":
      return state.flood.strength === undefined && time < state.flood.at
        ? undefined
        : "汛期已过，动手已无用处";
    case "repair_dike":
      if (state.flood.strength !== undefined || time >= state.flood.at)
        return "汛期已过";
      return repairSource(state, actor) ? undefined : "无粮供给民夫";
    default:
      return undefined;
  }
}

export function repairSource(
  state: CourtState,
  actor: CourtActor,
): "granary" | "militaryGrain" | undefined {
  if (actor.capabilities.includes("relief_granary") && state.granary >= 0.5)
    return "granary";
  if (
    actor.capabilities.includes("relief_military") &&
    state.militaryGrain >= 0.5
  )
    return "militaryGrain";
  return undefined;
}

export function countyFacts(state: CourtState, countyId: CountyId): JsonObject {
  const c = state.counties[countyId];
  return {
    county: c.name,
    paddyMu: c.paddyMu,
    mulberryMu: c.mulberryMu,
    floodedMu: c.floodedMu,
    homeless: c.homeless,
    deaths: c.deaths,
    reliefStock: c.reliefStock,
    unrest: c.unrest,
    riots: c.riots,
    dikeBreached: c.breach !== undefined,
    unit: "田亩与灾民单位为万，死亡为人数，粮为万石，民怨0-1",
  };
}
