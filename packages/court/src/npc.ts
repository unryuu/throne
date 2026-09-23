import { z } from "zod";
import type { JsonObject } from "@throne/shared-types";
import { formatCourtTime } from "./calendar.ts";
import { countyIds, ids } from "./jiajing.ts";
import {
  capabilitySpecs,
  countyFacts,
  edictDescriptions,
  edictKinds,
} from "./rules.ts";
import type { CourtState } from "./types.ts";

export type CourtModelRequest = {
  readonly decisionEpisodeId: string;
  readonly sessionKey: string;
  readonly systemPrompt: string;
  readonly prompt: string;
};
/** Returns the model's raw text; the court owns parsing and validation. */
export type CourtModel = (request: CourtModelRequest) => Promise<string>;

const edictSchema = z.object({
  kind: z.enum(edictKinds as [string, ...string[]]),
  params: z.record(z.string(), z.json()).default({}),
});

export const courtDecisionSchema = z.object({
  inner: z.string().min(1).max(1200),
  documents: z
    .array(
      z.object({
        kind: z.string(),
        to: z.string().optional(),
        subject: z.string().min(1).max(80),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(4)
    .default([]),
  actions: z
    .array(
      z.object({
        capabilityId: z.string().min(1),
        parameters: z.record(z.string(), z.json()).default({}),
        description: z.string().max(400).optional(),
      }),
    )
    .max(3)
    .default([]),
  drafts: z
    .array(
      z.object({
        memorialId: z.string(),
        edict: edictSchema,
        text: z.string().min(1).max(600),
      }),
    )
    .default([]),
});
export type CourtDecision = z.infer<typeof courtDecisionSchema>;

export function parseCourtDecision(response: string): CourtDecision {
  const trimmed = response.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first)
    throw new Error("Model returned no JSON decision object");
  return courtDecisionSchema.parse(JSON.parse(trimmed.slice(first, last + 1)));
}

export const episodeId = (state: CourtState, actorId: string): string =>
  `court:${actorId.replace("actor:", "")}:${
    state.decisions.filter((d) => d.actorId === actorId).length + 1
  }`;

/** Pending memorials the chief grand secretary has received but not drafted. */
export function pendingDrafts(state: CourtState) {
  return Object.values(state.documents).filter(
    (d) =>
      d.kind === "memorial" &&
      d.fromId !== ids.yanSong &&
      d.deliveredTo.includes(ids.yanSong) &&
      d.draft === undefined &&
      d.readyForRulerAt === undefined,
  );
}

export function buildNpcInput(
  state: CourtState,
  actorId: string,
  time: number,
  runId: string,
  language: string,
): JsonObject {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown actor ${actorId}`);
  const name = (id: string) => state.actors[id]?.name ?? id;
  const last = actor.lastDecisionAt ?? -1;
  const history = state.decisions.filter((d) => d.actorId === actorId);
  const received = Object.values(state.documents)
    .filter((d) => d.deliveredTo.includes(actorId) && d.fromId !== actorId)
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      from: name(d.fromId),
      to: d.toIds.map(name),
      subject: d.subject,
      text: d.text,
      arrivedAt: formatCourtTime(d.arrivals[actorId] ?? d.sentAt, language),
      new: (d.arrivals[actorId] ?? d.sentAt) > last,
      ...(d.draft && actorId === ids.yanSong
        ? { yourDraft: d.draft.text }
        : {}),
      ...(d.rescript?.text && actorId === ids.yanSong
        ? { vermilionRescript: d.rescript.text }
        : {}),
    }))
    .slice(-25);
  const observations = state.observations
    .filter((o) => o.actorId === actorId)
    .map((o) => ({
      at: formatCourtTime(o.at, language),
      kind: o.kind,
      new: o.at > last,
      ...o.payload,
    }))
    .slice(-30);
  const ownHistory = history.slice(-10).map((d) => {
    const output = d.output as CourtDecision;
    return {
      at: formatCourtTime(d.at, language),
      inner: output.inner,
      documents: d.documentIds.map((id) => {
        const doc = state.documents[id]!;
        return {
          kind: doc.kind,
          to: doc.toIds.map(name),
          subject: doc.subject,
          text: doc.text,
          reply: doc.rescript
            ? doc.rescript.disposition === "hold"
              ? "留中"
              : "已批复"
            : "尚无回音",
        };
      }),
      actions: d.actionIds.map((id) => {
        const action = state.actions[id]!;
        return {
          capabilityId: action.capabilityId,
          parameters: action.parameters,
          status: action.status,
          ...(action.outcome ? { outcome: action.outcome } : {}),
        };
      }),
    };
  });
  const governs = actor.capabilities.includes("relief_granary");
  const resources: JsonObject = {
    ...(governs ? { provincialGranary: state.granary } : {}),
    ...(actor.capabilities.includes("relief_military")
      ? { militaryGrain: state.militaryGrain }
      : {}),
    ...(actor.capabilities.includes("relief_merchant")
      ? { shenYishiGrain: state.merchantGrain }
      : {}),
  };
  return {
    runId,
    decisionEpisodeId: episodeId(state, actorId),
    actorId,
    now: formatCourtTime(time, language),
    self: {
      name: actor.name,
      office: actor.office,
      status: actor.active ? "在任" : "已被革职拿问，不能再调动任何人和物",
      ...actor.profile,
    },
    capabilities: actor.active
      ? actor.capabilities.map((id) => ({
          id,
          description: capabilitySpecs[id]!.description,
          parameters: capabilitySpecs[id]!.parameters,
        }))
      : [],
    documentKinds: actor.active ? actor.documentKinds : ["memorial", "letter"],
    contacts: Object.values(state.actors)
      .filter((a) => a.id !== actorId && a.id !== ids.ruler && a.name)
      .map((a) => ({ id: a.id, name: a.name, office: a.office })),
    resources,
    ...(governs
      ? {
          provinceReports: countyIds.map((id) => countyFacts(state, id)),
          policyKnownToYou: policyKnownTo(state, actorId),
        }
      : { policyKnownToYou: policyKnownTo(state, actorId) }),
    documentsReceived: received,
    observations,
    ownHistory,
    ...(actorId === ids.yanSong
      ? {
          memorialsAwaitingYourDraft: pendingDrafts(state).map((d) => ({
            memorialId: d.id,
            from: name(d.fromId),
            subject: d.subject,
            text: d.text,
          })),
          edictOptions: edictKinds.map((kind) => ({
            kind,
            description: edictDescriptions[kind],
          })),
        }
      : {}),
  };
}

function policyKnownTo(state: CourtState, actorId: string): string {
  const edict = Object.values(state.documents).find(
    (d) =>
      d.kind === "edict" &&
      d.deliveredTo.includes(actorId) &&
      (d.edict?.kind === "approve_policy" ||
        (d.edict?.kind === "reject" && d.replyToId === ids.policyMemorial)),
  );
  if (edict)
    return edict.edict?.kind === "approve_policy"
      ? "圣旨已准改稻为桑：浙江今年改稻田五十万亩为桑"
      : "改稻为桑已被驳回";
  if (actorId === ids.yanSong && state.policy.status !== "proposed")
    return state.policy.status === "approved"
      ? "皇上已批红准行改稻为桑"
      : "皇上已驳回改稻为桑";
  return "朝廷尚未明发旨意";
}

export function systemPrompt(
  state: CourtState,
  actorId: string,
  language: string,
): string {
  const actor = state.actors[actorId]!;
  const english = language === "en";
  const lines = [
    `你在一个明代政治模拟中扮演${actor.name}（${actor.office}），不是玩家的助手。世界依照所有人物的实际行动发展，结局未定，不必照搬史书或戏剧。`,
    "你只知道提供给你的信息。奏报、书信和传闻只是别人的说法，未必是真相；不要假定你知道别人心里想什么、私下做了什么。",
    "你可以想一套、说一套、做一套：",
    "- inner：你此刻真实的想法，第一人称，不超过200字。只有你自己知道。",
    "- documents：你要发出的文书。memorial 是奏疏，经内阁票拟后呈皇帝；secret_memorial 是密奏，经司礼监直达御前；letter 是私信，须用 to 写明收信人 id。你只能用 documentKinds 里列出的文书种类。皇帝只看得到送到御前的文书，看不到你的内心和私信。",
    "- actions：你实际要去做的事，只能从 capabilities 中选，parameters 须符合说明。可以什么都不做。",
    "文书用半文半白的明代公文口吻，每份不超过300字。行动的结果要等世界给出，不要声称事情已经办成。",
  ];
  if (actorId === ids.yanSong)
    lines.push(
      "- drafts：对 memorialsAwaitingYourDraft 中的每份奏疏票拟：memorialId、edict（kind 取自 edictOptions，params 按说明）、text（替皇上拟的批语）。不票拟的奏疏会压在内阁，皇上看不到。",
    );
  if (!actor.active)
    lines.push("你已被革职拿问，不能再有任何 actions，但还可以写下文书。");
  lines.push(
    english
      ? "Write inner, subject and text in English, keeping JSON keys unchanged."
      : "用中文书写。",
    '仅返回一个 JSON 对象：{"inner":string,"documents":[{"kind":string,"to":string,"subject":string,"text":string}],"actions":[{"capabilityId":string,"parameters":{},"description":string}]' +
      (actorId === ids.yanSong
        ? ',"drafts":[{"memorialId":string,"edict":{"kind":string,"params":{}},"text":string}]}'
        : "}"),
  );
  return lines.join("\n");
}

export function decisionPrompt(input: JsonObject): string {
  return [
    "以下是你此刻所知的一切（JSON）。new 为 true 的是上次决定之后新到的内容。请作出这一次的决定。",
    JSON.stringify(input),
  ].join("\n\n");
}
