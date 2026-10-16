import { imperialEnergy, imperialCapacity } from "./information.ts";
import { z } from "zod";
import type { SimTime } from "@throne/shared-types";
import {
  conversationRounds,
  countyIds,
  ids,
  maxSeclusionDays,
} from "./jiajing.ts";
import {
  arrestableIds,
  edictKinds,
  edictProblem,
  reprimandableIds,
} from "./rules.ts";
import type {
  CourtDocument,
  CourtState,
  Draft,
  Edict,
  Rescript,
} from "./types.ts";
import type { AudienceAction, RescriptSubmission } from "./model.ts";

export type RulerDocumentView = {
  readonly gloss?: string;
  readonly ponders?: CourtDocument["ponders"];
  readonly id: string;
  readonly kind: CourtDocument["kind"];
  readonly fromId: string;
  readonly fromName: string;
  readonly fromOffice: string;
  readonly subject: string;
  /** Empty until opened, and while the original remains behind Lü Fang's summary. */
  readonly text: string;
  readonly arrivedAt: SimTime;
  readonly draft?: Omit<Draft, "decisionEpisodeId">;
  readonly hasDraft?: boolean;
  readonly rescript?: Rescript;
  readonly summary?: string;
  readonly folded: boolean;
  readonly opened?: boolean;
  /** Lu Bing brought this report in person, bypassing the Directorate. */
  readonly direct: boolean;
  readonly luBingNote?: string;
};

export type RulerEdictView = {
  readonly id: string;
  readonly subject: string;
  readonly text: string;
  readonly edict: Edict;
  readonly sentAt: SimTime;
  readonly toNames: readonly string[];
  /** Issued by the Directorate in the emperor's name on the cabinet draft. */
  readonly proxy: boolean;
};

export type CourtRulerView = {
  readonly time: SimTime;
  readonly energy?: number;
  readonly energyCapacity?: number;
  readonly settings?: CourtState["settings"];
  readonly conversations?: CourtState["rulerConversations"];
  readonly phase: CourtState["phase"];
  readonly audience?: {
    readonly id: string;
    readonly openedAt: SimTime;
    readonly documents: readonly RulerDocumentView[];
    readonly oralReports: readonly string[];
    readonly conversation: readonly {
      readonly role: "ruler" | "lv";
      readonly text: string;
    }[];
    readonly roundsLeft: number;
    readonly interruption?: {
      readonly byName: string;
      readonly reason: string;
      readonly admitted: boolean;
    };
  };
  readonly standing: CourtState["standing"];
  readonly secludedUntil?: SimTime;
  readonly archive: readonly RulerDocumentView[];
  readonly edicts: readonly RulerEdictView[];
  readonly options: {
    readonly counties: readonly { id: string; name: string }[];
    readonly arrestable: readonly { id: string; name: string }[];
    readonly reprimandable: readonly { id: string; name: string }[];
    readonly policyDecided: boolean;
    readonly questionable: readonly { id: string; name: string }[];
  };
  /** Out-of-world: regular decisions the cost guard has stopped. */
  readonly cappedWakes: number;
};

function documentView(
  state: CourtState,
  doc: CourtDocument,
): RulerDocumentView {
  const from = state.actors[doc.fromId];
  const opened = !state.information || doc.openedAt !== undefined;
  const folded =
    doc.directorate?.action === "summarize" && doc.revealedAt === undefined;
  return {
    id: doc.id,
    kind: doc.kind,
    fromId: doc.fromId,
    fromName: from?.name ?? doc.fromId,
    fromOffice: from?.office.replace(/^原/, "") ?? "",
    subject: doc.subject,
    text: !opened || folded ? "" : doc.text,
    ...(state.information ? { opened } : {}),
    ...(opened && state.settings?.summaries !== false && doc.gloss !== undefined
      ? { gloss: doc.gloss }
      : {}),
    ...(opened && doc.ponders ? { ponders: doc.ponders } : {}),
    arrivedAt: doc.readyForRulerAt!,
    folded,
    direct: doc.route?.channel === "direct",
    ...(opened &&
    doc.directorate?.action === "summarize" &&
    doc.directorate.text
      ? { summary: doc.directorate.text }
      : {}),
    ...(opened && doc.route?.note ? { luBingNote: doc.route.note } : {}),
    ...(state.information ? { hasDraft: Boolean(doc.draft) } : {}),
    ...(opened && doc.draft
      ? {
          draft: {
            edict: doc.draft.edict,
            text: doc.draft.text,
            draftedAt: doc.draft.draftedAt,
          },
        }
      : {}),
    ...(doc.rescript ? { rescript: doc.rescript } : {}),
  };
}

