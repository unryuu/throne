import type {
  JsonObject,
  JsonValue,
  SimulationRecord,
} from "@throne/shared-types";
import { dayOf, formatCourtTime } from "./calendar.ts";
import { createInitialState, ids } from "./jiajing.ts";
import type {
  ActionStatus,
  County,
  CountyId,
  CourtDocument,
  CourtState,
  DocumentKind,
} from "./types.ts";

/**
 * A saved run folded into days for the static spectator page; see FEAT-0010.
 * Built from committed events and the final state, not by replaying rules,
 * so runs saved under earlier rule versions still read.
 */
export type Chronicle = {
  readonly version: 1;
  readonly id: string;
  readonly complete: boolean;
  readonly actors: Readonly<Record<string, ChronicleActor>>;
  readonly days: readonly ChronicleDay[];
  readonly summary?: JsonObject;
  readonly calls: number;
};

export type ChronicleActor = {
  readonly name: string;
  readonly office: string;
  readonly llm: boolean;
};

export type ChronicleDay = {
  readonly day: number;
  readonly date: string;
  readonly ruler: readonly RulerEntry[];
  readonly truth: readonly TruthEntry[];
  readonly world: WorldSnapshot;
};

export type RulerEntry =
  | {
      readonly type: "audience";
      readonly at: number;
      readonly papers: readonly ChroniclePaper[];
      readonly oral: readonly string[];
    }
  | {
      readonly type: "conversation";
      readonly at: number;
      readonly ruler: string;
      readonly reply: string;
    }
  | {
      readonly type: "edict";
      readonly at: number;
      readonly subject: string;
      readonly text: string;
      readonly edict: string;
      readonly to: readonly string[];
      /** Endorsed by the Directorate in the emperor's name. */
      readonly proxy: boolean;
    }
  | { readonly type: "standing"; readonly at: number; readonly text: string }
  | {
      readonly type: "interruption";
      readonly at: number;
      readonly by: string;
      readonly reason: string;
      readonly admitted?: boolean;
    };

export type ChroniclePaper = {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  /** Lü Fang's summary when he folded the original away. */
  readonly summary?: string;
  readonly revealed: boolean;
  readonly draft?: string;
  readonly direct: boolean;
  readonly luBingNote?: string;
  readonly rescript?: {
    readonly disposition: string;
    readonly edict?: string;
    readonly text?: string;
  };
};

export type ChronicleWritten = {
  readonly kind: DocumentKind;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
};

export type TruthEntry =
  | {
      readonly type: "decision";
      readonly at: number;
      readonly episode: string;
      readonly actor: string;
      /** Office held at the time; the actor list carries the final one. */
      readonly office: string;
      readonly final: boolean;
      readonly thought: string;
      readonly report?: string;
      readonly documents: readonly ChronicleWritten[];
      readonly actions: readonly {
        readonly capability: string;
        readonly county?: string;
        readonly description?: string;
        readonly status?: ActionStatus;
      }[];
      readonly drafts: readonly {
        readonly subject: string;
        readonly text: string;
      }[];
      readonly dispositions: readonly {
        readonly subject: string;
        readonly action: string;
      }[];
      readonly routes: readonly {
        readonly subject: string;
        readonly channel: string;
        readonly note?: string;
      }[];
      readonly rejected: readonly string[];
      readonly terminal?: readonly TerminalStep[];
    }
  | {
      readonly type: "result";
      readonly at: number;
      readonly actor: string;
      readonly capability: string;
      readonly county?: string;
      readonly status: ActionStatus;
      readonly outcome?: JsonObject;
    }
  | {
      readonly type: "world";
      readonly at: number;
      readonly kind:
        "flood" | "breach" | "sabotage" | "evidence" | "dismissed" | "ended";
      readonly text: string;
    };

export type TerminalStep = {
  readonly command: string;
  readonly output: string;
  readonly error: boolean;
};

export type WorldSnapshot = {
  readonly counties: readonly CountySnapshot[];
  readonly granary: number;
  readonly militaryGrain: number;
  readonly merchantGrain: number;
};

