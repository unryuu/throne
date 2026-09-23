import type { MotivationProfile } from "./actor-contract.ts";
import type { SimTime } from "./time.ts";

export type BribeStatus = "offered" | "accepted" | "rejected";

export type BribeRecord = {
  readonly id: string;
  readonly chainId: string;
  readonly parentBribeId?: string;
  readonly instruction?: string;
  readonly fromId: string;
  readonly toId: string;
  readonly amount: number;
  readonly targetRef: string;
  readonly status: BribeStatus;
  readonly at: SimTime;
  readonly reason: string;
};

export type CorruptionRecord = {
  readonly id: string;
  readonly actorId: string;
  readonly bribeId: string;
  readonly amount: number;
  readonly evidenceRefs: readonly string[];
  readonly at: SimTime;
};

export type ObligationKind = "office" | "money" | "pardon" | "protection";

export type ObligationRecord = {
  readonly id: string;
  readonly debtorId: string;
  readonly creditorId: string;
  readonly kind: ObligationKind;
  readonly value: number;
  readonly at: SimTime;
  readonly eventId: string;
};

export type BribeOfferView = {
  readonly offerId: string;
  readonly briberId: string;
  readonly recipientId: string;
  readonly offerAmount: number;
  readonly targetRef: string;
  readonly recipientMotivations: MotivationProfile;
  readonly recipientInfluence: number;
  readonly relationshipValence?: number;
  readonly detectionHint?: number;
};

export type BribeDecision = {
  readonly accept: boolean;
  readonly reason: string;
};
