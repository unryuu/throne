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
  /** Throws when a well-formed reply still fails this decision's obligations. */
  readonly check?: (decision: CourtDecision) => void;
};
/** Returns the model's raw text; the court owns parsing and validation. */
export type CourtModel = (request: CourtModelRequest) => Promise<string>;

const edictSchema = z.object({
  kind: z.string(),
  params: z.record(z.string(), z.json()).default({}),
});

export const courtDecisionSchema = z.object({
  inner: z.string().min(1).max(1200),
  documents: z
    .array(
      z.object({
        kind: z.string(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
        subject: z.string().max(80).optional(),
        text: z.string().min(1).max(2000),
      }),
    )
    .default([]),
  actions: z
    .array(
      z.object({
        capabilityId: z.string().min(1),
        parameters: z.record(z.string(), z.json()).default({}),
        description: z.string().max(400).optional(),
      }),
    )
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
  // Models fill every field of the reply template, so optional extras may come back null or empty.
  report: z.string().max(1500).nullish(),
  reply: z.string().max(1500).nullish(),
  dispositions: z
    .array(
      z.object({
        documentId: z.string(),
        action: z.string(),
        text: z.string().max(600).nullish(),
      }),
    )
    .default([]),
  routes: z
    .array(
      z.object({
        reportId: z.string(),
        channel: z.string(),
        note: z.string().max(400).nullish(),
        interrupt: z.boolean().nullish(),
      }),
    )
    .default([]),
  interrupt: z.object({ reason: z.string().max(300) }).nullish(),
});
export type CourtDecision = z.infer<typeof courtDecisionSchema>;

export function parseCourtDecision(response: string): CourtDecision {
  const trimmed = response.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first)
    throw new Error(
      `Model returned no JSON decision object (${trimmed.length} chars, ending “${trimmed.slice(-80)}”)`,
    );
  const parsed = courtDecisionSchema.safeParse(
    JSON.parse(trimmed.slice(first, last + 1)),
  );
  if (!parsed.success)
    throw new Error(
      `Model decision does not match the schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  return parsed.data;
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
      d.directorate === undefined &&
      d.readyForRulerAt === undefined,
  );
}

/** Papers with the Directorate that Lü Fang has not yet disposed of. */
export function directorateInbox(state: CourtState) {
  return Object.values(state.documents).filter(
    (d) => d.directorate !== undefined && d.directorate.action === undefined,
  );
}

/** Papers Lü Fang has held back; he may still present them later. */
export function directorateHeld(state: CourtState) {
  return Object.values(state.documents).filter(
    (d) => d.directorate?.action === "hold" && d.readyForRulerAt === undefined,
  );
}

/** Field reports on Lu Bing's desk that he has not yet routed. */
export function reportsAwaitingRoute(state: CourtState) {
  return Object.values(state.documents).filter(
    (d) =>
      d.kind === "report" &&
      d.deliveredTo.includes(ids.luBing) &&
      d.route === undefined,
  );
}

export const directorateActions: Readonly<Record<string, string>> = {
  present: "呈览：皇上看原文。",
  summarize: "口奏摘要：皇上先听你 text 里的概括，原文折起，皇上要看才会调阅。",
  hold: "留中：不呈上，上奏人不会得到批复。",
  proxy: "照票拟代批：以皇上名义照内阁票拟发出，仅限有票拟的外朝奏疏。",
  return:
    "发回内阁重拟：text 写你的批语。严嵩只知道是司礼监发回，不知是否圣意。",
};

export const routeChannels: Readonly<Record<string, string>> = {
  directorate: "交司礼监，由吕芳转呈。这是常规。",
  direct: "直接面圣。吕芳经手不了，但他会知道你单独见了皇上，不知所奏何事。",
};

function secludedNote(state: CourtState, language: string): string {
  return state.secludedUntil !== undefined
    ? `皇上正在闭关修玄，预定${formatCourtTime(state.secludedUntil, language)}出关`
    : "皇上每日午时理事";
}

/** Log entries kept per prompt; older ones drop in whole chunks so the cached prefix rarely moves. */
const logLimit = 150;
const logChunk = 50;

type LogEntry = {
  readonly key: string;
  readonly at: number;
  readonly order: number;
  readonly seq: number;
  readonly body: JsonObject;
};

const seqOf = (id: string) => Number(id.split("-").at(-1)) || 0;

/** The actor's own experience in time order. Entries never change once written. */
function experienceLog(
  state: CourtState,
  actorId: string,
  language: string,
): LogEntry[] {
  const name = (id: string) => state.actors[id]?.name ?? id;
  const when = (t: number) => formatCourtTime(t, language);
  const entries: LogEntry[] = [];
  for (const d of Object.values(state.documents)) {
    const arrived = d.arrivals[actorId];
    if (
      d.deliveredTo.includes(actorId) &&
      arrived !== undefined &&
      d.fromId !== actorId &&
      (d.toIds.includes(actorId) || actorId === ids.yanSong)
    )
      entries.push({
        key: `doc:${d.id}`,
        at: arrived,
        order: 0,
        seq: seqOf(d.id),
        body: {
          at: when(arrived),
          type: "received",
          documentId: d.id,
          kind: d.kind,
          from: name(d.fromId),
          to: d.toIds.map(name),
          subject: d.subject,
          text: d.text,
        },
      });
    // The Directorate writes out vermilion rescripts, but Guard dispatches go straight to Lu Bing.
    if (
      actorId === ids.lvFang &&
      d.kind === "edict" &&
      !(
        d.edict?.kind === "order_inquiry" && d.edict.params.agent === "jinyiwei"
      )
    )
      entries.push({
        key: `edict:${d.id}`,
        at: d.sentAt,
        order: 1,
        seq: seqOf(d.id),
        body: {
          at: when(d.sentAt),
          type: "edict_written",
          subject: d.subject,
          to: d.toIds.map(name),
          text: d.text,
          ...(d.replyToId &&
          state.documents[d.replyToId]?.rescript?.disposition === "proxy"
            ? { byDirectorate: true }
            : {}),
        },
      });
  }
  for (const o of state.observations)
    if (o.actorId === actorId)
      entries.push({
        key: `obs:${o.id}`,
        at: o.at,
        order: 2,
        seq: seqOf(o.id),
        body: { at: when(o.at), type: "observed", kind: o.kind, ...o.payload },
      });
  state.decisions.forEach((d, index) => {
    if (d.actorId !== actorId) return;
    const output = d.output as CourtDecision;
    const subject = (id: string) => state.documents[id]?.subject ?? id;
    const notDone = d.actionIds.flatMap((id) => {
      const a = state.actions[id]!;
      return a.status === "impossible"
        ? [{ capabilityId: a.capabilityId, reason: a.outcome?.reason ?? null }]
        : [];
    });
    entries.push({
      key: `decision:${d.decisionEpisodeId}`,
      at: d.at,
      order: 3,
      seq: index,
      body: {
        at: when(d.at),
        type: d.mode === "converse" ? "you_spoke_with_emperor" : "you_decided",
        inner: output.inner,
        ...(d.mode === "converse"
          ? {
              emperorSaid: d.input.emperorSays ?? null,
              yourReply: output.reply ?? null,
            }
          : {}),
        ...(output.report ? { oralReport: output.report } : {}),
        ...(output.drafts.length
          ? {
              drafts: output.drafts.map((x) => ({
                subject: subject(x.memorialId),
                edict: x.edict.kind,
                text: x.text,
              })),
            }
          : {}),
        ...(output.dispositions.length
          ? {
              dispositions: output.dispositions.map((x) => ({
                subject: subject(x.documentId),
                action: x.action,
                ...(x.text ? { text: x.text } : {}),
              })),
            }
          : {}),
        ...(output.routes.length
          ? {
              routes: output.routes.map((r) => ({
                subject: subject(r.reportId),
                channel: r.channel,
                ...(r.note ? { note: r.note } : {}),
              })),
            }
          : {}),
        documentsSent: d.documentIds.map((id) => {
          const doc = state.documents[id]!;
          return {
            kind: doc.kind,
            to: doc.toIds.map(name),
            subject: doc.subject,
            text: doc.text,
          };
        }),
        actions: d.actionIds.map((id) => {
          const a = state.actions[id]!;
          return {
            capabilityId: a.capabilityId,
            parameters: a.parameters,
            ...(a.description ? { description: a.description } : {}),
          };
        }),
        ...(notDone.length ? { couldNotBeDone: notDone } : {}),
        ...(d.rejected.length ? { rejected: d.rejected } : {}),
      },
    });
  });
  return entries.sort(
    (a, b) => a.at - b.at || a.order - b.order || a.seq - b.seq,
  );
}

/**
 * Builds the actor-visible input. Order matters for prompt caching: stable
 * identity first, then the append-only log, then everything that changes per call.
 */
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
  const all = experienceLog(state, actorId, language);
  const start =
    Math.floor(Math.max(0, all.length - logLimit) / logChunk) * logChunk;
  const kept = all.slice(start);
  const entryNo = new Map(kept.map((e, i) => [e.key, start + i + 1]));
  const firstNew = kept.findIndex((e) => e.at > last);
  /** Points at the log entry holding a paper's text, or carries the text when it fell out of the log. */
  const paper = (key: string | undefined, text: string): JsonObject => {
    const n = key ? entryNo.get(key) : undefined;
    return n !== undefined ? { textInLogEntry: n } : { text };
  };
  const receivedAt = (documentId: string) =>
    [...state.observations]
      .reverse()
      .find(
        (o) =>
          o.actorId === actorId &&
          o.kind === "paper_received" &&
          o.payload.documentId === documentId,
      )?.id;
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
    actorId,
    self: {
      name: actor.name,
      office: actor.office,
      status: actor.active ? "在任" : "已被革职拿问，不能再调动任何人和物",
      ...actor.profile,
    },
    documentKinds: actor.active ? actor.documentKinds : ["memorial", "letter"],
    capabilities: actor.active
      ? actor.capabilities.map((id) => ({
          id,
          description: capabilitySpecs[id]!.description,
          parameters: capabilitySpecs[id]!.parameters,
        }))
      : [],
    contacts: Object.values(state.actors)
      .filter((a) => a.id !== actorId && a.id !== ids.ruler && a.name)
      .map((a) => ({ id: a.id, name: a.name, office: a.office })),
    ...(actorId === ids.yanSong
      ? {
          edictOptions: edictKinds.map((kind) => ({
            kind,
            description: edictDescriptions[kind],
          })),
        }
      : {}),
    ...(actorId === ids.lvFang
      ? { dispositionOptions: directorateActions }
      : {}),
    ...(actorId === ids.luBing ? { routeOptions: routeChannels } : {}),
    log: kept.map((e, i) => ({ n: start + i + 1, ...e.body })),
    now: formatCourtTime(time, language),
    decisionEpisodeId: episodeId(state, actorId),
    runId,
    newFromLogEntry: firstNew < 0 ? null : start + firstNew + 1,
    resources,
    ...(governs
      ? { provinceReports: countyIds.map((id) => countyFacts(state, id)) }
      : {}),
    policyKnownToYou: policyKnownTo(state, actorId),
    ...(actorId === ids.yanSong
      ? {
          memorialsAwaitingYourDraft: pendingDrafts(state).map((d) => ({
            memorialId: d.id,
            from: name(d.fromId),
            subject: d.subject,
            ...paper(`doc:${d.id}`, d.text),
            ...(d.returns?.length
              ? {
                  returnedByDirectorate: d.returns.map((r) => ({
                    at: formatCourtTime(r.at, language),
                    note: r.note,
                  })),
                }
              : {}),
          })),
        }
      : {}),
    ...(actorId === ids.lvFang
      ? {
          emperor: secludedNote(state, language),
          standingOrders: {
            mode:
              state.standing.mode === "personal"
                ? "亲览全部：皇上要亲自看本章"
                : "司礼监代劳：本章由司礼监酌情处置，拣要紧的奏上",
            instruction: state.standing.instruction || "（无）",
            ...(state.standing.setAt !== undefined
              ? { setAt: formatCourtTime(state.standing.setAt, language) }
              : {}),
          },
          inbox: directorateInbox(state).map((d) => {
            const key = receivedAt(d.id);
            return {
              documentId: d.id,
              kind: d.kind,
              from: name(d.fromId),
              subject: d.subject,
              ...(key ? paper(`obs:${key}`, d.text) : { text: d.text }),
              ...(d.returns?.length
                ? { returnedBefore: d.returns.length }
                : {}),
            };
          }),
          held: directorateHeld(state).map((d) => ({
            documentId: d.id,
            from: name(d.fromId),
            subject: d.subject,
            heldAt: formatCourtTime(d.directorate!.at!, language),
          })),
          cabinetBacklog: pendingDrafts(state).map((d) => ({
            from: name(d.fromId),
            subject: d.subject,
            daysAtCabinet: Math.floor(
              (time - (d.arrivals[ids.yanSong] ?? d.sentAt)) / 12,
            ),
          })),
        }
      : {}),
    ...(actorId === ids.luBing
      ? {
          emperor: secludedNote(state, language),
          reportsAwaitingRouting: reportsAwaitingRoute(state).map((d) => ({
            reportId: d.id,
            subject: d.subject,
            ...paper(`doc:${d.id}`, d.text),
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
    "- inner：你此刻真实的想法，第一人称，不超过150字。只有你自己知道。",
    "- documents：你要发出的文书。memorial 是奏疏，经内阁票拟、司礼监转呈皇帝；secret_memorial 是密奏，不经内阁，由司礼监转呈；letter 是私信，须用 to 写明收信人 id（可以是 id 数组）。你只能用 documentKinds 里列出的文书种类。皇帝只看得到送到御前的文书，看不到你的内心和私信。",
    "- actions：你实际要去做的事，只能从 capabilities 中选，parameters 须符合说明。可以什么都不做。",
    "一次最多发三份文书。文书用半文半白的明代公文口吻，每份不超过200字。行动的结果要等世界给出，不要声称事情已经办成。",
  ];
  if (actorId === ids.yanSong)
    lines.push(
      "- drafts：对 memorialsAwaitingYourDraft 中的每份奏疏票拟：memorialId、edict（kind 取自 edictOptions，params 按说明）、text（替皇上拟的批语）。不票拟的奏疏会压在内阁，皇上看不到。",
    );
  if (actorId === ids.lvFang)
    lines.push(
      "- report：你口奏给皇上的话，皇上下次理事时听到；可以为空。你可以报喜不报忧，但皇上另有耳目。",
      "- dispositions：对 inbox 中的本章逐本处置：documentId、action（取自 dispositionOptions）、text。held 里你先前留中的本章，也可以此时 present 或 summarize。没处置的本章仍留在你手里。",
      '- interrupt：只在皇上闭关时有用。确有急事，写 {"reason":为何要打断}，请皇上出关理事；皇上可能不见。',
      "cabinetBacklog 是内阁压着还没票拟的本章，你只知道来人和题目。催不催、告不告诉皇上，由你决定。",
    );
  if (actorId === ids.luBing)
    lines.push(
      "- routes：对 reportsAwaitingRouting 中的每份原报都必须选一条路：reportId、channel（取自 routeOptions）、note（你附给皇上的话，可不写）、interrupt（皇上闭关时直接面圣，true 为请求打断修道，false 为等出关）。原报一字不能改。",
    );
  if (!actor.active)
    lines.push("你已被革职拿问，不能再有任何 actions，但还可以写下文书。");
  const extra =
    actorId === ids.yanSong
      ? ',"drafts":[{"memorialId":string,"edict":{"kind":string,"params":{}},"text":string}]'
      : actorId === ids.lvFang
        ? ',"report":string,"dispositions":[{"documentId":string,"action":string,"text":string}],"interrupt":{"reason":string}'
        : actorId === ids.luBing
          ? ',"routes":[{"reportId":string,"channel":string,"note":string,"interrupt":boolean}]'
          : "";
  lines.push(
    english
      ? "Write inner, subject and text in English, keeping JSON keys unchanged."
      : "用中文书写。",
    '仅返回一个 JSON 对象：{"inner":string,"documents":[{"kind":string,"to":string,"subject":string,"text":string}],"actions":[{"capabilityId":string,"parameters":{},"description":string}]' +
      extra +
      "}",
  );
  return lines.join("\n");
}

export function conversationSystemPrompt(
  state: CourtState,
  language: string,
): string {
  return [
    systemPrompt(state, ids.lvFang, language),
    "此刻皇上召你当面说话。另加 reply：你当面回皇上的话（必填，口语，不超过200字）。你也可以同时处置本章（比如把留中的本章呈上）、发私信；此时 report 和 interrupt 不起作用。",
  ].join("\n");
}

export function decisionPrompt(input: JsonObject): string {
  return [
    "以下是你此刻所知的一切（JSON）。log 是你的经历，按时间排列；从 newFromLogEntry 那一条起，是你上次决定之后新发生的。请作出这一次的决定。",
    JSON.stringify(input),
  ].join("\n\n");
}