/** Everything the emperor can know: his desk, his archive and his own edicts. */
export function courtRulerView(
  state: CourtState,
  time: SimTime,
): CourtRulerView {
  const onDesk = Object.values(state.documents)
    .filter((d) => d.readyForRulerAt !== undefined)
    .sort((a, b) => a.readyForRulerAt! - b.readyForRulerAt!);
  const edicts = Object.values(state.documents).filter(
    (d) => d.kind === "edict",
  );
  const ordered = new Set(
    edicts
      .filter((d) => d.edict?.kind === "arrest")
      .map((d) => String(d.edict!.params.actorId)),
  );
  const named = (list: readonly string[]) =>
    list
      .filter((id) => !ordered.has(id))
      .map((id) => ({ id, name: state.actors[id]!.name }));
  const audience = state.audience;
  return structuredClone({
    time,
    ...(state.information
      ? {
          energy: imperialEnergy(state, time),
          energyCapacity: imperialCapacity(state),
        }
      : {}),
    ...(state.settings
      ? {
          settings: state.settings,
          conversations: state.rulerConversations ?? [],
        }
      : {}),
    phase: state.phase,
    ...(audience
      ? {
          audience: {
            id: audience.id,
            openedAt: audience.openedAt,
            documents: audience.documentIds.map((id) =>
              documentView(state, state.documents[id]!),
            ),
            oralReports: audience.oralReportIds.map(
              (id) => state.oralReports.find((r) => r.id === id)!.text,
            ),
            conversation: audience.conversation,
            roundsLeft:
              conversationRounds -
              audience.conversation.filter((c) => c.role === "ruler").length,
            ...(audience.interruption
              ? {
                  interruption: {
                    byName:
                      state.actors[audience.interruption.byId]?.name ??
                      audience.interruption.byId,
                    reason: audience.interruption.reason,
                    admitted: audience.interruption.admitted,
                  },
                }
              : {}),
          },
        }
      : {}),
    standing: state.standing,
    ...(state.secludedUntil !== undefined
      ? { secludedUntil: state.secludedUntil }
      : {}),
    archive: onDesk
      .filter((d) => !state.audience?.documentIds.includes(d.id))
      .filter((d) => d.onDeskAt !== undefined)
      .map((d) => documentView(state, d)),
    edicts: edicts.map((d) => ({
      id: d.id,
      subject: d.subject,
      text: d.text,
      edict: d.edict!,
      sentAt: d.sentAt,
      toNames: d.toIds.map((id) => state.actors[id]?.name ?? id),
      proxy:
        d.replyToId !== undefined &&
        state.documents[d.replyToId]?.rescript?.disposition === "proxy",
    })),
    options: {
      counties: countyIds.map((id) => ({ id, name: state.counties[id].name })),
      arrestable: named(arrestableIds),
      reprimandable: named(reprimandableIds),
      questionable: Object.values(state.actors)
        .filter((a) => a.llm && a.active)
        .map((a) => ({ id: a.id, name: a.name })),
      policyDecided: state.policy.status !== "proposed",
    },
    cappedWakes: state.counters.cappedWakes ?? 0,
  });
}

/** Checks a submission in issue order, including policy changes it makes itself. */
export function submissionProblem(
  state: CourtState,
  submission: RescriptSubmission,
): string | undefined {
  const audience = state.audience;
  if (state.phase !== "audience" || audience?.id !== submission.audienceId)
    return "This audience is not open";
  if (submission.decline)
    return audience.interruption && !audience.interruption.admitted
      ? undefined
      : "There is no interruption to decline";
  if (audience.interruption && !audience.interruption.admitted)
    return "Admit or decline the interruption first";
  if (submission.skipEmptyAudiences && (submission.seclusionDays ?? 1) > 1)
    return "Skipping empty days cannot be combined with seclusion";
  if (
    state.information &&
    submission.specials.length +
      submission.items.filter((i) => i.disposition === "custom").length >
      imperialEnergy(state, audience.openedAt)
  )
    return "皇帝今日精力不足";
  if (
    new Set(submission.items.map((i) => i.documentId)).size !==
    submission.items.length
  )
    return "Duplicate rescript";
  let policy = state.policy;
  const check = (edict: Edict | undefined, replyTo?: string) => {
    if (!edict) return "Missing edict";
    const problem = edictProblem({ ...state, policy }, edict);
    if (problem) return problem;
    if (edict.kind === "approve_policy")
      policy = { ...policy, status: "approved" };
    if (edict.kind === "reject" && replyTo === ids.policyMemorial)
      policy = { ...policy, status: "rejected" };
    return undefined;
  };
  for (const item of submission.items) {
    const doc = state.documents[item.documentId];
    if (!doc || !audience.documentIds.includes(doc.id))
      return "Document is not on the desk";
    if (item.disposition === "hold") continue;
    if (
      state.information &&
      item.disposition === "follow_draft" &&
      item.text?.trim() &&
      item.text.trim() !== doc.draft?.text.trim()
    )
      return "改写票拟须选择改批（花1点精力）";
    if (item.disposition === "follow_draft" && !doc.draft)
      return "This document has no draft";
    const problem = check(
      item.disposition === "follow_draft" ? doc.draft?.edict : item.edict,
      doc.id,
    );
    if (problem) return `${doc.subject}: ${problem}`;
  }
  for (const special of submission.specials) {
    const problem = check(special.edict);
    if (problem) return problem;
  }
  return undefined;
}