export type CountySnapshot = Pick<
  County,
  | "id"
  | "name"
  | "paddyMu"
  | "mulberryMu"
  | "annexedMu"
  | "dikeIntegrity"
  | "dikeSabotaged"
  | "homeless"
  | "deaths"
  | "unrest"
  | "riots"
> & { readonly breach?: County["breach"] };

export type ChronicleSource = {
  readonly id: string;
  readonly status: string;
  readonly records: readonly SimulationRecord[];
  readonly state: CourtState;
  readonly calls: readonly {
    readonly decisionEpisodeId?: string;
    readonly terminal?: {
      readonly steps: readonly {
        readonly command: string;
        readonly output: string;
        readonly isError: boolean;
      }[];
    };
  }[];
};

/** Terminal output kept per step; the page shows what the actor did, not every file. */
const terminalOutputLimit = 600;

/** Events with nothing to show on the page, listed so new ones fail loudly. */
const quietEvents = new Set([
  "document.sent",
  "document.delivered",
  "document.ready",
  "document.drafted",
  "document.rescript_linked",
  "document.silence_noticed",
  "document.to_directorate",
  "document.directed",
  "document.proxied",
  "document.returned",
  "document.routed",
  "document.revealed",
  "court.oral_report",
  "court.desk_added",
  "npc.woken",
  "npc.wake_capped",
  "npc.decision_skipped",
  "actor.observed",
  "policy.updated",
  // Retired after the first playtests; kept so those runs still read.
  "court.audience_scheduled",
  "court.audience_skipped",
]);

const str = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
const objects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is JsonObject =>
          typeof v === "object" && v !== null && !Array.isArray(v),
      )
    : [];
/** Early runs sometimes saved a single recipient as a string. */
const recipients = (value: JsonValue | undefined): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? [value]
      : [];

