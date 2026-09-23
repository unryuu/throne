import { z } from "zod";
import type { SimTime } from "@throne/shared-types";
import { countyIds, ids } from "./jiajing.ts";
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
import type { RescriptSubmission } from "./model.ts";

export type RulerDocumentView = {
  readonly id: string;
  readonly kind: CourtDocument["kind"];
  readonly fromId: string;
  readonly fromName: string;
  readonly fromOffice: string;
  readonly subject: string;
  readonly text: string;
  readonly arrivedAt: SimTime;
  readonly draft?: Omit<Draft, "decisionEpisodeId">;
  readonly rescript?: Rescript;
};

export type RulerEdictView = {
  readonly id: string;
  readonly subject: string;
  readonly text: string;
  readonly edict: Edict;
  readonly sentAt: SimTime;
  readonly toNames: readonly string[];
};

export type CourtRulerView = {
  readonly time: SimTime;
  readonly phase: CourtState["phase"];
  readonly audience?: {
    readonly id: string;
    readonly openedAt: SimTime;
    readonly documents: readonly RulerDocumentView[];
  };
  readonly archive: readonly RulerDocumentView[];
  readonly edicts: readonly RulerEdictView[];
  readonly options: {
    readonly counties: readonly { id: string; name: string }[];
    readonly arrestable: readonly { id: string; name: string }[];
    readonly reprimandable: readonly { id: string; name: string }[];
    readonly policyDecided: boolean;
  };
};

function documentView(
  state: CourtState,
  doc: CourtDocument,
): RulerDocumentView {
  const from = state.actors[doc.fromId];
  return {
    id: doc.id,
    kind: doc.kind,
    fromId: doc.fromId,
    fromName: from?.name ?? doc.fromId,
    fromOffice: from?.office.replace(/^原/, "") ?? "",
    subject: doc.subject,
    text: doc.text,
    arrivedAt: doc.readyForRulerAt!,
    ...(doc.draft
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
  return structuredClone({
    time,
    phase: state.phase,
    ...(state.audience
      ? {
          audience: {
            id: state.audience.id,
            openedAt: state.audience.openedAt,
            documents: state.audience.documentIds.map((id) =>
              documentView(state, state.documents[id]!),
            ),
          },
        }
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
    })),
    options: {
      counties: countyIds.map((id) => ({ id, name: state.counties[id].name })),
      arrestable: named(arrestableIds),
      reprimandable: named(reprimandableIds),
      policyDecided: state.policy.status !== "proposed",
    },
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
});

export function parseSubmission(value: unknown): RescriptSubmission {
  return submissionSchema.parse(value) as RescriptSubmission;
}