/** Checks an in-audience action against the open decision point. */
export function audienceActionProblem(
  state: CourtState,
  audienceId: string,
  action: AudienceAction,
): string | undefined {
  const audience = state.audience;
  if (state.phase !== "audience" || audience?.id !== audienceId)
    return "This audience is not open";
  const waiting = audience.interruption && !audience.interruption.admitted;
  if (
    state.information &&
    ((action.type === "converse" && !audience.conversation.length) ||
      action.type === "ponder" ||
      (!state.settings &&
        (action.type === "reveal" || action.type === "open_message"))) &&
    imperialEnergy(state, audience.openedAt) < 1
  )
    return "皇帝今日精力不足";
  if (waiting && action.type !== "admit") return "Admit the interruption first";
  switch (action.type) {
    case "admit":
      return waiting ? undefined : "There is no interruption to admit";
    case "converse":
      if (waiting) return "Admit the interruption first";
      return audience.conversation.filter((c) => c.role === "ruler").length >=
        conversationRounds
        ? "No more rounds of conversation today"
        : undefined;
    case "ponder": {
      const doc = state.documents[action.documentId];
      return state.settings &&
        doc?.onDeskAt !== undefined &&
        doc.openedAt !== undefined
        ? undefined
        : "请先展开这条消息；旧局不支持深思";
    }
    case "open_message": {
      const doc = state.documents[action.documentId];
      return state.information &&
        doc?.onDeskAt !== undefined &&
        doc.openedAt === undefined
        ? undefined
        : "这条消息不能展开";
    }
    case "reveal": {
      const doc = state.documents[action.documentId];
      return doc &&
        (state.information
          ? doc.onDeskAt !== undefined && doc.openedAt !== undefined
          : audience.documentIds.includes(doc.id)) &&
        doc.directorate?.action === "summarize" &&
        doc.revealedAt === undefined
        ? undefined
        : "This paper has no folded original to call for";
    }
  }
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("converse"),
    message: z.string().min(1).max(400),
  }),
  z.object({ type: z.literal("ponder"), documentId: z.string() }),
  z.object({ type: z.literal("open_message"), documentId: z.string() }),
  z.object({ type: z.literal("reveal"), documentId: z.string() }),
  z.object({ type: z.literal("admit") }),
]);

export function parseAction(value: unknown): AudienceAction {
  return actionSchema.parse(value) as AudienceAction;
}

const edictInput = z.object({
  kind: z.enum(edictKinds as [string, ...string[]]),
  params: z.record(z.string(), z.json()),
});
const submissionSchema = z.object({
  audienceId: z.string(),
  items: z.array(
    z.object({
      documentId: z.string(),
      disposition: z.enum(["follow_draft", "custom", "hold"]),
      edict: edictInput.optional(),
      text: z.string().max(600).optional(),
    }),
  ),
  specials: z
    .array(
      z.object({ edict: edictInput, text: z.string().max(600).optional() }),
    )
    .max(6),
  standing: z
    .object({
      mode: z.enum(["personal", "delegate"]),
      instruction: z.string().max(600),
    })
    .optional(),
  seclusionDays: z.number().int().min(1).max(maxSeclusionDays).optional(),
  decline: z.boolean().optional(),
  skipEmptyAudiences: z.boolean().optional(),
});

export function parseSubmission(value: unknown): RescriptSubmission {
  return submissionSchema.parse(value) as RescriptSubmission;
}