export function buildChronicle(source: ChronicleSource): Chronicle {
  const { state } = source;
  const actors = Object.fromEntries(
    Object.values(state.actors).map((a) => [
      a.id,
      { name: a.name, office: a.office, llm: a.llm },
    ]),
  );
  const name = (id: string) => state.actors[id]?.name ?? id;
  const docs = state.documents;
  const subjectOf = (id: string | undefined) =>
    (id && docs[id]?.subject) ?? id ?? "";
  const countyName = (id: JsonValue | undefined) =>
    typeof id === "string"
      ? (state.counties[id as CountyId]?.name ?? id)
      : undefined;

  const terminals = new Map<string, TerminalStep[]>();
  for (const call of source.calls) {
    if (!call.decisionEpisodeId || !call.terminal) continue;
    terminals.set(
      call.decisionEpisodeId,
      call.terminal.steps.map((s) => ({
        command: s.command,
        output:
          s.output.length > terminalOutputLimit
            ? s.output.slice(0, terminalOutputLimit) + "\n…"
            : s.output,
        error: s.isError,
      })),
    );
  }

  const initial = createInitialState(source.id);
  const offices = new Map(
    Object.values(state.actors).map((a) => [
      a.id,
      initial.actors[a.id]?.office ?? a.office,
    ]),
  );
  const counties = new Map<string, County>(
    Object.values(initial.counties).map((c) => [c.id, c]),
  );
  const resources = {
    granary: initial.granary,
    militaryGrain: initial.militaryGrain,
    merchantGrain: initial.merchantGrain,
  };
  // Actions commit around their decision record; collect them first to match by episode.
  const startedActions = new Map<
    string,
    {
      capabilityId: string;
      status: ActionStatus;
      used: boolean;
      county?: string;
    }[]
  >();
  for (const record of source.records) {
    if (
      record.kind !== "committed" ||
      record.event.eventType !== "action.started"
    )
      continue;
    const a = record.event.payload.action as JsonObject;
    const episode = str(a.decisionEpisodeId);
    if (!episode) continue;
    const county = str((a.parameters as JsonObject | undefined)?.countyId);
    const list = startedActions.get(episode) ?? [];
    list.push({
      capabilityId: String(a.capabilityId),
      status: a.status as ActionStatus,
      used: false,
      ...(county ? { county } : {}),
    });
    startedActions.set(episode, list);
  }

  const days = new Map<number, { ruler: RulerEntry[]; truth: TruthEntry[] }>();
  const dayFor = (time: number) => {
    const day = dayOf(time);
    let entry = days.get(day);
    if (!entry) {
      entry = { ruler: [], truth: [] };
      days.set(day, entry);
    }
    return entry;
  };
  const snapshots = new Map<number, WorldSnapshot>();
  let lastDay = 0;
  let openAudience: Extract<RulerEntry, { type: "audience" }> | undefined;

  const paper = (id: string): ChroniclePaper => {
    const doc: CourtDocument | undefined = docs[id];
    if (!doc) throw new Error(`Chronicle: audience paper ${id} is missing`);
    const folded = doc.directorate?.action === "summarize";
    return {
      id,
      kind: doc.kind,
      from: doc.fromId,
      subject: doc.subject,
      text: doc.text,
      ...(folded && doc.directorate?.text
        ? { summary: doc.directorate.text }
        : {}),
      revealed: doc.revealedAt !== undefined,
      ...(doc.draft ? { draft: doc.draft.text } : {}),
      direct: doc.route?.channel === "direct",
      ...(doc.route?.note ? { luBingNote: doc.route.note } : {}),
    };
  };

  for (const record of source.records) {
    if (record.kind !== "committed") continue;
    const event = record.event;
    const p = event.payload;
    const at = event.occurredAt;
    const { ruler, truth } = dayFor(at);
    lastDay = Math.max(lastDay, dayOf(at));
    switch (event.eventType) {
      case "court.audience_opened": {
        const audience = p.audience as JsonObject;
        openAudience = {
          type: "audience",
          at,
          papers: recipients(audience.documentIds).map(paper),
          oral: recipients(audience.oralReportIds).map(
            (oid) => state.oralReports.find((o) => o.id === oid)?.text ?? "",
          ),
        };
        ruler.push(openAudience);
        break;
      }
      case "court.admitted":
      case "court.declined":
        ruler.push({
          type: "interruption",
          at,
          by: name(state.pendingInterruption?.byId ?? ""),
          reason: "",
          admitted: event.eventType === "court.admitted",
        });
        break;
      case "court.interrupt_requested":
        ruler.push({
          type: "interruption",
          at,
          by: name(String(p.byId)),
          reason: String(p.reason),
        });
        break;
      case "court.conversed":
        ruler.push({
          type: "conversation",
          at,
          ruler: String(p.message),
          reply: String(p.reply),
        });
        break;
      case "court.standing_set":
        ruler.push({
          type: "standing",
          at,
          text: `${p.mode === "delegate" ? "司礼监代劳" : "亲览"}${p.instruction ? `：${String(p.instruction)}` : ""}`,
        });
        break;
      case "court.rescripted": {
        if (!openAudience)
          throw new Error("Chronicle: rescript without an audience");
        const byDoc = new Map(
          objects(p.rescripts).map((r) => [
            String(r.documentId),
            r.rescript as JsonObject,
          ]),
        );
        openAudience = {
          ...openAudience,
          papers: openAudience.papers.map((paperEntry) => {
            const r = byDoc.get(paperEntry.id);
            if (!r) return paperEntry;
            const edict = r.edict as JsonObject | undefined;
            return {
              ...paperEntry,
              rescript: {
                disposition: String(r.disposition),
                ...(edict ? { edict: String(edict.kind) } : {}),
                ...(str(r.text) ? { text: str(r.text)! } : {}),
              },
            };
          }),
        };
        const index = ruler.findIndex(
          (e) => e.type === "audience" && e.at === openAudience!.at,
        );
        if (index >= 0) ruler[index] = openAudience;
        break;
      }
      case "document.sent": {
        const doc = p.document as JsonObject;
        if (doc.fromId !== ids.ruler || doc.kind !== "edict") break;
        const linked = str(doc.replyToId);
        const proxy =
          linked !== undefined &&
          docs[linked]?.rescript?.disposition === "proxy";
        // Rescripts made at the desk already show on their paper.
        if (linked !== undefined && !proxy) break;
        ruler.push({
          type: "edict",
          at,
          subject: String(doc.subject),
          text: String(doc.text),
          edict: String((doc.edict as JsonObject | undefined)?.kind ?? ""),
          to: recipients(doc.toIds).map(name),
          proxy,
        });
        break;
      }
      case "npc.decided": {
        const r = p.record as JsonObject;
        const o = r.output as JsonObject;
        const episode = String(r.decisionEpisodeId);
        const started = startedActions.get(episode) ?? [];
        truth.push({
          type: "decision",
          at,
          episode,
          actor: String(r.actorId),
          office: offices.get(String(r.actorId)) ?? "",
          final: r.final === true,
          thought: String(o.inner ?? ""),
          ...(str(o.report) ? { report: str(o.report)! } : {}),
          documents: objects(o.documents).map((d) => ({
            kind: String(d.kind) as DocumentKind,
            to:
              d.kind === "memorial" || d.kind === "secret_memorial"
                ? [name(ids.ruler)]
                : recipients(d.to).map(name),
            subject: String(d.subject ?? ""),
            text: String(d.text ?? ""),
          })),
          actions: objects(o.actions).map((a) => {
            const params = (a.parameters ?? {}) as JsonObject;
            const county = str(params.countyId);
            const match = started.find(
              (s) =>
                !s.used &&
                s.capabilityId === a.capabilityId &&
                s.county === county,
            );
            if (match) match.used = true;
            return {
              capability: String(a.capabilityId),
              ...(county ? { county: countyName(county)! } : {}),
              ...(str(a.description)
                ? { description: str(a.description)! }
                : {}),
              ...(match ? { status: match.status } : {}),
            };
          }),
          drafts: objects(o.drafts).map((d) => ({
            subject: subjectOf(str(d.memorialId)),
            text: String(d.text ?? ""),
          })),
          dispositions: objects(o.dispositions).map((d) => ({
            subject: subjectOf(str(d.documentId)),
            action: String(d.action),
          })),
          routes: objects(o.routes).map((d) => ({
            subject: subjectOf(str(d.documentId)),
            channel: String(d.channel),
            ...(str(d.note) ? { note: str(d.note)! } : {}),
          })),
          rejected: objects(r.rejected).map((x) =>
            [str(x.subject), str(x.reason)].filter(Boolean).join("："),
          ),
          ...(terminals.has(episode)
            ? { terminal: terminals.get(episode)! }
            : {}),
        });
        break;
      }
      case "action.started":
        break;
      case "action.resolved": {
        const action = state.actions[String(p.actionId)];
        if (!action)
          throw new Error(`Chronicle: action ${String(p.actionId)} is missing`);
        const county = countyName(action.parameters.countyId);
        truth.push({
          type: "result",
          at,
          actor: action.actorId,
          capability: action.capabilityId,
          ...(county ? { county } : {}),
          status: p.status as ActionStatus,
          ...(p.outcome ? { outcome: p.outcome as JsonObject } : {}),
        });
        break;
      }
      case "county.updated": {
        const id = String(p.countyId);
        const before = counties.get(id);
        if (!before) throw new Error(`Chronicle: unknown county ${id}`);
        const patch = p.patch as Partial<County>;
        counties.set(id, { ...before, ...patch });
        if (patch.breach && !before.breach)
          truth.push({
            type: "world",
            at,
            kind: "breach",
            text: `${before.name}大堤决口${patch.breach === "sabotage" ? "（曾被人为掘开）" : ""}`,
          });
        break;
      }
      case "resources.updated":
        Object.assign(resources, p.patch as Partial<typeof resources>);
        break;
      case "flood.occurred":
        truth.push({
          type: "world",
          at,
          kind: "flood",
          text: `端午大汛，汛强 ${Number(p.strength).toFixed(2)}`,
        });
        break;
      case "evidence.created": {
        const e = p.evidence as JsonObject;
        truth.push({
          type: "world",
          at,
          kind: "sabotage",
          text: `${name(String(e.createdBy))}的人暗中掘开${countyName(e.countyId)}大堤`,
        });
        break;
      }
      case "evidence.discovered": {
        const e = state.evidence.find((x) => x.id === p.evidenceId);
        truth.push({
          type: "world",
          at,
          kind: "evidence",
          text: `${name(String(p.actorId))}查到${e ? countyName(e.countyId) : ""}大堤被人掘过的证据`,
        });
        break;
      }
      case "actor.updated": {
        const patch = p.patch as JsonObject;
        if (typeof patch.office === "string")
          offices.set(String(p.actorId), patch.office);
        if (patch.active === false)
          truth.push({
            type: "world",
            at,
            kind: "dismissed",
            text: `${name(String(p.actorId))}革职拿问`,
          });
        break;
      }
      case "world.ended":
        truth.push({ type: "world", at, kind: "ended", text: "本局结束" });
        break;
      default:
        if (!quietEvents.has(event.eventType))
          throw new Error(`Chronicle: unhandled event ${event.eventType}`);
    }
    snapshots.set(dayOf(at), snapshot(counties, resources));
  }

  // Early runs issued special edicts without an edict document; the submission still has them.
  for (const record of source.records) {
    if (
      record.kind !== "scheduled" ||
      record.event.eventType !== "court.rescript"
    )
      continue;
    const at = record.event.scheduledAt;
    const submission = record.event.payload.submission as
      JsonObject | undefined;
    for (const special of objects(submission?.specials)) {
      const text = String(special.text ?? "");
      const kind = String(
        (special.edict as JsonObject | undefined)?.kind ?? "",
      );
      const { ruler } = dayFor(at);
      if (
        ruler.some((e) => e.type === "edict" && e.at === at && e.edict === kind)
      )
        continue;
      ruler.push({
        type: "edict",
        at,
        subject: "特旨",
        text,
        edict: kind,
        to: [],
        proxy: false,
      });
    }
  }

  verifyWorld(counties, resources, state);

  const result: ChronicleDay[] = [];
  let world = snapshot(counties, resources);
  for (let day = 0; day <= lastDay; day++) {
    world = snapshots.get(day) ?? world;
    const entry = days.get(day) ?? { ruler: [], truth: [] };
    result.push({
      day,
      date: formatCourtTime(day * 12, "zh-CN").split(" ")[0]!,
      ruler: entry.ruler,
      truth: entry.truth,
      world,
    });
  }
  return {
    version: 1,
    id: source.id,
    complete: source.status === "complete",
    actors,
    days: result,
    ...(state.summary ? { summary: state.summary } : {}),
    calls: source.calls.length,
  };
}

