import type { JsonObject, SimTime } from "@throne/shared-types";

export type LocationId = "beijing" | "hangzhou" | "taizhou";
export type CountyId = "chunan" | "jiande" | "tonglu";

export type CourtActor = {
  readonly id: string;
  readonly name: string;
  readonly office: string;
  readonly location: LocationId;
  readonly llm: boolean;
  readonly active: boolean;
  readonly capabilities: readonly string[];
  readonly documentKinds: readonly DocumentKind[];
  readonly profile: JsonObject;
  readonly nextDecisionAt?: SimTime;
  readonly lastDecisionAt?: SimTime;
  readonly finalDecisionDone?: boolean;
};

export type County = {
  readonly id: CountyId;
  readonly name: string;
  readonly paddyMu: number;
  readonly mulberryMu: number;
  readonly annexedMu: number;
  /** Waterlogged land still held by its owners; buying it reduces this. */
  readonly floodedMu: number;
  /** Area inundated by the flood, fixed once the flood has passed. */
  readonly inundatedMu: number;
  readonly dikeIntegrity: number;
  readonly dikeSabotaged: boolean;
  readonly breach?: "flood" | "sabotage";
  readonly population: number;
  readonly homeless: number;
  readonly deaths: number;
  readonly reliefStock: number;
  /** Official relief only: provincial granary and army grain. */
  readonly reliefDelivered: number;
  readonly merchantGrainDelivered: number;
  readonly unrest: number;
  readonly lastRiotAt?: SimTime;
  readonly riots: number;
};

export type EdictKind =
  | "acknowledge"
  | "reject"
  | "approve_policy"
  | "order_relief"
  | "order_inquiry"
  | "reprimand"
  | "arrest";

export type Edict = {
  readonly kind: EdictKind;
  readonly params: JsonObject;
};

export type DocumentKind =
  "memorial" | "secret_memorial" | "letter" | "edict" | "report";

export type Draft = {
  readonly edict: Edict;
  readonly text: string;
  readonly draftedAt: SimTime;
  readonly decisionEpisodeId?: string;
};

export type Rescript = {
  readonly disposition: "follow_draft" | "custom" | "hold";
  readonly edict?: Edict;
  readonly text?: string;
  readonly at: SimTime;
  readonly edictDocumentId?: string;
};

export type CourtDocument = {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly fromId: string;
  readonly toIds: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly sentAt: SimTime;
  readonly arrivals: Readonly<Record<string, SimTime>>;
  readonly deliveredTo: readonly string[];
  readonly readyForRulerAt?: SimTime;
  readonly onDeskAt?: SimTime;
  readonly draft?: Draft;
  readonly rescript?: Rescript;
  readonly silenceNoticeAt?: SimTime;
  readonly edict?: Edict;
  readonly replyToId?: string;
  readonly decisionEpisodeId?: string;
  readonly scripted?: boolean;
};

export type ActionStatus = "started" | "succeeded" | "failed" | "impossible";

export type CourtAction = {
  readonly id: string;
  readonly actorId: string;
  readonly capabilityId: string;
  readonly parameters: JsonObject;
  readonly description?: string;
  readonly status: ActionStatus;
  readonly startedAt: SimTime;
  readonly resolveAt?: SimTime;
  readonly resolvedAt?: SimTime;
  readonly outcome?: JsonObject;
  readonly decisionEpisodeId?: string;
};

export type ActorObservation = {
  readonly id: string;
  readonly actorId: string;
  readonly at: SimTime;
  readonly kind: string;
  readonly payload: JsonObject;
};

export type Evidence = {
  readonly id: string;
  readonly countyId: CountyId;
  readonly kind: "dike_breach";
  readonly createdAt: SimTime;
  readonly createdBy: string;
  readonly strength: number;
  readonly discoveredBy: readonly string[];
};

export type PrimitiveGap = {
  readonly id: string;
  readonly actorId: string;
  readonly at: SimTime;
  readonly capabilityId: string;
  readonly parameters: JsonObject;
  readonly description?: string;
};

export type CourtDecisionRecord = {
  readonly decisionEpisodeId: string;
  readonly actorId: string;
  readonly at: SimTime;
  readonly final: boolean;
  readonly input: JsonObject;
  readonly output: JsonObject;
  readonly documentIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly rejected: readonly JsonObject[];
};

export type Audience = {
  readonly id: string;
  readonly openedAt: SimTime;
  readonly documentIds: readonly string[];
};

export type CourtState = {
  readonly phase: "running" | "audience" | "complete";
  readonly seed: string;
  readonly audience?: Audience;
  readonly audienceCount: number;
  readonly audienceScheduledAt?: SimTime;
  readonly lastAudienceAt?: SimTime;
  readonly actors: Readonly<Record<string, CourtActor>>;
  readonly counties: Readonly<Record<CountyId, County>>;
  readonly policy: {
    readonly status: "proposed" | "approved" | "rejected";
    readonly targetMu: number;
    readonly approvedAt?: SimTime;
  };
  readonly granary: number;
  readonly militaryGrain: number;
  readonly merchantGrain: number;
  readonly merchantSilverSpent: number;
  readonly flood: { readonly at: SimTime; readonly strength?: number };
  readonly documents: Readonly<Record<string, CourtDocument>>;
  readonly actions: Readonly<Record<string, CourtAction>>;
  readonly observations: readonly ActorObservation[];
  readonly evidence: readonly Evidence[];
  readonly decisions: readonly CourtDecisionRecord[];
  readonly gaps: readonly PrimitiveGap[];
  readonly counters: Readonly<Record<string, number>>;
  readonly endsAt: SimTime;
  /** Cost guard on regular decisions; final decisions after dismissal are exempt. */
  readonly decisionBudget: number;
  readonly summary?: JsonObject;
};
