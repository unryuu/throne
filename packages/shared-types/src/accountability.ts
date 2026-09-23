export type MisconductFinding = {
  readonly id: string;
  readonly actorId: string;
  readonly officeId: string;
  readonly subject: string;
  readonly claimRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly strength: number;
};

export type RemovalReason = {
  readonly findingId: string;
};

export type ResistanceCandidate = {
  readonly actorId: string;
  readonly influence: number;
  readonly loyalty: number;
  readonly relationSupport: number;
  readonly evidenceStrength: number;
  readonly basis: "evidence" | "flat";
  readonly score: number;
  readonly evidenceIds: readonly string[];
};