function snapshot(
  counties: ReadonlyMap<string, County>,
  resources: Omit<WorldSnapshot, "counties">,
): WorldSnapshot {
  return {
    counties: [...counties.values()].map((c) => ({
      id: c.id,
      name: c.name,
      paddyMu: c.paddyMu,
      mulberryMu: c.mulberryMu,
      annexedMu: c.annexedMu,
      dikeIntegrity: c.dikeIntegrity,
      dikeSabotaged: c.dikeSabotaged,
      homeless: c.homeless,
      deaths: c.deaths,
      unrest: c.unrest,
      riots: c.riots,
      ...(c.breach ? { breach: c.breach } : {}),
    })),
    ...resources,
  };
}

/** The folded world must end where the saved state did; otherwise the page would show invented numbers. */
function verifyWorld(
  counties: ReadonlyMap<string, County>,
  resources: Omit<WorldSnapshot, "counties">,
  state: CourtState,
): void {
  for (const saved of Object.values(state.counties)) {
    const folded = counties.get(saved.id) as
      Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(saved))
      if (JSON.stringify(folded?.[key]) !== JSON.stringify(value))
        throw new Error(
          `Chronicle: ${saved.id}.${key} folds to ${JSON.stringify(folded?.[key])}, saved ${JSON.stringify(value)}`,
        );
  }
  for (const key of ["granary", "militaryGrain", "merchantGrain"] as const)
    if (resources[key] !== state[key])
      throw new Error(
        `Chronicle: ${key} folds to ${resources[key]}, saved ${state[key]}`,
      );
}
